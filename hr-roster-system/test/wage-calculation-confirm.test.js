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
  const repeated = await withTransaction(async sql => {
    if (/FROM wage_calculation_runs run/.test(sql)) return [[{
      runId: 80, projectId: 12, salaryMonth: '2026-10', revisionNo: 1,
      status: 'CONFIRMED', blockedCount: 0, salaryBatchId: 205
    }]];
    throw new Error(`幂等确认不应继续执行: ${sql}`);
  }, () => service.confirmPreview(3, user, 9, 80));
  assert.deepEqual(repeated, { runId: 80, salaryBatchId: 205, batchStatus: 3 });

  await withTransaction(async sql => {
    if (/FROM wage_calculation_runs run/.test(sql)) return [[{
      runId: 81, projectId: 12, salaryMonth: '2026-10', revisionNo: 2,
      status: 'PREVIEW', blockedCount: 1, salaryBatchId: null
    }]];
    return [[]];
  }, () => assert.rejects(
    service.confirmPreview(3, user, 9, 81),
    error => error.businessCode === 'WAGE_PREVIEW_BLOCKED'
  ));

  const writes = [];
  const confirmed = await withTransaction(async (sql, params) => {
    writes.push({ sql, params });
    if (/FROM wage_calculation_runs run/.test(sql)) return [[{
      runId: 81, projectId: 12, salaryMonth: '2026-10', revisionNo: 2,
      status: 'PREVIEW', blockedCount: 0, salaryBatchId: null
    }]];
    if (/FROM salary_batch/.test(sql) && /calculation_run_id/.test(sql)) return [[]];
    if (/SELECT id FROM wage_calculation_runs/.test(sql)) return [[{ id: 81 }]];
    if (/FROM wage_calculation_daily_lines line/.test(sql)) return [[
      { employeeId: 101, shiftDate: '2026-10-08', shiftType: 'NIGHT', workedMinutes: 465,
        payableMinutes: 480, hourlyRate: '23.00', allowanceAmount: '42.00', earnedAmount: '226.00',
        dailyPaidAmount: '100.00', payableAmount: '126.00' },
      { employeeId: 101, shiftDate: '2026-10-09', shiftType: 'NIGHT', workedMinutes: 480,
        payableMinutes: 480, hourlyRate: '23.00', allowanceAmount: '42.00', earnedAmount: '226.00',
        dailyPaidAmount: '0.00', payableAmount: '226.00' }
    ]];
    if (/INSERT INTO salary_batch/.test(sql)) return [{ insertId: 206, affectedRows: 1 }];
    return [{ affectedRows: 1 }];
  }, () => service.confirmPreview(3, user, 9, 81));
  assert.deepEqual(confirmed, { runId: 81, salaryBatchId: 206, batchStatus: 3 });
  const batchInsert = writes.find(item => /INSERT INTO salary_batch/.test(item.sql));
  assert.match(batchInsert.sql, /source_type,calculation_run_id/);
  assert.equal(batchInsert.params.sourceType, 'ATTENDANCE_AUTO');
  const detail = writes.find(item => /INSERT INTO salary_detail/.test(item.sql));
  assert.equal(detail.params.grossAmount, '452.00');
  assert.equal(detail.params.otherDeduction, '100.00');
  assert.equal(detail.params.netAmount, '352.00');
  const snapshot = JSON.parse(detail.params.itemSnapshot);
  assert.deepEqual(snapshot.slice(0, 3).map(item => item.label), ['当月应得工资', '已日结金额', '月度待发金额']);
  assert.doesNotMatch(detail.params.itemSnapshot, /projectRuleId|projectShiftRuleId/);
  const detailIndex = writes.findIndex(item => /INSERT INTO salary_detail/.test(item.sql));
  const confirmIndex = writes.findIndex(item => /UPDATE wage_calculation_runs SET status='CONFIRMED'/.test(item.sql));
  assert.ok(detailIndex >= 0 && confirmIndex > detailIndex, '必须先完整写入工资明细再确认计算批次');

  let confirmedUpdate = false;
  await assert.rejects(withTransaction(async sql => {
    if (/FROM wage_calculation_runs run/.test(sql)) return [[{
      runId: 82, projectId: 12, salaryMonth: '2026-10', revisionNo: 3,
      status: 'PREVIEW', blockedCount: 0, salaryBatchId: null
    }]];
    if (/FROM salary_batch/.test(sql)) return [[]];
    if (/SELECT id FROM wage_calculation_runs/.test(sql)) return [[{ id: 82 }]];
    if (/FROM wage_calculation_daily_lines line/.test(sql)) return [[{
      employeeId: 101, shiftDate: '2026-10-08', shiftType: 'DAY', workedMinutes: 480,
      payableMinutes: 480, hourlyRate: '20.00', allowanceAmount: '0.00', earnedAmount: '160.00',
      dailyPaidAmount: '0.00', payableAmount: '160.00'
    }]];
    if (/INSERT INTO salary_batch/.test(sql)) return [{ insertId: 207 }];
    if (/INSERT INTO salary_detail/.test(sql)) throw new Error('detail failed');
    if (/UPDATE wage_calculation_runs SET status='CONFIRMED'/.test(sql)) confirmedUpdate = true;
    return [{ affectedRows: 1 }];
  }, () => service.confirmPreview(3, user, 9, 82)), /detail failed/);
  assert.equal(confirmedUpdate, false);
}

run().then(() => console.log('wage-calculation-confirm.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
