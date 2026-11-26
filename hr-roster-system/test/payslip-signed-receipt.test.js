const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
process.env.PAYSLIP_EVIDENCE_HMAC_SECRET = process.env.PAYSLIP_EVIDENCE_HMAC_SECRET
  || 'test-evidence-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/payslip.service');
const evidenceReceiptService = require('../src/services/payslip-evidence-receipt.service');
const {
  buildPayslipEvidenceSnapshot,
  hashPayslipEvidenceSnapshot
} = require('../src/services/payslip-evidence-snapshot.service');

const user = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };

function transactionHarness(options = {}) {
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
  const state = { updates: 0, logs: 0, detailParams: null, logParams: null };
  const connection = {
    async execute(sql, params = {}) {
      if (/FROM hr_employee/.test(sql)) return [[{ id: 88, name: '张三' }]];
      if (/SELECT d\.id,d\.receipt_status/.test(sql)) {
        state.detailParams = params;
        return [[{
          id: 901,
          receiptStatus: options.receiptStatus ?? 1,
          evidenceSchemaVersion: '1.0',
          evidenceSnapshot: snapshot,
          evidenceContentSha256: options.evidenceContentSha256
            ?? hashPayslipEvidenceSnapshot(snapshot),
          signatureId: options.foreignSignature ? null : 801,
          signatureSha256: '2'.repeat(64),
          signedName: '张三',
          signedAt: '2026-11-12 09:30:00',
          signatureStoragePath: 'company-1/payslip-signatures/signature.png',
          challengeId: 1201,
          statementVersion: options.statementVersion || '2.1',
          consumedChallengeId: options.challengeConsumed === false ? null : 1201,
          evidenceReceiptNo: (options.receiptStatus ?? 1) === 2
            ? 'PSR-20261112-ABCDEF123456'
            : null
        }]];
      }
      if (/UPDATE salary_detail/.test(sql)) {
        state.updates += 1;
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO salary_receipt_log/.test(sql)) {
        state.logs += 1;
        state.logParams = params;
        return [{ insertId: 1, affectedRows: 1 }];
      }
      if (/SELECT id,evidence_hash evidenceHash/.test(sql)) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  return { state, connection, run: handler => handler(connection) };
}

async function main() {
  const originalTransaction = db.transaction;
  const originalCreateReceipt = evidenceReceiptService.createReceipt;
  const originalRemoveReceiptFile = evidenceReceiptService.removeReceiptFile;
  let receiptCreateCalls = 0;
  const removedReceiptFiles = [];
  try {
    evidenceReceiptService.createReceipt = async (_connection, context) => {
      receiptCreateCalls += 1;
      assert.equal(context.payslipId, 901);
      assert.equal(context.employeeId, 88);
      assert.equal(context.userId, 501);
      return {
        receiptNo: 'PSR-20261112-ABCDEF123456',
        storageMode: 'DYNAMIC',
        storagePath: null,
        receiptSha256: null,
        created: true
      };
    };
    evidenceReceiptService.removeReceiptFile = async storagePath => {
      removedReceiptFiles.push(storagePath);
    };
    await assert.rejects(
      () => service.receiptMyPayslip(1, 901, { action: 'accept', signatureId: 801 }, user, {}),
      /核对|确认/
    );
    await assert.rejects(
      () => service.receiptMyPayslip(1, 901, { action: 'accept', confirmed: true }, user, {}),
      /签名/
    );

    const success = transactionHarness();
    db.transaction = success.run;
    const accepted = await service.receiptMyPayslip(1, 901, {
      action: 'accept', confirmed: true, signatureId: 801
    }, user, { ipAddress: '127.0.0.1', userAgent: 'test-device' });
    assert.equal(accepted.receiptStatus, 2);
    assert.equal(accepted.receiptNo, 'PSR-20261112-ABCDEF123456');
    assert.equal(accepted.receiptUrl, '/api/me/payslips/901/evidence-receipt');
    assert.equal(success.state.updates, 1);
    assert.equal(success.state.logs, 1);
    assert.equal(receiptCreateCalls, 1);
    assert.equal(success.state.logParams.actionType, 'ACCEPT');
    assert.equal(success.state.logParams.contentSha256.length, 64);
    assert.equal(success.state.logParams.signatureSha256, '2'.repeat(64));
    assert.equal(success.state.logParams.challengeId, 1201);
    assert.equal(success.state.logParams.statementVersion, '2.1');
    assert.equal(success.state.logParams.keyVersion, 'v2');
    assert.deepEqual(success.state.detailParams, {
      companyId: 1,
      payslipId: 901,
      employeeId: 88,
      signatureId: 801,
      userId: 501
    });

    const historical = transactionHarness({ statementVersion: '2.0' });
    db.transaction = historical.run;
    const historicalAccepted = await service.receiptMyPayslip(1, 901, {
      action: 'accept', confirmed: true, signatureId: 801
    }, user, {});
    assert.equal(historicalAccepted.receiptStatus, 2,
      '历史 2.0 签名仍应能完成签收');
    assert.equal(historical.state.logParams.statementVersion, '2.0');

    const foreign = transactionHarness({ foreignSignature: true });
    db.transaction = foreign.run;
    await assert.rejects(
      () => service.receiptMyPayslip(1, 901, {
        action: 'accept', confirmed: true, signatureId: 801
      }, user, {}),
      /签名.*工资条|签名.*本人/
    );
    assert.equal(foreign.state.updates, 0);
    assert.equal(foreign.state.logs, 0);

    for (const [options, message] of [
      [{ statementVersion: '1.0' }, /声明|证据/],
      [{ challengeConsumed: false }, /挑战|证据/],
      [{ evidenceContentSha256: 'f'.repeat(64) }, /快照|证据/]
    ]) {
      const invalidEvidence = transactionHarness(options);
      db.transaction = invalidEvidence.run;
      await assert.rejects(
        () => service.receiptMyPayslip(1, 901, {
          action: 'accept', confirmed: true, signatureId: 801
        }, user, {}),
        message
      );
      assert.equal(invalidEvidence.state.updates, 0);
      assert.equal(invalidEvidence.state.logs, 0);
    }

    const duplicate = transactionHarness({ receiptStatus: 2 });
    db.transaction = duplicate.run;
    const repeated = await service.receiptMyPayslip(1, 901, {
      action: 'accept', confirmed: true, signatureId: 801
    }, user, {});
    assert.equal(repeated.receiptStatus, 2);
    assert.equal(repeated.receiptNo, 'PSR-20261112-ABCDEF123456');
    assert.equal(repeated.receiptUrl, '/api/me/payslips/901/evidence-receipt');
    assert.equal(duplicate.state.updates, 0);
    assert.equal(duplicate.state.logs, 0, '重复签收不得重复写证据日志');
    assert.equal(receiptCreateCalls, 2, '重复签收不得重复生成电子回执');

    const rollback = transactionHarness();
    db.transaction = async handler => {
      await handler(rollback.connection);
      throw new Error('模拟事务提交失败');
    };
    await assert.rejects(
      () => service.receiptMyPayslip(1, 901, {
        action: 'accept', confirmed: true, signatureId: 801
      }, user, {}),
      /模拟事务提交失败/
    );
    assert.deepEqual(
      removedReceiptFiles,
      [],
      '动态回执不生成文件，事务失败时不得执行文件清理'
    );
  } finally {
    db.transaction = originalTransaction;
    evidenceReceiptService.createReceipt = originalCreateReceipt;
    evidenceReceiptService.removeReceiptFile = originalRemoveReceiptFile;
  }

  console.log('payslip-signed-receipt-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
