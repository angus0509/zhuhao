const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  createPayslipSignChallengeService
} = require('../src/services/payslip-sign-challenge.service');
const signChallengeService = require('../src/services/payslip-sign-challenge.service');
const payslipController = require('../src/controllers/payslip.controller');
const payslipRouter = require('../src/routes/payslip.routes');
const { sensitiveLimiter } = require('../src/middlewares/rate-limit.middleware');
const {
  buildPayslipEvidenceSnapshot,
  hashPayslipEvidenceSnapshot
} = require('../src/services/payslip-evidence-snapshot.service');

const EVIDENCE_SECRET = 'test-payslip-evidence-secret-at-least-32-bytes';
const NOW = new Date('2026-11-12T08:00:00.000Z');
const employeeUser = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };

function evidenceRow(overrides = {}) {
  const source = {
    companyId: 1,
    salaryDetailId: 901,
    salaryMonth: '2026-10',
    employeeId: 88,
    employeeName: '张三',
    customerName: '某制造公司',
    projectName: '装配项目',
    itemSnapshot: [{ label: '实发工资', value: '4800', category: 'summary', sortOrder: 1 }]
  };
  const snapshot = buildPayslipEvidenceSnapshot(source);
  return {
    id: 901,
    batchStatus: 5,
    receiptStatus: 1,
    openDisputeId: null,
    evidenceSchemaVersion: '1.0',
    evidenceSnapshot: snapshot,
    evidenceContentSha256: hashPayslipEvidenceSnapshot(snapshot),
    ...overrides
  };
}

