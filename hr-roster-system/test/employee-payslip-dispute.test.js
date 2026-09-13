const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/payslip.service');
const payslipRouter = require('../src/routes/payslip.routes');

const user = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };

function createHarness(options = {}) {
  const state = { inserts: 0, updates: 0, logs: 0, selectParams: null };
  const connection = {
    async execute(sql, params = {}) {
      if (/FROM hr_employee/.test(sql)) return [[{ id: 88, name: '张三' }]];
      if (/FROM salary_detail d/.test(sql)) {
        state.selectParams = params;
        return [[{
          id: 901,
          receiptStatus: options.receiptStatus ?? 1,
          activeSignatureId: options.activeSignatureId || null,
          openDisputeId: options.openDisputeId || null,
          existingReason: options.existingReason || null
        }]];
      }
      if (/INSERT INTO salary_dispute/.test(sql)) {
        state.inserts += 1;
        return [{ insertId: 701, affectedRows: 1 }];
      }
      if (/UPDATE salary_detail/.test(sql)) {
        state.updates += 1;
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO salary_receipt_log/.test(sql)) {
        state.logs += 1;
        assert.equal(params.actionType, 'DISPUTE');
        return [{ insertId: 1, affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  return { state, run: handler => handler(connection) };
}

async function main() {
  const disputeRoute = payslipRouter.stack.find(layer => layer.route?.path === '/me/payslips/:id/dispute');
  assert.ok(disputeRoute, '员工工资条必须注册异议提交接口');
  assert.equal(disputeRoute.route.methods.post, true);

  const originalTransaction = db.transaction;
  try {
    await assert.rejects(
      () => service.disputeMyPayslip(1, 901, { reason: '太短' }, user, {}),
      /10.*500/
    );
    await assert.rejects(
      () => service.disputeMyPayslip(1, 901, { reason: '工'.repeat(501) }, user, {}),
      /10.*500/
    );

    const success = createHarness();
    db.transaction = success.run;
    const reason = '本月加班工时与实际记录不一致，请核对。';
    const result = await service.disputeMyPayslip(1, 901, { reason }, user, {
      ipAddress: '127.0.0.1', userAgent: 'test-device'
    });
    assert.deepEqual(result, {
      disputeId: 701,
      handleStatus: 0,
      handleStatusName: '待处理'
    });
    assert.deepEqual(success.state.selectParams, { companyId: 1, payslipId: 901, employeeId: 88 });
    assert.equal(success.state.inserts, 1);
    assert.equal(success.state.updates, 1);
    assert.equal(success.state.logs, 1);

    const signed = createHarness({ receiptStatus: 2, activeSignatureId: 801 });
    db.transaction = signed.run;
    await assert.rejects(
      () => service.disputeMyPayslip(1, 901, { reason }, user, {}),
      /已签收|不能.*异议/
    );
    assert.equal(signed.state.inserts, 0);

    const duplicate = createHarness({
      receiptStatus: 3,
      openDisputeId: 701,
      existingReason: reason
    });
    db.transaction = duplicate.run;
    const repeated = await service.disputeMyPayslip(1, 901, { reason }, user, {});
    assert.deepEqual(repeated, {
      disputeId: 701,
      handleStatus: 0,
      handleStatusName: '待处理'
    });
    assert.equal(duplicate.state.inserts, 0);
    assert.equal(duplicate.state.logs, 0);
  } finally {
    db.transaction = originalTransaction;
  }

  console.log('employee-payslip-dispute-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
