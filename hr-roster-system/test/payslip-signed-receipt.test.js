const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/payslip.service');

const user = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };

function transactionHarness(options = {}) {
  const state = { updates: 0, logs: 0, detailParams: null };
  const connection = {
    async execute(sql, params = {}) {
      if (/FROM hr_employee/.test(sql)) return [[{ id: 88, name: '张三' }]];
      if (/SELECT d\.id,d\.receipt_status/.test(sql)) {
        state.detailParams = params;
        return [[{
          id: 901,
          receiptStatus: options.receiptStatus ?? 1,
          signatureId: options.foreignSignature ? null : 801
        }]];
      }
      if (/UPDATE salary_detail/.test(sql)) {
        state.updates += 1;
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO salary_receipt_log/.test(sql)) {
        state.logs += 1;
        return [{ insertId: 1, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  return { state, run: handler => handler(connection) };
}

async function main() {
  const originalTransaction = db.transaction;
  try {
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
    assert.equal(success.state.updates, 1);
    assert.equal(success.state.logs, 1);
    assert.deepEqual(success.state.detailParams, {
      companyId: 1,
      payslipId: 901,
      employeeId: 88,
      signatureId: 801
    });

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

    const duplicate = transactionHarness({ receiptStatus: 2 });
    db.transaction = duplicate.run;
    const repeated = await service.receiptMyPayslip(1, 901, {
      action: 'accept', confirmed: true, signatureId: 801
    }, user, {});
    assert.equal(repeated.receiptStatus, 2);
    assert.equal(duplicate.state.updates, 0);
    assert.equal(duplicate.state.logs, 0, '重复签收不得重复写证据日志');
  } finally {
    db.transaction = originalTransaction;
  }

  console.log('payslip-signed-receipt-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