function createHarness(options = {}) {
  const state = { queries: [], updates: [], insert: null, challengeHash: null };
  const connection = {
    async execute(sql, params = {}) {
      state.queries.push({ sql, params });
      if (/FROM salary_detail d/.test(sql)) {
        const ownsPayslip = Number(params.companyId) === 1
          && Number(params.payslipId) === 901
          && Number(params.employeeId) === 88;
        return [options.missingPayslip || !ownsPayslip ? [] : [evidenceRow(options.payslip || {})]];
      }
      if (/UPDATE salary_sign_challenge/.test(sql)) {
        state.updates.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO salary_sign_challenge/.test(sql)) {
        state.insert = params;
        state.challengeHash = params.challengeHash;
        return [{ insertId: 1201, affectedRows: 1 }];
      }
      if (/FROM salary_sign_challenge/.test(sql)) {
        const ownershipMatches = Number(params.companyId) === 1
          && Number(params.payslipId) === 901
          && Number(params.employeeId) === 88
          && Number(params.userId) === 501
          && Number(params.challengeId) === 1201;
        const expired = options.expiresAt && new Date(options.expiresAt).getTime() <= NOW.getTime();
        if (!ownershipMatches || options.challengeMissing || expired || options.consumedAt
          || Number(options.challengeStatus ?? 1) !== 1) return [[]];
        return [[{
          id: 1201,
          challengeHash: state.challengeHash || options.challengeHash,
          status: options.challengeStatus ?? 1,
          expiresAt: options.expiresAt || new Date(NOW.getTime() + 300000),
          consumedAt: options.consumedAt || null
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const database = { transaction: async handler => handler(connection) };
  const service = createPayslipSignChallengeService({
    db: database,
    evidenceSecret: EVIDENCE_SECRET,
    challengeTtlSeconds: 300,
    randomBytes: () => Buffer.alloc(32, 7),
    now: () => new Date(NOW)
  });
  return { service, connection, state };
}

async function main() {
  const route = payslipRouter.stack.find(layer =>
    layer.route?.path === '/me/payslips/:id/sign-challenge' && layer.route.methods.post
  );
  assert.ok(route, '员工工资条必须注册一次性签收挑战接口');
  assert.equal(route.route.stack[0].handle, sensitiveLimiter);

  const harness = createHarness();
  const issued = await harness.service.issueChallenge(1, 901, employeeUser);
  assert.equal(issued.challengeId, 1201);
  assert.match(issued.challengeToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.expiresIn, 300);
  assert.match(harness.state.insert.challengeHash, /^[a-f0-9]{64}$/);
  assert.equal(harness.state.insert.challengeHash.length, 64);
  assert.doesNotMatch(JSON.stringify(harness.state.queries), new RegExp(issued.challengeToken));
  assert.equal(Object.hasOwn(issued, 'challengeHash'), false);

  const originalIssueChallenge = signChallengeService.issueChallenge;
  let responsePayload = null;
  signChallengeService.issueChallenge = async () => ({
    challengeId: 1201,
    challengeToken: issued.challengeToken,
    expiresIn: 300,
    challengeHash: 'a'.repeat(64),
    challenge_hash: 'b'.repeat(64)
  });
  try {
    await payslipController.issueSignChallengeMine(
      { companyId: 1, params: { id: '901' }, user: employeeUser },
      { json(payload) { responsePayload = payload; return payload; } },
      error => { throw error; }
    );
  } finally {
    signChallengeService.issueChallenge = originalIssueChallenge;
  }
  assert.deepEqual(responsePayload.data, {
    challengeId: 1201,
    challengeToken: issued.challengeToken,
    expiresIn: 300
  });
  assert.equal(Object.hasOwn(responsePayload.data, 'challengeHash'), false);
  assert.equal(Object.hasOwn(responsePayload.data, 'challenge_hash'), false);

  const consumed = await harness.service.consumeChallenge(harness.connection, {
    companyId: 1,
    payslipId: 901,
    employeeId: 88,
    userId: 501,
    challengeId: 1201,
    challengeToken: issued.challengeToken
  });
  assert.equal(consumed.consumed, true);
  assert.equal(consumed.id, 1201);
  assert.equal(harness.state.updates.some(item => /consumed_at/.test(item.sql)), true);
  assert.equal(harness.state.queries.some(item => /expires_at>NOW\(\)/.test(item.sql)), true,
    '挑战有效期必须由数据库时钟判断');

  await assert.rejects(
    () => createHarness({ missingPayslip: true }).service.issueChallenge(1, 901, employeeUser),
    /不存在|本人/
  );
  await assert.rejects(
    () => createHarness({ payslip: { evidenceSnapshot: null, evidenceContentSha256: null } })
      .service.issueChallenge(1, 901, employeeUser),
    /证据快照/
  );
  await assert.rejects(
    () => createHarness({ payslip: { evidenceSchemaVersion: '0.9' } })
      .service.issueChallenge(1, 901, employeeUser),
    /证据快照/
  );
  await assert.rejects(
    () => createHarness({ payslip: { receiptStatus: 2 } }).service.issueChallenge(1, 901, employeeUser),
    /状态.*签收|不能签收/
  );
  await assert.rejects(
    () => createHarness({ payslip: { openDisputeId: 77 } }).service.issueChallenge(1, 901, employeeUser),
    /异议/
  );
  await assert.rejects(
    () => createHarness().service.issueChallenge(1, 901, { ...employeeUser, employeeId: 99 }),
    /不存在|本人/
  );

  const expired = createHarness({ expiresAt: new Date(NOW.getTime() - 1000) });
  expired.state.challengeHash = crypto.createHmac('sha256', EVIDENCE_SECRET)
    .update(['payslip-sign-challenge', 1, 901, 88, 501, 'a'.repeat(43)].join('|'))
    .digest('hex');
  await assert.rejects(
    () => expired.service.consumeChallenge(expired.connection, {
      companyId: 1, payslipId: 901, employeeId: 88, userId: 501,
      challengeId: 1201, challengeToken: 'a'.repeat(43)
    }),
    /失效|过期/
  );

  const wrong = createHarness();
  const correct = await wrong.service.issueChallenge(1, 901, employeeUser);
  const invalid = await wrong.service.consumeChallenge(wrong.connection, {
    companyId: 1, payslipId: 901, employeeId: 88, userId: 501,
    challengeId: 1201, challengeToken: 'b'.repeat(43)
  });
  assert.deepEqual(invalid, { consumed: false, reason: 'INVALID_CHALLENGE' });
  assert.equal(wrong.state.updates.some(item => /SET status=0/.test(item.sql)), true);
  assert.notEqual(correct.challengeToken, 'b'.repeat(43));

  await assert.rejects(
    () => harness.service.consumeChallenge(harness.connection, {
      companyId: 1, payslipId: 902, employeeId: 88, userId: 501,
      challengeId: 1201, challengeToken: issued.challengeToken
    }),
    /失效|无效/
  );
  for (const contextOverride of [
    { companyId: 2 },
    { employeeId: 89 },
    { userId: 502 }
  ]) {
    const mismatch = createHarness();
    const mismatchIssued = await mismatch.service.issueChallenge(1, 901, employeeUser);
    const updateCount = mismatch.state.updates.length;
    await assert.rejects(
      () => mismatch.service.consumeChallenge(mismatch.connection, {
        companyId: 1, payslipId: 901, employeeId: 88, userId: 501,
        challengeId: 1201, challengeToken: mismatchIssued.challengeToken,
        ...contextOverride
      }),
      /失效|无效/
    );
    assert.equal(mismatch.state.updates.length, updateCount,
      '归属不匹配时不得执行挑战消费或作废更新');
  }
  const inactive = createHarness({ challengeStatus: 0 });
  const inactiveIssued = await inactive.service.issueChallenge(1, 901, employeeUser);
  const inactiveUpdateCount = inactive.state.updates.length;
  await assert.rejects(
    () => inactive.service.consumeChallenge(inactive.connection, {
      companyId: 1, payslipId: 901, employeeId: 88, userId: 501,
      challengeId: 1201, challengeToken: inactiveIssued.challengeToken
    }),
    /失效|无效/
  );
  assert.equal(inactive.state.updates.length, inactiveUpdateCount,
    '已作废挑战不得再次消费或更新');
  const duplicate = createHarness({ consumedAt: NOW });
  const duplicateIssued = await duplicate.service.issueChallenge(1, 901, employeeUser);
  await assert.rejects(
    () => duplicate.service.consumeChallenge(duplicate.connection, {
      companyId: 1, payslipId: 901, employeeId: 88, userId: 501,
      challengeId: 1201, challengeToken: duplicateIssued.challengeToken
    }),
    /失效|使用/
  );

  console.log('payslip-sign-challenge-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
