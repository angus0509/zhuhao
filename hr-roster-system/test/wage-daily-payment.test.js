const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/wage-calculation.service');

const user = { id: 9, companyId: 3, dataScope: 1 };

async function withTransaction(execute, callback) {
  const original = db.transaction;
  db.transaction = async handler => handler({ execute });
  try {
    return await callback();
  } finally {
    db.transaction = original;
  }
}

async function run() {
  const writes = [];
  const paid = await withTransaction(async (sql, params) => {
    writes.push({ sql, params });
    if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
    if (/FROM wage_calculation_daily_lines line/.test(sql)) return [[{
      employeeId: 101, shiftDate: '2026-10-08', settlementMode: 'DAILY_PAID',
      earnedAmount: '226.00', calculationStatus: 'READY'
    }]];
    if (/FROM wage_daily_payments/.test(sql) && /FOR UPDATE/.test(sql)) return [[]];
    return [{ insertId: 71, affectedRows: 1 }];
  }, () => service.setDailyPayment(3, user, 9, {
    projectId: 12, employeeId: 101, shiftDate: '2026-10-08',
    action: 'MARK_PAID', remark: '现金日结已确认'
  }));
  assert.deepEqual(paid, { employeeId: 101, shiftDate: '2026-10-08', status: 'PAID', amount: '226.00' });
  assert.ok(writes.some(item => /INSERT INTO wage_daily_payments/.test(item.sql)));
  assert.ok(writes.some(item => /UPDATE wage_calculation_runs SET status='CANCELLED'/.test(item.sql)));
  assert.ok(writes.some(item => /INSERT INTO hr_operation_log/.test(item.sql)));
  const lineQuery = writes.find(item => /FROM wage_calculation_daily_lines line/.test(item.sql));
  assert.match(lineQuery.sql, /run\.status IN \('PREVIEW','CANCELLED'\)/);

  let paymentWrites = 0;
  const duplicate = await withTransaction(async sql => {
    if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
    if (/FROM wage_calculation_daily_lines line/.test(sql)) return [[{
      employeeId: 101, shiftDate: '2026-10-08', settlementMode: 'DAILY_PAID',
      earnedAmount: '226.00', calculationStatus: 'READY'
    }]];
    if (/FROM wage_daily_payments/.test(sql) && /FOR UPDATE/.test(sql)) {
      return [[{ id: 71, status: 'PAID', amount: '226.00' }]];
    }
    if (/INSERT INTO wage_daily_payments|UPDATE wage_daily_payments/.test(sql)) paymentWrites += 1;
    return [{ affectedRows: 1 }];
  }, () => service.setDailyPayment(3, user, 9, {
    projectId: 12, employeeId: 101, shiftDate: '2026-10-08', action: 'MARK_PAID'
  }));
  assert.equal(duplicate.status, 'PAID');
  assert.equal(paymentWrites, 0, '重复标记已支付必须幂等');

  await assert.rejects(
    service.setDailyPayment(3, user, 9, {
      projectId: 12, employeeId: 101, shiftDate: '2026-10-08', action: 'REVOKE'
    }),
    error => error.businessCode === 'DAILY_PAYMENT_REMARK_REQUIRED'
  );

  const revokeWrites = [];
  const revoked = await withTransaction(async (sql, params) => {
    revokeWrites.push({ sql, params });
    if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
    if (/FROM wage_calculation_daily_lines line/.test(sql)) return [[{
      employeeId: 101, shiftDate: '2026-10-08', settlementMode: 'DAILY_PAID',
      earnedAmount: '226.00', calculationStatus: 'READY'
    }]];
    if (/FROM wage_daily_payments/.test(sql) && /FOR UPDATE/.test(sql)) {
      return [[{ id: 71, status: 'PAID', amount: '226.00' }]];
    }
    return [{ affectedRows: 1 }];
  }, () => service.setDailyPayment(3, user, 9, {
    projectId: 12, employeeId: 101, shiftDate: '2026-10-08',
    action: 'REVOKE', remark: '现金登记有误'
  }));
  assert.equal(revoked.status, 'REVOKED');
  const revokeUpdate = revokeWrites.find(item => /UPDATE wage_daily_payments SET status='REVOKED'/.test(item.sql));
  assert.equal(revokeUpdate.params.remark, '现金登记有误');
  assert.ok(revokeWrites.some(item => /INSERT INTO hr_operation_log/.test(item.sql)));
}

run().then(() => console.log('wage-daily-payment.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
