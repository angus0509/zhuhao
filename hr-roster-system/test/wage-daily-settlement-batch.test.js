const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/daily-settlement.service');

const user = { id: 9, companyId: 3, dataScope: 1 };
const request = {
  projectId: 12, shiftDate: '2026-09-29', runId: 81, closureVersion: 3,
  employeeIds: [101, 102], remark: '现金日结已核对',
  clientRequestId: 'daily-pay-12-20260929-batch-1'
};

async function withTransaction(execute, callback) {
  const previous = db.transaction;
  db.transaction = async handler => handler({ execute });
  try { return await callback(); } finally { db.transaction = previous; }
}

function responder(writes, overrides = {}) {
  return async (sql, params) => {
    if (!/^\s*SELECT\b/i.test(sql)) writes.push({ sql, params });
    if (/FROM wage_daily_payment_events/.test(sql)) {
      assert.match(sql, /run_id AS runId/);
      assert.match(sql, /closure_version AS closureVersion/);
      return [overrides.events || []];
    }
    if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
    if (/FROM attendance_daily_closures/.test(sql)) {
      return [[{ id: 91, status: overrides.closureStatus || 'CONFIRMED', versionNo: overrides.closureVersion || 3 }]];
    }
    if (/FROM wage_calculation_runs/.test(sql)) return [[{ id: 81, status: 'PREVIEW', revisionNo: 2 }]];
    if (/FROM wage_calculation_daily_lines/.test(sql)) return [[
      { employeeId: 101, settlementMode: 'DAILY_PAID', calculationStatus: 'READY', earnedAmount: '180.00', attendanceClosureId: 91, attendanceClosureVersion: 3 },
      { employeeId: 102, settlementMode: 'DAILY_PAID', calculationStatus: overrides.secondStatus || 'READY', earnedAmount: '180.00', attendanceClosureId: 91, attendanceClosureVersion: 3 }
    ]];
    if (/FROM wage_daily_payments/.test(sql)) return [[]];
    if (/INSERT INTO wage_daily_payments/.test(sql)) return [{ insertId: writes.length + 100, affectedRows: 1 }];
    return [{ insertId: 1, affectedRows: 1 }];
  };
}

async function run() {
  const writes = [];
  const paid = await withTransaction(responder(writes), () => service.confirmBatch(3, user, 9, request));
  assert.deepEqual(paid, { status: 'PAID', paidCount: 2, totalAmount: '360.00' });
  assert.equal(writes.filter(item => /INSERT INTO wage_daily_payments/.test(item.sql)).length, 2);
  assert.equal(writes.filter(item => /INSERT INTO wage_daily_payment_events/.test(item.sql)).length, 2);
  assert.equal(writes.filter(item => /INSERT INTO hr_operation_log/.test(item.sql)).length, 1);

  const replayWrites = [];
  const originalEvents = [
    { employeeId: 101, amount: '180.00', actionType: 'MARK_PAID', projectId: 12,
      shiftDate: '2026-09-29', runId: 81, closureVersion: 3 },
    { employeeId: 102, amount: '180.00', actionType: 'MARK_PAID', projectId: 12,
      shiftDate: '2026-09-29', runId: 81, closureVersion: 3 }
  ];
  const replay = await withTransaction(responder(replayWrites, { events: originalEvents }), () =>
    service.confirmBatch(3, user, 9, request));
  assert.deepEqual(replay, paid);
  assert.equal(replayWrites.length, 0);

  await assert.rejects(
    withTransaction(responder([], { events: originalEvents }), () =>
      service.confirmBatch(3, user, 9, { ...request, runId: 82 })),
    error => error.businessCode === 'DAILY_REQUEST_CONFLICT'
  );
  await assert.rejects(
    withTransaction(responder([], { events: originalEvents }), () =>
      service.confirmBatch(3, user, 9, { ...request, closureVersion: 4 })),
    error => error.businessCode === 'DAILY_REQUEST_CONFLICT'
  );

  await assert.rejects(
    withTransaction(async sql => {
      if (/FROM wage_daily_payment_events/.test(sql)) return [[
        ...originalEvents
      ]];
      if (/FROM labor_project p/.test(sql)) return [[]];
      throw new Error('未授权请求不可继续');
    }, () => service.confirmBatch(3, { id: 88, companyId: 3, dataScope: 5 }, 88, request)),
    error => error.businessCode === 'PROJECT_FORBIDDEN'
  );

  const blockedWrites = [];
  await assert.rejects(
    withTransaction(responder(blockedWrites, { secondStatus: 'BLOCKED' }), () => service.confirmBatch(3, user, 9, request)),
    error => error.businessCode === 'DAILY_WAGE_BLOCKED'
  );
  assert.equal(blockedWrites.length, 0);

  await assert.rejects(
    withTransaction(responder([], { closureVersion: 4 }), () => service.confirmBatch(3, user, 9, request)),
    error => error.businessCode === 'WAGE_PREVIEW_STALE'
  );
  await assert.rejects(
    withTransaction(responder([], { closureStatus: 'OPEN' }), () => service.confirmBatch(3, user, 9, request)),
    error => error.businessCode === 'DAILY_WAGE_BLOCKED'
  );
  await assert.rejects(
    service.confirmBatch(3, user, 9, { ...request, employeeIds: Array.from({ length: 501 }, (_, index) => index + 1) }),
    error => error.businessCode === 'INVALID_DAILY_PAYMENT'
  );
  await assert.rejects(
    service.revokePayment(3, user, 9, 101, { clientRequestId: 'revoke-payment-101' }),
    error => error.businessCode === 'DAILY_PAYMENT_REMARK_REQUIRED'
  );

  const revokeWrites = [];
  const revoked = await withTransaction(async (sql, params) => {
    if (!/^\s*SELECT\b/i.test(sql)) revokeWrites.push({ sql, params });
    if (/FROM wage_daily_payments/.test(sql) && !/FOR UPDATE/.test(sql)) {
      return [[{ projectId: 12, shiftDate: '2026-09-29' }]];
    }
    if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
    if (/FROM wage_daily_payment_events/.test(sql)) return [[]];
    if (/FROM wage_daily_payments/.test(sql) && /FOR UPDATE/.test(sql)) {
      return [[{ id: 201, employeeId: 101, shiftDate: '2026-09-29', amount: '180.00', status: 'PAID' }]];
    }
    if (/FROM attendance_daily_closures/.test(sql)) return [[{ versionNo: 3 }]];
    return [{ insertId: 301, affectedRows: 1 }];
  }, () => service.revokePayment(3, user, 9, 201, {
    reason: '现金登记有误', clientRequestId: 'daily-revoke-201-20260929'
  }));
  assert.deepEqual(revoked, { paymentId: 201, status: 'REVOKED', amount: '180.00' });
  const update = revokeWrites.find(item => /UPDATE wage_daily_payments/.test(item.sql));
  assert.ok(update);
  assert.doesNotMatch(update.sql, /paid_by\s*=|paid_at\s*=|amount\s*=/);
  assert.ok(revokeWrites.some(item => /INSERT INTO wage_daily_payment_events/.test(item.sql)));
}

run().then(() => console.log('wage-daily-settlement-batch-tests-ok')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
