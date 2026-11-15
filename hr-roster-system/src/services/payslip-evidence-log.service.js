const crypto = require('node:crypto');
const env = require('../config/env');
const { createError } = require('../utils/response');

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ACTION_TYPES = new Set(['VIEW', 'ACCEPT', 'REJECT', 'DISPUTE']);

function positiveInteger(value, message) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw createError(message);
  return result;
}

function optionalHash(value, message) {
  const result = String(value || '').toLowerCase();
  if (!result) return null;
  if (!HASH_PATTERN.test(result)) throw createError(message);
  return result;
}

function normalizeEventAt(value = new Date()) {
  const result = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(result.getTime())) throw createError('证据日志时间无效');
  result.setMilliseconds(0);
  return result;
}

function newEvidencePayload(context) {
  return [
    context.companyId,
    context.payslipId,
    context.employeeId,
    context.userId,
    context.actionType,
    context.resultStatus,
    context.eventAt.toISOString(),
    context.contentSha256 || '',
    context.signatureSha256 || '',
    context.challengeId || '',
    context.statementVersion || '',
    context.previousEvidenceHash || '',
    context.keyVersion
  ].join('|');
}

function legacyEvidencePayload(context) {
  return [
    context.companyId,
    context.payslipId,
    context.employeeId,
    context.userId,
    context.actionType,
    context.resultStatus,
    context.eventAt.toISOString()
  ].join('|');
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyLegacyHash(secret, context, storedHash) {
  const eventAt = new Date(context.eventAt);
  for (let millisecond = 0; millisecond < 1000; millisecond += 1) {
    eventAt.setMilliseconds(millisecond);
    if (hmac(secret, legacyEvidencePayload({ ...context, eventAt })) === storedHash) return true;
  }
  return false;
}

function rowValue(row, camelName, snakeName) {
  return row?.[camelName] ?? row?.[snakeName] ?? null;
}

function verificationContext(row) {
  return {
    companyId: Number(rowValue(row, 'companyId', 'company_id')),
    payslipId: Number(rowValue(row, 'payslipId', 'salary_detail_id')),
    employeeId: Number(rowValue(row, 'employeeId', 'employee_id')),
    userId: Number(rowValue(row, 'userId', 'user_id')),
    actionType: String(rowValue(row, 'actionType', 'action_type') || ''),
    resultStatus: Number(rowValue(row, 'resultStatus', 'result_status')),
    eventAt: normalizeEventAt(rowValue(row, 'createdAt', 'created_at')),
    contentSha256: rowValue(row, 'payslipContentSha256', 'payslip_content_sha256'),
    signatureSha256: rowValue(row, 'signatureSha256', 'signature_sha256'),
    challengeId: rowValue(row, 'challengeId', 'challenge_id'),
    statementVersion: rowValue(row, 'statementVersion', 'statement_version'),
    previousEvidenceHash: rowValue(row, 'previousEvidenceHash', 'previous_evidence_hash'),
    keyVersion: rowValue(row, 'evidenceKeyVersion', 'evidence_key_version')
  };
}

function verifyEvidenceRows(rows, secretResolver) {
  const source = Array.isArray(rows) ? rows : [];
  const errors = source.length === 0
    ? [{ index: null, id: null, code: 'NO_EVIDENCE_ROWS' }]
    : [];
  let previousHash = null;
  let previousId = 0;
  let chainHead = null;

  source.forEach((row, index) => {
    const id = Number(rowValue(row, 'id', 'id'));
    const storedHash = String(rowValue(row, 'evidenceHash', 'evidence_hash') || '').toLowerCase();
    if (!Number.isSafeInteger(id) || id <= previousId) {
      errors.push({ index, id: Number.isSafeInteger(id) ? id : null, code: 'ORDER_INVALID' });
    }
    previousId = Number.isSafeInteger(id) ? id : previousId;
    if (!HASH_PATTERN.test(storedHash)) {
      errors.push({ index, id, code: 'HASH_INVALID' });
      previousHash = storedHash || null;
      chainHead = storedHash || null;
      return;
    }

    let context;
    try {
      context = verificationContext(row);
    } catch (_error) {
      errors.push({ index, id, code: 'EVENT_TIME_INVALID' });
      previousHash = storedHash;
      chainHead = storedHash;
      return;
    }
    const keyVersion = String(context.keyVersion || '').trim() || null;
    const rowPreviousHash = String(context.previousEvidenceHash || '').toLowerCase() || null;
    if (keyVersion && rowPreviousHash !== previousHash) {
      errors.push({ index, id, code: 'CHAIN_GAP' });
    }

    let secret = '';
    try {
      secret = String(secretResolver(keyVersion) || '');
    } catch (_error) {
      secret = '';
    }
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      errors.push({ index, id, code: 'SECRET_UNAVAILABLE' });
    } else {
      const validHash = keyVersion
        ? hmac(secret, newEvidencePayload({ ...context, keyVersion })) === storedHash
        : verifyLegacyHash(secret, context, storedHash);
      if (!validHash) errors.push({ index, id, code: 'HASH_MISMATCH' });
    }
    previousHash = storedHash;
    chainHead = storedHash;
  });

  return {
    valid: errors.length === 0,
    checked: source.length,
    errors,
    chainHead
  };
}

