const crypto = require('node:crypto');
const db = require('../db');
const env = require('../config/env');
const { createError } = require('../utils/response');
const { hashPayslipEvidenceSnapshot } = require('./payslip-evidence-snapshot.service');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function employeeIdFromUser(user) {
  const employeeId = Number(user?.employeeId || 0);
  if (user?.accountType !== 'EMPLOYEE' || !Number.isSafeInteger(employeeId) || employeeId <= 0) {
    throw createError('仅员工本人可以申请工资条签收挑战', 403);
  }
  return employeeId;
}

function positiveInteger(value, message) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw createError(message);
  return result;
}

function parseSnapshot(value) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || ''));
  } catch (_error) {
    throw createError('工资条证据快照无效，暂不能签收', 409);
  }
}

function createPayslipSignChallengeService(dependencies = {}) {
  const database = dependencies.db || db;
  const evidenceSecret = dependencies.evidenceSecret ?? env.payslipEvidence.hmacSecret;
  const challengeTtlSeconds = Number(dependencies.challengeTtlSeconds ?? env.payslipEvidence.challengeTtlSeconds);
  const randomBytes = dependencies.randomBytes || crypto.randomBytes;
  const now = dependencies.now || (() => new Date());

  function assertSecret() {
    if (Buffer.byteLength(String(evidenceSecret || ''), 'utf8') < 32) {
      throw createError('工资条证据服务配置不完整', 503, 'PAYSLIP_EVIDENCE_NOT_CONFIGURED');
    }
  }

  function challengeHash({ companyId, payslipId, employeeId, userId, challengeToken }) {
    return crypto.createHmac('sha256', evidenceSecret)
      .update(['payslip-sign-challenge', companyId, payslipId, employeeId, userId, challengeToken].join('|'))
      .digest('hex');
  }

  async function issueChallenge(companyId, payslipId, user) {
    assertSecret();
    const normalizedCompanyId = positiveInteger(companyId, '企业参数无效');
    const normalizedPayslipId = positiveInteger(payslipId, '工资条参数无效');
    const employeeId = employeeIdFromUser(user);
    const userId = positiveInteger(user?.id, '员工账号参数无效');
    const challengeToken = randomBytes(32).toString('base64url');
    if (!TOKEN_PATTERN.test(challengeToken)) throw createError('签收挑战生成失败，请重试', 503);
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + challengeTtlSeconds * 1000);
    const hash = challengeHash({
      companyId: normalizedCompanyId,
      payslipId: normalizedPayslipId,
      employeeId,
      userId,
      challengeToken
    });

    const result = await database.transaction(async connection => {
      const [[row]] = await connection.execute(
        `SELECT d.id,d.receipt_status receiptStatus,b.batch_status batchStatus,
                d.evidence_schema_version evidenceSchemaVersion,
                d.evidence_snapshot evidenceSnapshot,d.evidence_content_sha256 evidenceContentSha256,
                dispute.id openDisputeId
         FROM salary_detail d
         JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
         JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
           AND e.employee_status IN (2,3) AND e.deleted_at IS NULL
         LEFT JOIN salary_dispute dispute ON dispute.company_id=d.company_id
           AND dispute.salary_detail_id=d.id AND dispute.employee_id=d.employee_id
           AND dispute.handle_status IN (0,1)
         WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
         LIMIT 1 FOR UPDATE`,
        { companyId: normalizedCompanyId, payslipId: normalizedPayslipId, employeeId }
      );
      if (!row) throw createError('工资条不存在或无本人访问权限', 404);
      if (Number(row.batchStatus) !== 5 || Number(row.receiptStatus) !== 1) {
        throw createError('工资条当前状态不能签收', 409);
      }
      if (Number(row.openDisputeId || 0) > 0) throw createError('工资条异议处理中，不能签收', 409);
      const snapshot = parseSnapshot(row.evidenceSnapshot);
      const storedHash = String(row.evidenceContentSha256 || '').toLowerCase();
      if (row.evidenceSchemaVersion !== '1.0' || snapshot?.schemaVersion !== '1.0'
        || !/^[a-f0-9]{64}$/.test(storedHash) || hashPayslipEvidenceSnapshot(snapshot) !== storedHash) {
        throw createError('工资条证据快照无效，暂不能签收', 409);
      }

      await connection.execute(
        `UPDATE salary_sign_challenge SET status=0,updated_at=:issuedAt
         WHERE company_id=:companyId AND salary_detail_id=:payslipId
           AND employee_id=:employeeId AND user_id=:userId
           AND status=1 AND consumed_at IS NULL`,
        {
          companyId: normalizedCompanyId,
          payslipId: normalizedPayslipId,
          employeeId,
          userId,
          issuedAt
        }
      );
      const [insertResult] = await connection.execute(
        `INSERT INTO salary_sign_challenge
         (company_id,salary_detail_id,employee_id,user_id,challenge_hash,status,expires_at,created_at,updated_at)
         VALUES (:companyId,:payslipId,:employeeId,:userId,:challengeHash,1,:expiresAt,:issuedAt,:issuedAt)`,
        {
          companyId: normalizedCompanyId,
          payslipId: normalizedPayslipId,
          employeeId,
          userId,
          challengeHash: hash,
          expiresAt,
          issuedAt
        }
      );
      return { challengeId: Number(insertResult.insertId) };
    });

    return { ...result, challengeToken, expiresIn: challengeTtlSeconds };
  }

  async function consumeChallenge(connection, context = {}) {
    assertSecret();
    const companyId = positiveInteger(context.companyId, '企业参数无效');
    const payslipId = positiveInteger(context.payslipId, '工资条参数无效');
    const employeeId = positiveInteger(context.employeeId, '员工参数无效');
    const userId = positiveInteger(context.userId, '员工账号参数无效');
    const challengeId = positiveInteger(context.challengeId, '签收挑战无效');
    const challengeToken = String(context.challengeToken || '').trim();
    if (!TOKEN_PATTERN.test(challengeToken)) throw createError('签收挑战无效，请刷新后重试', 409);

    const [[row]] = await connection.execute(
      `SELECT id,challenge_hash challengeHash,status,expires_at expiresAt,consumed_at consumedAt
       FROM salary_sign_challenge
       WHERE id=:challengeId AND company_id=:companyId AND salary_detail_id=:payslipId
         AND employee_id=:employeeId AND user_id=:userId
         AND status=1 AND consumed_at IS NULL AND expires_at>NOW()
       LIMIT 1 FOR UPDATE`,
      { companyId, payslipId, employeeId, userId, challengeId }
    );
    const consumedAt = now();
    if (!row) {
      throw createError('签收挑战已失效，请刷新后重试', 409, 'PAYSLIP_CHALLENGE_EXPIRED');
    }

    const expected = Buffer.from(challengeHash({
      companyId, payslipId, employeeId, userId, challengeToken
    }), 'hex');
    const stored = Buffer.from(String(row.challengeHash || ''), 'hex');
    const valid = stored.length === expected.length && crypto.timingSafeEqual(stored, expected);
    if (!valid) {
      await connection.execute(
        `UPDATE salary_sign_challenge SET status=0,updated_at=:consumedAt
         WHERE id=:challengeId AND company_id=:companyId AND status=1`,
        { challengeId, companyId, consumedAt }
      );
      return { consumed: false, reason: 'INVALID_CHALLENGE' };
    }

    const [updateResult] = await connection.execute(
      `UPDATE salary_sign_challenge SET status=0,consumed_at=:consumedAt,updated_at=:consumedAt
       WHERE id=:challengeId AND company_id=:companyId AND status=1 AND consumed_at IS NULL`,
      { challengeId, companyId, consumedAt }
    );
    if (!updateResult.affectedRows) throw createError('签收挑战已失效，请刷新后重试', 409);
    return { consumed: true, id: Number(row.id), consumedAt: consumedAt.toISOString() };
  }

  return { issueChallenge, consumeChallenge };
}

const service = createPayslipSignChallengeService();

module.exports = {
  ...service,
  createPayslipSignChallengeService,
  TOKEN_PATTERN
};
