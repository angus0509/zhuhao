const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';

const {
  createPayslipEvidenceLogService,
  verifyEvidenceRows
} = require('../src/services/payslip-evidence-log.service');
const { run } = require('../scripts/verify-payslip-evidence-chain');

const EVIDENCE_SECRET = 'test-evidence-chain-secret-at-least-32-bytes';
const LEGACY_SECRET = 'test-legacy-jwt-secret-at-least-32-bytes';
const CONTENT_HASH = '1'.repeat(64);
const SIGNATURE_HASH = '2'.repeat(64);

function createHarness() {
  const state = { rows: [], queries: [] };
  const connection = {
    async execute(sql, params = {}) {
      state.queries.push({ sql, params });
      if (/SELECT id,evidence_hash evidenceHash/.test(sql)) {
        const last = state.rows.at(-1);
        return [last ? [{ id: last.id, evidenceHash: last.evidenceHash }] : []];
      }
      if (/INSERT INTO salary_receipt_log/.test(sql)) {
        const row = {
          id: state.rows.length + 1,
          companyId: params.companyId,
          payslipId: params.payslipId,
          employeeId: params.employeeId,
          userId: params.userId,
          actionType: params.actionType,
          resultStatus: params.resultStatus,
          evidenceHash: params.evidenceHash,
          previousEvidenceHash: params.previousEvidenceHash,
          payslipContentSha256: params.contentSha256,
          signatureSha256: params.signatureSha256,
          challengeId: params.challengeId,
          statementVersion: params.statementVersion,
          evidenceKeyVersion: params.keyVersion,
          createdAt: params.eventAt
        };
        state.rows.push(row);
        return [{ insertId: row.id, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const service = createPayslipEvidenceLogService({
    evidenceSecret: EVIDENCE_SECRET,
    keyVersion: 'v1'
  });
  return { state, connection, service };
}

function legacyHash(row) {
  return crypto.createHmac('sha256', LEGACY_SECRET)
    .update([
      row.companyId,
      row.payslipId,
      row.employeeId,
      row.userId,
      row.actionType,
      row.resultStatus,
      row.createdAt.toISOString()
    ].join('|'))
    .digest('hex');
}

async function main() {
  const harness = createHarness();
  const first = await harness.service.appendEvidenceLog(harness.connection, {
    companyId: 1,
    payslipId: 901,
    employeeId: 88,
    userId: 501,
    actionType: 'VIEW',
    resultStatus: 1,
    eventAt: new Date('2026-11-12T08:00:00.000Z'),
    contentSha256: CONTENT_HASH,
    ipAddress: '127.0.0.1',
    userAgent: 'test-device'
  });
  assert.equal(first.previousEvidenceHash, null);
  assert.match(first.evidenceHash, /^[a-f0-9]{64}$/);

  const second = await harness.service.appendEvidenceLog(harness.connection, {
    companyId: 1,
    payslipId: 901,
    employeeId: 88,
    userId: 501,
    actionType: 'ACCEPT',
    resultStatus: 2,
    eventAt: new Date('2026-11-12T08:05:00.000Z'),
    contentSha256: CONTENT_HASH,
    signatureSha256: SIGNATURE_HASH,
    challengeId: 1201,
    statementVersion: '2.0'
  });
  assert.equal(second.previousEvidenceHash, first.evidenceHash);
  assert.equal(harness.state.rows[0].snapshot, undefined,
    '证据日志不得保存原始工资条快照');
  const lockQuery = harness.state.queries.find(item => /SELECT id,evidence_hash/.test(item.sql));
  assert.match(lockQuery.sql, /ORDER BY id DESC LIMIT 1 FOR UPDATE/);
  assert.deepEqual(lockQuery.params, { companyId: 1, payslipId: 901, employeeId: 88 });

  const secretResolver = version => version === 'v1' ? EVIDENCE_SECRET : LEGACY_SECRET;
  const verified = verifyEvidenceRows(harness.state.rows, secretResolver);
  assert.deepEqual(verified, {
    valid: true,
    checked: 2,
    errors: [],
    chainHead: second.evidenceHash
  });

  const tampered = structuredClone(harness.state.rows);
  tampered[0].resultStatus = 9;
  const tamperedResult = verifyEvidenceRows(tampered, secretResolver);
  assert.equal(tamperedResult.valid, false);
  assert.equal(tamperedResult.errors.some(error => error.code === 'HASH_MISMATCH'), true);

  const missing = verifyEvidenceRows([harness.state.rows[1]], secretResolver);
  assert.equal(missing.valid, false);
  assert.equal(missing.errors.some(error => error.code === 'CHAIN_GAP'), true);

  await assert.rejects(
    () => harness.service.appendEvidenceLog(harness.connection, {
      companyId: 1,
      payslipId: 901,
      employeeId: 88,
      userId: 501,
      actionType: 'ACCEPT',
      resultStatus: 2,
      eventAt: new Date('2026-11-12T08:06:00.000Z'),
      contentSha256: CONTENT_HASH,
      signatureSha256: SIGNATURE_HASH,
      statementVersion: '2.0'
    }),
    /挑战|证据/
  );

  const legacyOriginalEventAt = new Date('2026-10-01T08:00:00.789Z');
  const legacy = {
    id: 10,
    companyId: 1,
    payslipId: 901,
    employeeId: 88,
    userId: 501,
    actionType: 'VIEW',
    resultStatus: 1,
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    previousEvidenceHash: null,
    evidenceKeyVersion: null,
    payslipContentSha256: null,
    signatureSha256: null,
    challengeId: null,
    statementVersion: null
  };
  legacy.evidenceHash = legacyHash({ ...legacy, createdAt: legacyOriginalEventAt });
  assert.equal(verifyEvidenceRows([legacy], secretResolver).valid, true,
    '历史日志必须兼容数据库DATETIME丢失毫秒后的旧JWT哈希验真');

  const empty = verifyEvidenceRows([], secretResolver);
  assert.equal(empty.valid, false, '没有证据日志时不能报告链验证通过');
  assert.equal(empty.errors.some(error => error.code === 'NO_EVIDENCE_ROWS'), true);

  let cliSql = '';
  let cliParams = null;
  const cliOutput = [];
  const cliCode = await run({
    argv: ['--company-id', '1', '--payslip-id', '901'],
    query: async (sql, params) => {
      cliSql = sql;
      cliParams = params;
      return harness.state.rows;
    },
    secretResolver,
    output: line => cliOutput.push(line)
  });
  assert.equal(cliCode, 0);
  assert.match(cliSql, /^\s*SELECT\b/i);
  assert.doesNotMatch(cliSql, /\b(?:UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/i);
  assert.deepEqual(cliParams, { companyId: 1, payslipId: 901 });
  const cliPayload = JSON.parse(cliOutput[0]);
  assert.deepEqual(cliPayload.ids, [1, 2]);
  assert.equal(cliPayload.valid, true);
  assert.equal(cliPayload.chainHead, second.evidenceHash);
  assert.doesNotMatch(cliOutput[0], /实发工资|4800|itemSnapshot|evidenceSnapshot/);

  const invalidCode = await run({
    argv: ['--company-id', '1', '--payslip-id', '901'],
    query: async () => tampered,
    secretResolver,
    output: () => {}
  });
  assert.equal(invalidCode, 1);

  console.log('payslip-evidence-log-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