function createPayslipEvidenceLogService(dependencies = {}) {
  const evidenceSecret = dependencies.evidenceSecret ?? env.payslipEvidence.hmacSecret;
  const defaultKeyVersion = dependencies.keyVersion || env.payslipEvidence.keyVersion;

  async function appendEvidenceLog(connection, input = {}) {
    if (Buffer.byteLength(String(evidenceSecret || ''), 'utf8') < 32) {
      throw createError('工资条证据服务配置不完整', 503, 'PAYSLIP_EVIDENCE_NOT_CONFIGURED');
    }
    const context = {
      companyId: positiveInteger(input.companyId, '企业参数无效'),
      payslipId: positiveInteger(input.payslipId, '工资条参数无效'),
      employeeId: positiveInteger(input.employeeId, '员工参数无效'),
      userId: positiveInteger(input.userId, '员工账号参数无效'),
      actionType: String(input.actionType || '').trim().toUpperCase(),
      resultStatus: Number(input.resultStatus),
      eventAt: normalizeEventAt(input.eventAt),
      contentSha256: optionalHash(input.contentSha256, '工资条内容摘要无效'),
      signatureSha256: optionalHash(input.signatureSha256, '签名摘要无效'),
      challengeId: input.challengeId == null ? null : positiveInteger(input.challengeId, '签收挑战无效'),
      statementVersion: String(input.statementVersion || '').trim() || null,
      keyVersion: String(input.keyVersion || defaultKeyVersion || '').trim()
    };
    if (!ACTION_TYPES.has(context.actionType)) throw createError('证据日志操作类型无效');
    if (!Number.isInteger(context.resultStatus)) throw createError('证据日志结果状态无效');
    if (!context.keyVersion || context.keyVersion.length > 20) throw createError('证据密钥版本无效');
    if (context.actionType === 'ACCEPT'
      && (!context.contentSha256 || !context.signatureSha256 || !context.challengeId
        || context.statementVersion !== '2.0')) {
      throw createError('签收证据不完整，不能写入证据日志', 409);
    }

    const [[previousRow]] = await connection.execute(
      `SELECT id,evidence_hash evidenceHash
       FROM salary_receipt_log
       WHERE company_id=:companyId AND salary_detail_id=:payslipId AND employee_id=:employeeId
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      {
        companyId: context.companyId,
        payslipId: context.payslipId,
        employeeId: context.employeeId
      }
    );
    const previousEvidenceHash = String(previousRow?.evidenceHash || '').toLowerCase() || null;
    if (previousEvidenceHash && !HASH_PATTERN.test(previousEvidenceHash)) {
      throw createError('上一条工资条证据日志无效，暂不能继续操作', 409);
    }
    const evidenceHash = hmac(evidenceSecret, newEvidencePayload({
      ...context,
      previousEvidenceHash
    }));
    const [insertResult] = await connection.execute(
      `INSERT INTO salary_receipt_log
       (company_id,salary_detail_id,employee_id,user_id,action_type,result_status,
        ip_address,user_agent,evidence_hash,previous_evidence_hash,payslip_content_sha256,
        signature_sha256,challenge_id,statement_version,evidence_key_version,created_at)
       VALUES (:companyId,:payslipId,:employeeId,:userId,:actionType,:resultStatus,
        :ipAddress,:userAgent,:evidenceHash,:previousEvidenceHash,:contentSha256,
        :signatureSha256,:challengeId,:statementVersion,:keyVersion,:eventAt)`,
      {
        ...context,
        ipAddress: String(input.ipAddress || '').slice(0, 50) || null,
        userAgent: String(input.userAgent || '').slice(0, 255) || null,
        previousEvidenceHash,
        evidenceHash
      }
    );
    return {
      id: Number(insertResult.insertId),
      evidenceHash,
      previousEvidenceHash
    };
  }

  return { appendEvidenceLog };
}

const service = createPayslipEvidenceLogService();

module.exports = {
  ...service,
  createPayslipEvidenceLogService,
  verifyEvidenceRows,
  HASH_PATTERN
};
