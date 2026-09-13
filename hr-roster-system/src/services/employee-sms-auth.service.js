const crypto = require('crypto');
const db = require('../db');
const env = require('../config/env');
const smsProvider = require('./tencent-sms.service');
const employeeAuthService = require('./employee-auth.service');
const { createError } = require('../utils/response');

const PUBLIC_RESULT = Object.freeze({ retryAfterSeconds: 60 });

function normalizePhone(phone) {
  const value = String(phone || '').replace(/[\s-]/g, '');
  if (!/^1\d{10}$/.test(value)) throw createError('请输入正确的11位手机号');
  return value;
}

function formatMysqlDate(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createEmployeeSmsAuthService(dependencies = {}) {
  const database = dependencies.db || db;
  const provider = dependencies.smsProvider || smsProvider;
  const secret = dependencies.hmacSecret ?? env.smsCode.hmacSecret;
  const now = dependencies.now || (() => new Date());
  const randomInt = dependencies.randomInt || crypto.randomInt;
  const ttlSeconds = Number(dependencies.ttlSeconds || env.smsCode.ttlSeconds || 300);
  const resendSeconds = Number(dependencies.resendSeconds || env.smsCode.resendSeconds || 60);
  const maxDailySends = Number(dependencies.maxDailySends || env.smsCode.maxDailySends || 10);
  const maxHourlyIpRequests = Number(dependencies.maxHourlyIpRequests || env.smsCode.maxHourlyIpRequests || 20);
  const maxAttempts = Number(dependencies.maxAttempts || env.smsCode.maxAttempts || 5);
  const issueEmployeeSession = dependencies.issueEmployeeSession || (async (connection, employee, phone) => {
    const user = await employeeAuthService.ensureEmployeeAccount(connection, employee.company_id, employee, phone);
    return employeeAuthService.employeeSession(employee, user);
  });

  function assertSecret() {
    if (Buffer.byteLength(String(secret || ''), 'utf8') < 32) {
      throw createError('短信验证服务尚未正确配置', 503, 'SMS_NOT_ENABLED');
    }
  }

  function digest(value) {
    assertSecret();
    return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
  }

  function hashes(companyId, phone, ipAddress = '') {
    return {
      phoneHash: digest(`phone:${companyId}:${phone}`),
      ipHash: digest(`ip:${companyId}:${String(ipAddress || '')}`)
    };
  }

  function codeHash(companyId, phone, code) {
    return digest(`code:${companyId}:${phone}:${code}`);
  }

  async function requestLoginCode(companyId, body = {}, meta = {}) {
    const phone = normalizePhone(body.phone);
    const requestedAt = now();
    const createdAt = formatMysqlDate(requestedAt);
    const { phoneHash, ipHash } = hashes(companyId, phone, meta.ipAddress);

    const [latestRows, dailyRows, hourlyIpRows] = await Promise.all([
      database.query(
        `SELECT created_at FROM employee_sms_verification
         WHERE company_id=:companyId AND phone_hash=:phoneHash
         ORDER BY id DESC LIMIT 1`,
        { companyId, phoneHash }
      ),
      database.query(
        `SELECT COUNT(*) total FROM employee_sms_verification
         WHERE company_id=:companyId AND phone_hash=:phoneHash
           AND created_at>=DATE_SUB(:createdAt,INTERVAL 1 DAY)`,
        { companyId, phoneHash, createdAt }
      ),
      database.query(
        `SELECT COUNT(*) total FROM employee_sms_verification
         WHERE company_id=:companyId AND request_ip_hash=:ipHash
           AND created_at>=DATE_SUB(:createdAt,INTERVAL 1 HOUR)`,
        { companyId, ipHash, createdAt }
      )
    ]);

    const latestAt = latestRows[0] ? new Date(latestRows[0].created_at).getTime() : 0;
    if (latestAt && requestedAt.getTime() - latestAt < resendSeconds * 1000) {
      throw createError('请稍后再获取验证码', 429, 'EMPLOYEE_SMS_RESEND_LIMITED');
    }
    if (Number(dailyRows[0]?.total || 0) >= maxDailySends
      || Number(hourlyIpRows[0]?.total || 0) >= maxHourlyIpRequests) {
      throw createError('验证码请求过于频繁，请稍后重试', 429, 'EMPLOYEE_SMS_RATE_LIMITED');
    }

    const matches = await database.query(
      `SELECT id,company_id,name,phone,employee_status,deleted_at
       FROM hr_employee
       WHERE company_id=:companyId AND phone=:phone
         AND employee_status IN (2,3) AND deleted_at IS NULL
       ORDER BY id LIMIT 2`,
      { companyId, phone }
    );
    const employee = matches.length === 1 ? matches[0] : null;
    const plainCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = formatMysqlDate(new Date(requestedAt.getTime() + ttlSeconds * 1000));
    const insert = await database.query(
      `INSERT INTO employee_sms_verification
       (company_id,employee_id,purpose,phone_hash,phone_tail,code_hash,expires_at,failed_attempts,
        send_status,request_ip_hash,created_at)
       VALUES (:companyId,:employeeId,'EMPLOYEE_LOGIN',:phoneHash,:phoneTail,:codeHash,:expiresAt,0,
        :sendStatus,:ipHash,:createdAt)`,
      {
        companyId,
        employeeId: employee ? Number(employee.id) : null,
        phoneHash,
        phoneTail: phone.slice(-4),
        codeHash: codeHash(companyId, phone, plainCode),
        expiresAt,
        sendStatus: employee ? 'PENDING' : 'SUPPRESSED',
        ipHash,
        createdAt
      }
    );

    if (!employee) {
      throw createError(
        '登记号码错误，请联系驻厂！',
        400,
        'EMPLOYEE_PHONE_NOT_REGISTERED'
      );
    }

    let result;
    try {
      result = await provider.sendTemplate({
        phone,
        templateKey: 'loginCode',
        params: [plainCode, String(Math.ceil(ttlSeconds / 60))]
      });
    } catch (_error) {
      result = { accepted: false, requestId: '' };
    }
    await database.query(
      `UPDATE employee_sms_verification
       SET send_status=:sendStatus,provider_request_id=:providerRequestId,updated_at=NOW()
       WHERE id=:verificationId AND company_id=:companyId`,
      {
        companyId,
        verificationId: Number(insert.insertId),
        sendStatus: result.accepted ? 'SENT' : 'FAILED',
        providerRequestId: result.requestId || null
      }
    );
    return { ...PUBLIC_RESULT, retryAfterSeconds: resendSeconds };
  }

  function invalidCodeError() {
    return createError('验证码无效或已过期', 400, 'EMPLOYEE_SMS_CODE_INVALID');
  }

  async function loginByCode(companyId, body = {}, meta = {}) {
    const phone = normalizePhone(body.phone);
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw invalidCodeError();
    const { phoneHash } = hashes(companyId, phone, meta.ipAddress);

    return database.transaction(async connection => {
      const [rows] = await connection.execute(
        `SELECT id,employee_id,code_hash,expires_at,failed_attempts,send_status,consumed_at
         FROM employee_sms_verification
         WHERE company_id=:companyId AND phone_hash=:phoneHash AND purpose='EMPLOYEE_LOGIN'
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        { companyId, phoneHash }
      );
      const row = rows[0];
      if (!row || row.consumed_at || row.send_status !== 'SENT'
        || new Date(row.expires_at).getTime() <= now().getTime()) {
        throw invalidCodeError();
      }
      if (Number(row.failed_attempts) >= maxAttempts) {
        throw createError('验证码尝试次数过多，请重新获取', 423, 'EMPLOYEE_SMS_CODE_LOCKED');
      }
      const expected = codeHash(companyId, phone, code);
      if (!safeEqual(expected, row.code_hash)) {
        const nextAttempts = Number(row.failed_attempts) + 1;
        await connection.execute(
          `UPDATE employee_sms_verification SET failed_attempts=failed_attempts+1,updated_at=NOW()
           WHERE id=:verificationId AND company_id=:companyId AND consumed_at IS NULL`,
          { companyId, verificationId: Number(row.id) }
        );
        if (nextAttempts >= maxAttempts) {
          throw createError('验证码尝试次数过多，请重新获取', 423, 'EMPLOYEE_SMS_CODE_LOCKED');
        }
        throw invalidCodeError();
      }

      const [employees] = await connection.execute(
        `SELECT id,company_id,name,phone,employee_status,deleted_at
         FROM hr_employee
         WHERE company_id=:companyId AND id=:employeeId
           AND employee_status IN (2,3) AND deleted_at IS NULL
         FOR UPDATE`,
        { companyId, employeeId: Number(row.employee_id) }
      );
      const employee = employees[0];
      if (!employee || !safeEqual(normalizePhone(employee.phone), phone)) {
        throw createError('员工档案已停用，无法登录', 403, 'EMPLOYEE_ACCOUNT_INACTIVE');
      }

      const session = await issueEmployeeSession(connection, employee, phone);
      const [consumed] = await connection.execute(
        `UPDATE employee_sms_verification SET consumed_at=NOW(),updated_at=NOW()
         WHERE id=:verificationId AND company_id=:companyId AND consumed_at IS NULL`,
        { companyId, verificationId: Number(row.id) }
      );
      if (Number(consumed.affectedRows) !== 1) throw invalidCodeError();
      await connection.execute(
        `INSERT INTO employee_login_audit
         (company_id,employee_id,user_id,action_type,result_code,phone_tail,ip_address,device_info)
         VALUES (:companyId,:employeeId,:userId,'SMS_LOGIN','SUCCESS',:phoneTail,:ipAddress,:deviceInfo)`,
        {
          companyId,
          employeeId: Number(employee.id),
          userId: Number(session.user?.id || 0) || null,
          phoneTail: phone.slice(-4),
          ipAddress: String(meta.ipAddress || '').slice(0, 50) || null,
          deviceInfo: String(meta.deviceInfo || '').slice(0, 255) || null
        }
      );
      return session;
    });
  }

  return { requestLoginCode, loginByCode };
}

const service = createEmployeeSmsAuthService();

module.exports = {
  ...service,
  createEmployeeSmsAuthService
};
