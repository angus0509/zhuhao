const crypto = require('crypto');
const db = require('../db');
const env = require('../config/env');
const wechatMiniService = require('./wechat-mini.service');
const { assertEmployeeScope } = require('./employee.service');
const { decrypt } = require('../utils/crypto');
const { hashPassword } = require('../utils/password');
const { signToken } = require('../utils/token');
const { maskPhone, maskIdCard } = require('../utils/mask');
const { createError } = require('../utils/response');

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function formatMysqlDate(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function normalizeMeta(meta = {}) {
  return {
    ipAddress: String(meta.ipAddress || '').slice(0, 50) || null,
    deviceInfo: String(meta.deviceInfo || '').slice(0, 255) || null
  };
}

function maskName(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  return `${value.slice(0, 1)}*`;
}

function normalizeLast6(value) {
  return String(value || '').trim().toUpperCase();
}

function phoneTail(phone) {
  return String(phone || '').slice(-4) || null;
}

function normalizeEmployeeRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    companyId: Number(row.company_id ?? row.companyId),
    name: row.name || '',
    phone: row.phone || '',
    idCardNo: row.id_card_no ?? row.idCardNo,
    employeeStatus: Number(row.employee_status ?? row.employeeStatus),
    deletedAt: row.deleted_at ?? row.deletedAt ?? null
  };
}

