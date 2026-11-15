const assert = require('node:assert/strict');
const path = require('node:path');
const { createPayslipSignatureService } = require('../src/services/payslip-signature.service');
const payslipRouter = require('../src/routes/payslip.routes');
const uploadMiddleware = require('../src/middlewares/upload.middleware');
const { createError } = require('../src/utils/response');
const {
  buildPayslipEvidenceSnapshot,
  hashPayslipEvidenceSnapshot
} = require('../src/services/payslip-evidence-snapshot.service');

const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function createHarness(options = {}) {
  const snapshot = buildPayslipEvidenceSnapshot({
    companyId: 1,
    salaryDetailId: 901,
    salaryMonth: '2026-10',
    employeeId: 88,
    employeeName: '张三',
    customerName: '某制造公司',
    projectName: '装配项目',
    itemSnapshot: [{ label: '实发工资', value: '4800', category: 'summary', sortOrder: 1 }]
  });
  const state = {
    writes: [],
    unlinks: [],
    queries: [],
    challengeConsumed: 0,
    challengeInvalidated: 0,
    transactionCommits: 0,
    transactionRollbacks: 0,
    attachmentInsert: null,
    signatureInsert: null,
    cleanupFailures: []
  };
  const filesystem = {
    async mkdir(target, config) { state.mkdir = { target, config }; },
    async writeFile(target, buffer, config) {
      state.writes.push({ target, buffer: Buffer.from(buffer), config });
    },
    async unlink(target) {
      state.unlinks.push(target);
      if (options.unlinkFails) {
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      }
    }
  };
  const connection = {
    async execute(sql, params = {}) {
      state.queries.push({ sql, params });
      if (/FROM salary_detail d/.test(sql)) {
        const supportsDeparted = /employee_status\s+IN\s*\(2,3\)/i.test(sql);
        return [options.foreign || (options.departed && !supportsDeparted) ? [] : [{
          id: 901,
          employeeName: '张三',
          receiptStatus: 1,
          openDisputeId: null,
          activeSignatureId: null,
          evidenceSchemaVersion: '1.0',
          evidenceSnapshot: options.evidenceSnapshot ?? snapshot,
          evidenceContentSha256: options.evidenceContentSha256
            ?? hashPayslipEvidenceSnapshot(snapshot)
        }]];
      }
      if (/INSERT INTO hr_attachment/.test(sql)) {
        state.attachmentInsert = params;
        return [{ insertId: 701, affectedRows: 1 }];
      }
      if (/INSERT INTO salary_signature/.test(sql)) {
        if (options.failSignatureInsert) throw new Error('insert failed');
        state.signatureInsert = params;
        return [{ insertId: 801, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const database = {
    async transaction(handler) {
      const challengeConsumedBefore = state.challengeConsumed;
      const challengeInvalidatedBefore = state.challengeInvalidated;
      try {
        const result = await handler(connection);
        state.transactionCommits += 1;
        return result;
      } catch (error) {
        state.challengeConsumed = challengeConsumedBefore;
        state.challengeInvalidated = challengeInvalidatedBefore;
        state.transactionRollbacks += 1;
        throw error;
      }
    }
  };
  const consumeChallenge = async (_connection, context) => {
    state.challengeContext = context;
    if (options.challengeExpired) {
      throw createError('签收挑战已失效，请刷新后重试', 409, 'PAYSLIP_CHALLENGE_EXPIRED');
    }
    if (options.challengeInvalid) {
      state.challengeInvalidated += 1;
      return { consumed: false, reason: 'INVALID_CHALLENGE' };
    }
    state.challengeConsumed += 1;
    return { consumed: true, id: Number(context.challengeId), consumedAt: '2026-08-14T08:00:00.000Z' };
  };
  const service = createPayslipSignatureService({
    db: database,
    fs: filesystem,
    consumeChallenge,
    cleanupFailureReporter: context => state.cleanupFailures.push(context),
    uploadRoot: '/private/test-uploads',
    randomUUID: () => 'signature-file-id',
    now: () => new Date('2026-08-14T08:00:00.000Z')
  });
  return { service, state };
}

async function main() {
  assert.equal(typeof uploadMiddleware.singlePayslipSignature, 'function');
  const signatureRoute = payslipRouter.stack.find(layer =>
    layer.route?.path === '/me/payslips/:id/signature' && layer.route.methods.post
  );
  assert.ok(signatureRoute, '员工工资条必须注册签名上传接口');
  assert.equal(signatureRoute.route.methods.post, true);
  assert.equal(
    signatureRoute.route.stack.some(layer => layer.name === 'singlePayslipSignature'),
    true,
    '签名上传接口必须使用独立1MB PNG中间件'
  );

  const file = {
    originalname: 'signature.png',
    mimetype: 'image/png',
    size: validPng.length,
    buffer: validPng
  };
  const user = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };

  const harness = createHarness();
  const result = await harness.service.uploadMySignature(1, 901, file, {
    signedName: '张三',
    statementVersion: '2.0',
    challengeId: 1201,
    challengeToken: 'a'.repeat(43)
  }, user, { ipAddress: '127.0.0.1', deviceInfo: 'test-device' });
  assert.equal(result.signatureId, 801);
  assert.equal(result.signedName, '张三');
  assert.equal(result.statementVersion, '2.0');
  assert.equal(Object.hasOwn(result, 'challengeToken'), false);
  assert.equal(Object.hasOwn(result, 'signatureSha256'), false);
  assert.equal(harness.state.challengeConsumed, 1);
  assert.equal(harness.state.signatureInsert.challengeId, 1201);
  assert.equal(harness.state.signatureInsert.statementVersion, '2.0');
  assert.deepEqual(harness.state.challengeContext, {
    companyId: 1,
    payslipId: 901,
    employeeId: 88,
    userId: 501,
    challengeId: 1201,
    challengeToken: 'a'.repeat(43)
  });
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.writes[0].config.mode, 0o600);
  assert.equal(harness.state.writes[0].config.flag, 'wx');
  assert.equal(
    harness.state.writes[0].target,
    path.join('/private/test-uploads', 'company-1', 'payslip-signatures', 'signature-file-id.png')
  );
  const payslipQuery = harness.state.queries.find(item => /FROM salary_detail d/.test(item.sql));
  assert.deepEqual(payslipQuery.params, { companyId: 1, payslipId: 901, employeeId: 88 });
  const attachmentInsert = harness.state.queries.find(item => /INSERT INTO hr_attachment/.test(item.sql));
  assert.equal(attachmentInsert.params.bizType, 'payslip_signature');
  assert.equal(attachmentInsert.params.employeeId, 88);
  assert.equal(Object.hasOwn(result, 'storagePath'), false);

  const departedResult = await createHarness({ departed: true }).service.uploadMySignature(
    1,
    901,
    file,
    {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'a'.repeat(43)
    },
    user,
    {}
  );
  assert.equal(departedResult.signatureId, 801,
    '已离职员工应能为本人已发布工资条上传签名');

  await assert.rejects(
    () => createHarness({ foreign: true }).service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'a'.repeat(43)
    }, user, {}),
    /工资条不存在|本人/
  );
  await assert.rejects(
    () => harness.service.uploadMySignature(1, 901, { ...file, buffer: Buffer.from('fake') }, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'a'.repeat(43)
    }, user, {}),
    /PNG|签名/
  );

  const oldClient = createHarness();
  await assert.rejects(
    () => oldClient.service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '1.0'
    }, user, {}),
    error => error.businessCode === 'MINIPROGRAM_UPDATE_REQUIRED'
      && /更新小程序/.test(error.message)
  );
  assert.equal(oldClient.state.writes.length, 0, '旧客户端请求不得先写入签名文件');

  await assert.rejects(
    () => createHarness().service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '1.0',
      challengeId: 1201, challengeToken: 'a'.repeat(43)
    }, user, {}),
    /声明版本/
  );

  const malformedToken = 'raw-token-must-not-leak';
  await assert.rejects(
    () => createHarness().service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: malformedToken
    }, user, {}),
    error => /签收挑战无效/.test(error.message) && !error.message.includes(malformedToken)
  );

  const invalidChallenge = createHarness({ challengeInvalid: true });
  await assert.rejects(
    () => invalidChallenge.service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'b'.repeat(43)
    }, user, {}),
    error => /签收挑战无效/.test(error.message) && !error.message.includes('b'.repeat(43))
  );
  assert.equal(invalidChallenge.state.transactionCommits, 1,
    '错误挑战必须提交作废状态');
  assert.equal(invalidChallenge.state.challengeInvalidated, 1);
  assert.equal(invalidChallenge.state.attachmentInsert, null);
  assert.equal(invalidChallenge.state.signatureInsert, null);
  assert.equal(invalidChallenge.state.unlinks.length, 1,
    '错误挑战不得保留本次上传的PNG');

  const cleanupFailure = createHarness({ challengeInvalid: true, unlinkFails: true });
  await assert.rejects(
    () => cleanupFailure.service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'z'.repeat(43)
    }, user, {}),
    /签收挑战无效/
  );
  assert.deepEqual(cleanupFailure.state.cleanupFailures, [{
    event: 'PAYSLIP_SIGNATURE_FILE_CLEANUP_FAILED',
    companyId: 1,
    payslipId: 901,
    storagePath: path.join('company-1', 'payslip-signatures', 'signature-file-id.png'),
    errorCode: 'EACCES'
  }]);
  const cleanupReport = JSON.stringify(cleanupFailure.state.cleanupFailures);
  assert.doesNotMatch(cleanupReport, /张三|z{43}|permission denied/,
    '清理失败告警不得包含姓名、挑战凭证或底层错误原文');

  const expiredChallenge = createHarness({ challengeExpired: true });
  await assert.rejects(
    () => expiredChallenge.service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'c'.repeat(43)
    }, user, {}),
    error => /签收挑战.*失效/.test(error.message) && !error.message.includes('c'.repeat(43))
  );
  assert.equal(expiredChallenge.state.signatureInsert, null);
  assert.equal(expiredChallenge.state.unlinks.length, 1);

  const tamperedSnapshot = createHarness({ evidenceContentSha256: 'f'.repeat(64) });
  await assert.rejects(
    () => tamperedSnapshot.service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'd'.repeat(43)
    }, user, {}),
    /证据快照/
  );
  assert.equal(tamperedSnapshot.state.challengeConsumed, 0);
  assert.equal(tamperedSnapshot.state.signatureInsert, null);
  assert.equal(tamperedSnapshot.state.unlinks.length, 1);

  const rollbackHarness = createHarness({ failSignatureInsert: true });
  await assert.rejects(
    () => rollbackHarness.service.uploadMySignature(1, 901, file, {
      signedName: '张三', statementVersion: '2.0',
      challengeId: 1201, challengeToken: 'e'.repeat(43)
    }, user, {}),
    /insert failed/
  );
  assert.equal(rollbackHarness.state.unlinks.length, 1, '数据库失败后必须删除签名文件');
  assert.equal(rollbackHarness.state.challengeConsumed, 0,
    '数据库失败必须回滚挑战消费');
  assert.equal(rollbackHarness.state.transactionRollbacks, 1);

  console.log('payslip-signature-upload-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
