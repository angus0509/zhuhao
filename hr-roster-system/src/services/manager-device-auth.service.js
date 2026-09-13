const crypto = require('node:crypto');
const db = require('../db');
const env = require('../config/env');
const { createError } = require('../utils/response');

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function invalidCredential() {
  return createError('一键登录已失效，请重新输入账号和密码', 401, 'REMEMBERED_LOGIN_INVALID');
}

function createManagerDeviceAuthService(dependencies = {}) {
  const database = dependencies.db || db;
  const now = dependencies.now || (() => new Date());
  const randomToken = dependencies.randomToken || createOpaqueToken;
  const ttlSeconds = Number(dependencies.ttlSeconds || env.auth.managerRememberLoginTtlSeconds);

  async function resolveTokenVersion(companyId, userId, suppliedTokenVersion) {
    if (suppliedTokenVersion !== undefined
      && suppliedTokenVersion !== null
      && Number.isInteger(Number(suppliedTokenVersion))) return Number(suppliedTokenVersion);
    const user = await database.first(
      `SELECT token_version tokenVersion FROM sys_user
       WHERE id=:userId AND company_id=:companyId AND status=1
         AND COALESCE(account_type,'MANAGER')='MANAGER' LIMIT 1`,
      { companyId, userId }
    );
    if (!user) throw invalidCredential();
    return Number(user.tokenVersion || 0);
  }

  async function issue({ companyId, userId, tokenVersion, deviceInfo = '', ipAddress = '' }) {
    const normalizedCompanyId = Number(companyId);
    const normalizedUserId = Number(userId);
    if (!normalizedCompanyId || !normalizedUserId) throw invalidCredential();
    const currentTokenVersion = await resolveTokenVersion(
      normalizedCompanyId,
      normalizedUserId,
      tokenVersion
    );
    const refreshToken = randomToken();
    const expireDate = new Date(now().getTime() + ttlSeconds * 1000);
    const expiresAt = expireDate.toISOString();
    await database.query(
      `INSERT INTO manager_login_device
       (company_id,user_id,token_hash,token_version,expire_at,last_used_at,ip_address,device_info)
       VALUES (:companyId,:userId,:tokenHash,:tokenVersion,
         DATE_ADD(NOW(), INTERVAL :ttlSeconds SECOND),NOW(),:ipAddress,:deviceInfo)`,
      {
        companyId: normalizedCompanyId,
        userId: normalizedUserId,
        tokenHash: tokenHash(refreshToken),
        tokenVersion: currentTokenVersion,
        ttlSeconds,
        ipAddress: sanitizeText(ipAddress, 50),
        deviceInfo: sanitizeText(deviceInfo, 255)
      }
    );
    await database.query(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data,ip_address)
       VALUES (:companyId,:userId,'账号安全','manager_login_device',:userId,:actionType,
         JSON_OBJECT('result','success','credentialType','device_refresh'),:ipAddress)`,
      {
        companyId: normalizedCompanyId,
        userId: normalizedUserId,
        actionType: 'remember_login_issue',
        ipAddress: sanitizeText(ipAddress, 50)
      }
    );
    return { refreshToken, expiresAt };
  }

  async function refresh({ companyId, refreshToken, deviceInfo = '', ipAddress = '' }) {
    const normalizedCompanyId = Number(companyId);
    if (!normalizedCompanyId || !refreshToken) throw invalidCredential();
    const oldTokenHash = tokenHash(refreshToken);
    return database.transaction(async connection => {
      const [rows] = await connection.execute(
        `SELECT d.id credentialId,d.company_id companyId,d.user_id userId,
                d.token_version credentialTokenVersion,d.expire_at expireAt,
                u.*,u.token_version userTokenVersion
         FROM manager_login_device d
         JOIN sys_user u ON u.id=d.user_id AND u.company_id=d.company_id
         WHERE d.company_id=:companyId AND d.token_hash=:tokenHash
           AND d.revoked_at IS NULL
           AND d.expire_at > NOW()
           AND u.status=1 AND COALESCE(u.account_type,'MANAGER')='MANAGER'
         LIMIT 1 FOR UPDATE`,
        { companyId: normalizedCompanyId, tokenHash: oldTokenHash }
      );
      const credential = rows[0];
      if (!credential) throw invalidCredential();
      if (Number(credential.credentialTokenVersion || 0) !== Number(credential.userTokenVersion || 0)) {
        throw invalidCredential();
      }

      const replacementToken = randomToken();
      const replacementExpireDate = new Date(now().getTime() + ttlSeconds * 1000);
      const replacementExpiresAt = replacementExpireDate.toISOString();
      const [revokeResult] = await connection.execute(
        `UPDATE manager_login_device SET revoked_at=NOW(),last_used_at=NOW()
         WHERE id=:credentialId AND revoked_at IS NULL`,
        { credentialId: Number(credential.credentialId) }
      );
      if (Number(revokeResult.affectedRows || 0) !== 1) throw invalidCredential();
      await connection.execute(
        `INSERT INTO manager_login_device
         (company_id,user_id,token_hash,token_version,expire_at,last_used_at,ip_address,device_info)
         VALUES (:companyId,:userId,:tokenHash,:tokenVersion,
           DATE_ADD(NOW(), INTERVAL :ttlSeconds SECOND),NOW(),:ipAddress,:deviceInfo)`,
        {
          companyId: normalizedCompanyId,
          userId: Number(credential.userId),
          tokenHash: tokenHash(replacementToken),
          tokenVersion: Number(credential.userTokenVersion || 0),
          ttlSeconds,
          ipAddress: sanitizeText(ipAddress, 50),
          deviceInfo: sanitizeText(deviceInfo, 255)
        }
      );
      await connection.execute(
        `INSERT INTO hr_operation_log
         (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data,ip_address)
         VALUES (:companyId,:userId,'账号安全','manager_login_device',:userId,:actionType,
           JSON_OBJECT('result','success','credentialType','device_refresh'),:ipAddress)`,
        {
          companyId: normalizedCompanyId,
          userId: Number(credential.userId),
          actionType: 'remember_login_refresh',
          ipAddress: sanitizeText(ipAddress, 50)
        }
      );
      return {
        user: credential,
        refreshToken: replacementToken,
        expiresAt: replacementExpiresAt
      };
    });
  }

  async function revoke({ companyId, refreshToken }) {
    if (!Number(companyId) || !refreshToken) return;
    const params = { companyId: Number(companyId), tokenHash: tokenHash(refreshToken) };
    await database.query(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       SELECT company_id,user_id,'账号安全','manager_login_device',user_id,'remember_login_revoke',
              JSON_OBJECT('result','success','credentialType','device_refresh')
       FROM manager_login_device
       WHERE company_id=:companyId AND token_hash=:tokenHash
       LIMIT 1`,
      params
    );
    await database.query(
      `UPDATE manager_login_device SET revoked_at=COALESCE(revoked_at,NOW())
       WHERE company_id=:companyId AND token_hash=:tokenHash`,
      params
    );
  }

  return { issue, refresh, revoke };
}

module.exports = {
  createManagerDeviceAuthService,
  managerDeviceAuthService: createManagerDeviceAuthService()
};