function createEmployeeAuthService(dependencies = {}) {
  const database = dependencies.db || db;
  const wechat = dependencies.wechatMiniService || wechatMiniService;
  const bindingSecret = dependencies.hmacSecret ?? env.employeeBinding.hmacSecret;
  const ticketTtlSeconds = Number(dependencies.ticketTtlSeconds || env.employeeBinding.ticketTtlSeconds || 300);
  const codeTtlSeconds = Number(dependencies.codeTtlSeconds || env.employeeBinding.codeTtlSeconds || 600);
  const maxAttempts = Number(dependencies.maxAttempts || env.employeeBinding.maxAttempts || 5);
  const now = dependencies.now || (() => new Date());
  const randomBytes = dependencies.randomBytes || crypto.randomBytes;
  const randomInt = dependencies.randomInt || crypto.randomInt;
  const decryptValue = dependencies.decrypt || decrypt;
  const employeeScope = dependencies.assertEmployeeScope || assertEmployeeScope;
  const tokenSigner = dependencies.signToken || signToken;
  const passwordHasher = dependencies.hashPassword || hashPassword;

  function assertBindingSecret() {
    if (Buffer.byteLength(String(bindingSecret || ''), 'utf8') < 32) {
      throw createError('员工绑定服务尚未正确配置', 503);
    }
  }

  function signBindTicket(payload) {
    assertBindingSecret();
    const encodedPayload = base64url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', bindingSecret).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  function verifyBindTicket(ticket, companyId) {
    assertBindingSecret();
    const [encodedPayload, signature, extra] = String(ticket || '').split('.');
    if (!encodedPayload || !signature || extra !== undefined) throw createError('绑定凭证无效或已失效', 401);
    const expected = crypto.createHmac('sha256', bindingSecret).update(encodedPayload).digest('base64url');
    if (!safeEqual(signature, expected)) throw createError('绑定凭证无效或已失效', 401);

    let payload;
    try {
      payload = JSON.parse(fromBase64url(encodedPayload));
    } catch (_error) {
      throw createError('绑定凭证无效或已失效', 401);
    }
    const nowSeconds = Math.floor(now().getTime() / 1000);
    if (payload.purpose !== 'EMPLOYEE_PHONE_BIND'
      || Number(payload.companyId) !== Number(companyId)
      || !Number(payload.employeeId)
      || !payload.openid
      || !payload.nonce
      || Number(payload.exp) <= nowSeconds) {
      throw createError('绑定凭证无效或已失效', 401);
    }
    return payload;
  }

  async function audit(client, values) {
    const params = {
      companyId: Number(values.companyId),
      employeeId: Number(values.employeeId || 0) || null,
      userId: Number(values.userId || 0) || null,
      nonceHash: values.nonceHash || null,
      actionType: values.actionType,
      resultCode: values.resultCode,
      phoneTail: phoneTail(values.phone),
      ...normalizeMeta(values.meta)
    };
    const sql = `INSERT INTO employee_login_audit
      (company_id,employee_id,user_id,ticket_nonce_hash,action_type,result_code,phone_tail,ip_address,device_info)
      VALUES (:companyId,:employeeId,:userId,:nonceHash,:actionType,:resultCode,:phoneTail,:ipAddress,:deviceInfo)`;
    if (client === database) return database.query(sql, params);
    return client.execute(sql, params);
  }

  function employeeSession(employee, user) {
    const companyId = Number(employee.company_id ?? employee.companyId);
    const employeeId = Number(employee.id ?? employee.employeeId);
    const tokenVersion = Number(user.token_version ?? user.tokenVersion ?? 0);
    const token = tokenSigner({
      userId: Number(user.id),
      companyId,
      username: user.username || `employee_${companyId}_${employeeId}`,
      employeeId,
      accountType: 'EMPLOYEE',
      tokenVersion
    });
    return {
      token,
      user: {
        id: Number(user.id),
        companyId,
        employeeId,
        accountType: 'EMPLOYEE',
        username: user.username || `employee_${companyId}_${employeeId}`,
        realName: employee.name || '',
        roles: [],
        permissions: [],
        dataScope: 4,
        scopeDeptIds: []
      }
    };
  }

  async function findActiveOpenidBinding(companyId, openid) {
    const rows = await database.query(
      `SELECT b.id bindingId,b.employee_id employeeId,b.user_id userId,b.openid,b.phone,
              u.username,u.token_version,e.company_id,e.name,e.employee_status,e.deleted_at
       FROM employee_wechat_binding b
       JOIN hr_employee e ON e.id=b.employee_id AND e.company_id=b.company_id
         AND e.employee_status IN (2,3) AND e.deleted_at IS NULL
       JOIN sys_user u ON u.id=b.user_id AND u.company_id=b.company_id
         AND u.status=1 AND u.account_type='EMPLOYEE'
       WHERE b.company_id=:companyId AND b.openid=:openid AND b.binding_status=1
       LIMIT 1`,
      { companyId, openid }
    );
    return rows[0] || null;
  }

  async function startWechatLogin(companyId, body = {}, requestMeta = {}) {
    const loginCode = String(body.loginCode || '').trim();
    const phoneCode = String(body.phoneCode || '').trim();
    if (!loginCode) throw createError('请重新获取微信登录凭证');

    const { openid, unionid } = await wechat.codeToSession(loginCode);
    const existing = await findActiveOpenidBinding(companyId, openid);
    if (existing) {
      await database.query(
        `UPDATE employee_wechat_binding SET last_login_at=NOW()
         WHERE id=:bindingId AND company_id=:companyId AND binding_status=1`,
        { bindingId: existing.bindingId, companyId }
      );
      await audit(database, {
        companyId,
        employeeId: existing.employeeId,
        userId: existing.userId,
        actionType: 'LOGIN',
        resultCode: 'SUCCESS',
        phone: existing.phone,
        meta: requestMeta
      });
      return employeeSession({
        id: existing.employeeId,
        company_id: companyId,
        name: existing.name
      }, {
        id: existing.userId,
        username: existing.username,
        token_version: existing.token_version
      });
    }

    if (!phoneCode) {
      throw createError('请完成微信手机号授权', 400, 'EMPLOYEE_PHONE_AUTH_REQUIRED');
    }
    const { phoneNumber } = await wechat.getPhoneNumber(phoneCode);

    const matches = await database.query(
      `SELECT e.id,e.company_id,e.name,e.phone,e.id_card_no,e.employee_status,e.deleted_at
       FROM hr_employee e
       WHERE e.company_id=:companyId AND e.phone=:phone
         AND e.employee_status IN (2,3) AND e.deleted_at IS NULL
       ORDER BY e.id LIMIT 2`,
      { companyId, phone: phoneNumber }
    );
    if (!matches.length) throw createError('未找到可绑定的在职或已离职员工，请联系驻厂人员');
    if (matches.length !== 1) throw createError('员工档案存在重复手机号，请联系HR处理');

    const employee = normalizeEmployeeRow(matches[0]);
    const nonce = randomBytes(24).toString('hex');
    const nonceHash = sha256(nonce);
    const issuedAt = Math.floor(now().getTime() / 1000);
    const payload = {
      purpose: 'EMPLOYEE_PHONE_BIND',
      companyId: Number(companyId),
      employeeId: employee.id,
      openid,
      unionid: unionid || '',
      phone: phoneNumber,
      nonce,
      exp: issuedAt + ticketTtlSeconds
    };
    await audit(database, {
      companyId,
      employeeId: employee.id,
      nonceHash,
      actionType: 'TICKET_ISSUE',
      resultCode: 'ISSUED',
      phone: phoneNumber,
      meta: requestMeta
    });
    return {
      bindTicket: signBindTicket(payload),
      maskedName: maskName(employee.name),
      needIdentityVerify: true
    };
  }

  async function getLockedActiveEmployee(connection, companyId, employeeId) {
    const [rows] = await connection.execute(
      `SELECT id,company_id,name,phone,id_card_no,employee_status,deleted_at
       FROM hr_employee
       WHERE company_id=:companyId AND id=:employeeId AND employee_status IN (2,3) AND deleted_at IS NULL
       FOR UPDATE`,
      { companyId, employeeId }
    );
    const employee = normalizeEmployeeRow(rows[0]);
    if (!employee || ![2, 3].includes(employee.employeeStatus) || employee.deletedAt) {
      throw createError('员工档案已停用，无法登录', 403);
    }
    return employee;
  }

  function assertIdCardLast6(employee, input) {
    const provided = normalizeLast6(input);
    if (!/^[0-9A-Z]{6}$/.test(provided)) throw createError('请输入身份证后六位');
    let decryptedIdCard = '';
    try {
      decryptedIdCard = normalizeLast6(decryptValue(employee.idCardNo));
      const expected = decryptedIdCard.slice(-provided.length);
      if (!safeEqual(provided, expected)) throw createError('身份信息校验失败');
    } finally {
      decryptedIdCard = '';
    }
  }

  async function ensureEmployeeAccount(connection, companyId, employee, phone) {
    const [users] = await connection.execute(
      `SELECT id,username,token_version,status
       FROM sys_user
       WHERE company_id=:companyId AND employee_id=:employeeId AND account_type='EMPLOYEE'
       ORDER BY id LIMIT 1 FOR UPDATE`,
      { companyId, employeeId: employee.id }
    );
    let user = users[0] || null;
    if (user) {
      await connection.execute(
        `UPDATE sys_user SET real_name=:realName,phone=:phone,status=1,updated_at=NOW()
         WHERE id=:userId AND company_id=:companyId AND account_type='EMPLOYEE'`,
        { companyId, userId: user.id, realName: employee.name, phone: phone || null }
      );
    } else {
      const username = `employee_${companyId}_${employee.id}`;
      const passwordHash = passwordHasher(randomBytes(32).toString('base64url'));
      const [result] = await connection.execute(
        `INSERT INTO sys_user
         (company_id,username,password_hash,real_name,phone,employee_id,token_version,account_type,status)
         VALUES (:companyId,:username,:passwordHash,:realName,:phone,:employeeId,0,'EMPLOYEE',1)`,
        {
          companyId,
          username,
          passwordHash,
          realName: employee.name,
          phone: phone || null,
          employeeId: employee.id
        }
      );
      user = { id: Number(result.insertId), username, token_version: 0 };
    }
    await connection.execute('DELETE FROM sys_user_role WHERE user_id=:userId', { userId: user.id });
    return user;
  }

  async function ensureEmployeeAccountAndBinding(connection, companyId, employee, identity) {
    const [bindings] = await connection.execute(
      `SELECT id,employee_id,user_id,openid,binding_status
       FROM employee_wechat_binding
       WHERE company_id=:companyId AND binding_status=1
         AND (employee_id=:employeeId OR openid=:openid)
       FOR UPDATE`,
      { companyId, employeeId: employee.id, openid: identity.openid }
    );
    const conflict = bindings.find(row =>
      Number(row.employee_id ?? row.employeeId) !== employee.id || String(row.openid) !== String(identity.openid)
    );
    if (conflict) {
      if (String(conflict.openid) === String(identity.openid)) {
        throw createError('当前微信已绑定其他员工', 409);
      }
      throw createError('该员工已绑定其他微信', 409);
    }

    const user = await ensureEmployeeAccount(connection, companyId, employee, identity.phone);

    if (!bindings.length) {
      await connection.execute(
        `INSERT INTO employee_wechat_binding
         (company_id,employee_id,user_id,openid,unionid,phone,binding_status,token_version,bound_at,last_login_at)
         VALUES (:companyId,:employeeId,:userId,:openid,:unionid,:phone,1,0,NOW(),NOW())`,
        {
          companyId,
          employeeId: employee.id,
          userId: user.id,
          openid: identity.openid,
          unionid: identity.unionid || null,
          phone: identity.phone
        }
      );
    }
    return user;
  }

  async function bindByPhone(companyId, body = {}, requestMeta = {}) {
    const ticket = verifyBindTicket(body.bindTicket, companyId);
    const nonceHash = sha256(ticket.nonce);
    return database.transaction(async connection => {
      const [tickets] = await connection.execute(
        `SELECT id,result_code FROM employee_login_audit
         WHERE company_id=:companyId AND ticket_nonce_hash=:nonceHash
         FOR UPDATE`,
        { companyId, nonceHash }
      );
      if (!tickets[0] || tickets[0].result_code !== 'ISSUED') {
        throw createError('绑定凭证已使用或已失效', 409);
      }

      const employee = await getLockedActiveEmployee(connection, companyId, Number(ticket.employeeId));
      if (!safeEqual(String(employee.phone || ''), String(ticket.phone || ''))) {
        throw createError('员工档案手机号已变更，请重新授权登录', 409);
      }
      assertIdCardLast6(employee, body.idCardLast6);
      const user = await ensureEmployeeAccountAndBinding(connection, companyId, employee, {
        openid: ticket.openid,
        unionid: ticket.unionid,
        phone: ticket.phone
      });
      const [consumed] = await connection.execute(
        `UPDATE employee_login_audit
         SET result_code='SUCCESS',user_id=:userId
         WHERE company_id=:companyId AND ticket_nonce_hash=:nonceHash AND result_code='ISSUED'`,
        { companyId, nonceHash, userId: user.id }
      );
      if (Number(consumed.affectedRows) !== 1) throw createError('绑定凭证已使用或已失效', 409);
      await audit(connection, {
        companyId,
        employeeId: employee.id,
        userId: user.id,
        actionType: 'PHONE_BIND',
        resultCode: 'SUCCESS',
        phone: ticket.phone,
        meta: requestMeta
      });
      return employeeSession(employee, user);
    });
  }

  function bindCodeHash(companyId, employeeId, salt, plainCode) {
    assertBindingSecret();
    return crypto.createHmac('sha256', bindingSecret)
      .update(`${companyId}|${employeeId}|${salt}|${plainCode}`)
      .digest('hex');
  }

  async function createBindCode(companyId, employeeId, operatorId, user) {
    const plainCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeSalt = randomBytes(16).toString('hex');
    const codeHash = bindCodeHash(companyId, employeeId, codeSalt, plainCode);
    const expireAtDate = new Date(now().getTime() + codeTtlSeconds * 1000);
    const expireAt = formatMysqlDate(expireAtDate);

    await database.transaction(async connection => {
      await employeeScope(companyId, employeeId, user, connection);
      const [employees] = await connection.execute(
        `SELECT id,employee_status,deleted_at FROM hr_employee
         WHERE company_id=:companyId AND id=:employeeId AND deleted_at IS NULL
         FOR UPDATE`,
        { companyId, employeeId }
      );
      if (!employees[0] || ![2, 3].includes(Number(employees[0].employee_status))) {
        throw createError('只能为在职或已离职员工生成工资条绑定码');
      }
      await connection.execute(
        `UPDATE employee_bind_code SET used_at=NOW()
         WHERE company_id=:companyId AND employee_id=:employeeId AND used_at IS NULL`,
        { companyId, employeeId }
      );
      await connection.execute(
        `INSERT INTO employee_bind_code
         (company_id,employee_id,code_hash,code_salt,expire_at,failed_attempts,used_at,created_by)
         VALUES (:companyId,:employeeId,:codeHash,:codeSalt,:expireAt,0,NULL,:operatorId)`,
        { companyId, employeeId, codeHash, codeSalt, expireAt, operatorId }
      );
      await connection.execute(
        `INSERT INTO hr_operation_log
         (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
         VALUES (:companyId,:operatorId,'员工微信绑定','employee_bind_code',:employeeId,'create',
           JSON_OBJECT('expireAt',:expireAt,'result','success'))`,
        { companyId, operatorId, employeeId, expireAt }
      );
    });
    return { bindCode: plainCode, expireAt };
  }

  async function bindByCode(companyId, body = {}, requestMeta = {}) {
    const loginCode = String(body.loginCode || '').trim();
    const name = String(body.name || '').trim();
    const plainCode = String(body.bindCode || '').trim();
    if (!loginCode) throw createError('请重新获取微信登录凭证');
    if (!name) throw createError('请输入员工姓名');
    if (!/^\d{6}$/.test(plainCode)) throw createError('请输入6位绑定码');
    const { openid, unionid } = await wechat.codeToSession(loginCode);

    const outcome = await database.transaction(async connection => {
      const [rows] = await connection.execute(
        `SELECT e.id,e.company_id,e.name,e.phone,e.id_card_no,e.employee_status,e.deleted_at,
                bc.id code_id,bc.code_hash,bc.code_salt,bc.expire_at,bc.failed_attempts,bc.used_at
         FROM hr_employee e
         JOIN employee_bind_code bc ON bc.employee_id=e.id AND bc.company_id=e.company_id
         WHERE e.company_id=:companyId AND e.name=:name
           AND e.employee_status IN (2,3) AND e.deleted_at IS NULL
         ORDER BY bc.created_at DESC,bc.id DESC
         FOR UPDATE`,
        { companyId, name }
      );
      let candidate = null;
      for (const row of rows) {
        const employee = normalizeEmployeeRow(row);
        try {
          assertIdCardLast6(employee, body.idCardLast6);
          candidate = { row, employee };
          break;
        } catch (error) {
          if (!/身份信息校验失败/.test(error.message)) throw error;
        }
      }
      if (!candidate) return { error: createError('姓名或身份信息校验失败') };
      const { row, employee } = candidate;
      const codeId = Number(row.code_id ?? row.id);
      if (row.used_at) return { error: createError('绑定码已使用或无效', 409) };
      if (Number(row.failed_attempts) >= maxAttempts) {
        return { error: createError('绑定码尝试次数过多，请联系管理员重新生成', 423) };
      }
      const expiresAtMs = new Date(row.expire_at).getTime();
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now().getTime()) {
        await audit(connection, {
          companyId, employeeId: employee.id, actionType: 'CODE_BIND', resultCode: 'EXPIRED',
          phone: employee.phone, meta: requestMeta
        });
        return { error: createError('绑定码已过期，请联系管理员重新生成', 410) };
      }
      const expectedHash = bindCodeHash(companyId, employee.id, row.code_salt, plainCode);
      if (!safeEqual(expectedHash, row.code_hash)) {
        const nextAttempts = Number(row.failed_attempts) + 1;
        await connection.execute(
          `UPDATE employee_bind_code SET failed_attempts=failed_attempts+1
           WHERE id=:codeId AND company_id=:companyId AND used_at IS NULL`,
          { codeId, companyId }
        );
        await audit(connection, {
          companyId,
          employeeId: employee.id,
          actionType: 'CODE_BIND',
          resultCode: nextAttempts >= maxAttempts ? 'LOCKED' : 'FAILED',
          phone: employee.phone,
          meta: requestMeta
        });
        return {
          error: createError(nextAttempts >= maxAttempts
            ? '绑定码尝试次数过多，请联系管理员重新生成'
            : '绑定码错误', nextAttempts >= maxAttempts ? 423 : 400)
        };
      }

      const user = await ensureEmployeeAccountAndBinding(connection, companyId, employee, {
        openid,
        unionid,
        phone: employee.phone || null
      });
      const [consumed] = await connection.execute(
        `UPDATE employee_bind_code SET used_at=NOW()
         WHERE id=:codeId AND company_id=:companyId AND used_at IS NULL`,
        { codeId, companyId }
      );
      if (Number(consumed.affectedRows) !== 1) {
        throw createError('绑定码已使用或无效', 409);
      }
      await audit(connection, {
        companyId,
        employeeId: employee.id,
        userId: user.id,
        actionType: 'CODE_BIND',
        resultCode: 'SUCCESS',
        phone: employee.phone,
        meta: requestMeta
      });
      return { session: employeeSession(employee, user) };
    });
    if (outcome.error) throw outcome.error;
    return outcome.session;
  }

  function receiptStatusName(status) {
    return { 1: '待签收', 2: '已签收', 3: '已拒签' }[Number(status)] || '未发送';
  }

  async function getProfile(companyId, user) {
    const employeeId = Number(user?.employeeId || 0);
    if (user?.accountType !== 'EMPLOYEE' || !employeeId) {
      throw createError('当前账号未关联员工档案', 403);
    }
    const row = await database.first(
      `SELECT e.id,e.name,e.phone,e.id_card_no,e.employee_status,e.lifecycle_status,
              c.customer_name customerName,p.project_name projectName,pos.position_name positionName,
              EXISTS(
                SELECT 1 FROM employee_wechat_binding wb
                WHERE wb.company_id=e.company_id AND wb.employee_id=e.id AND wb.binding_status=1
              ) wechatBound,
              latest.id latestPayslipId,latest_batch.salary_month salaryMonth,
              latest.receipt_status receiptStatus
       FROM hr_employee e
       LEFT JOIN hr_employee_job j ON j.id=(
         SELECT j2.id FROM hr_employee_job j2
         WHERE j2.company_id=e.company_id AND j2.employee_id=e.id
         ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
       )
       LEFT JOIN crm_customer c ON c.id=j.customer_id AND c.company_id=e.company_id
       LEFT JOIN labor_project p ON p.id=j.project_id AND p.company_id=e.company_id
       LEFT JOIN hr_position pos ON pos.id=j.position_id
       LEFT JOIN salary_detail latest ON latest.id=(
         SELECT d2.id FROM salary_detail d2
         JOIN salary_batch b2 ON b2.id=d2.batch_id AND b2.company_id=d2.company_id
         WHERE d2.company_id=e.company_id AND d2.employee_id=e.id
           AND b2.batch_status=5 AND d2.receipt_status IN (1,2,3)
         ORDER BY b2.salary_month DESC,d2.id DESC LIMIT 1
       )
       LEFT JOIN salary_batch latest_batch ON latest_batch.id=latest.batch_id
         AND latest_batch.company_id=latest.company_id
       WHERE e.company_id=:companyId AND e.id=:employeeId
         AND e.employee_status IN (2,3) AND e.deleted_at IS NULL LIMIT 1`,
      { companyId, employeeId }
    );
    if (!row) throw createError('员工档案已停用，无法查看', 403);
    let idCardNo = '';
    try {
      idCardNo = decryptValue(row.id_card_no);
      const latestPayslipId = Number(row.latestPayslipId || 0);
      return {
        employeeId: Number(row.id),
        name: row.name || '',
        idCardMasked: maskIdCard(idCardNo),
        phoneMasked: maskPhone(row.phone),
        customerName: row.customerName || '',
        projectName: row.projectName || '',
        positionName: row.positionName || '',
        employeeStatus: Number(row.employee_status),
        employeeStatusName: Number(row.employee_status) === 2 ? '在职' : '已离职',
        wechatBound: Number(row.wechatBound) === 1,
        latestPayslip: latestPayslipId ? {
          id: latestPayslipId,
          salaryMonth: row.salaryMonth || '',
          receiptStatus: Number(row.receiptStatus || 0),
          receiptStatusName: receiptStatusName(row.receiptStatus)
        } : null
      };
    } finally {
      idCardNo = '';
    }
  }

  return {
    startWechatLogin,
    bindByPhone,
    createBindCode,
    bindByCode,
    getProfile,
    ensureEmployeeAccount,
    employeeSession
  };
}

const service = createEmployeeAuthService();

module.exports = {
  ...service,
  createEmployeeAuthService
};
