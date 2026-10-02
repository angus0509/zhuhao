const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/wage-calculation.service');

async function preview(closureStatus) {
  const original = db.transaction;
  const lineWrites = [];
  db.transaction = async handler => handler({
    execute: async (sql, params) => {
      if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
      if (/FROM wage_calculation_runs/.test(sql) && /FOR UPDATE/.test(sql)) return [[]];
      if (/FROM attendance_daily_results d/.test(sql)) return [[{
        attendanceResultId: 501, employeeId: 101, shiftDate: '2026-09-29',
        workedMinutes: 510, approvedNormalMinutes: 480, approvedOvertimeMinutes: 30,
        resultStatus: 'NORMAL', reviewStatus: 'NONE', projectRuleId: 25,
        projectShiftRuleId: 251, shiftType: 'DAY', hourlyRate: '20.00',
        settlementMode: 'DAILY_PAID', pendingExceptionCount: 0,
        attendanceClosureId: closureStatus === 'CONFIRMED' ? 91 : null,
        attendanceClosureStatus: closureStatus,
        attendanceClosureVersion: closureStatus === 'CONFIRMED' ? 3 : null
      }]];
      if (/FROM attendance_allowance_rules/.test(sql)) return [[{
        projectRuleId: 25, allowanceName: '班次补贴', shiftScope: 'DAY',
        calculationType: 'PER_SHIFT', unitAmount: '10.00'
      }]];
      if (/FROM wage_daily_payments/.test(sql)) return [[]];
      if (/INSERT INTO wage_calculation_runs/.test(sql)) return [{ insertId: 81 }];
      if (/INSERT INTO wage_calculation_daily_lines/.test(sql)) lineWrites.push({ sql, params });
      return [{ affectedRows: 1 }];
    }
  });
  try {
    await service.createPreview(3, { id: 9, companyId: 3, dataScope: 1 }, 9, {
      projectId: 12, salaryMonth: '2026-09'
    });
    return lineWrites[0];
  } finally {
    db.transaction = original;
  }
}

async function run() {
  const open = await preview('OPEN');
  assert.equal(open.params.calculationStatus, 'BLOCKED');
  assert.equal(open.params.blockedReason, '考勤日未确认');
  const confirmed = await preview('CONFIRMED');
  assert.equal(confirmed.params.calculationStatus, 'READY');
  assert.equal(confirmed.params.payableMinutes, 510);
  assert.equal(confirmed.params.earnedAmount, '180.00');
  assert.equal(confirmed.params.attendanceClosureId, 91);
  assert.equal(confirmed.params.attendanceClosureVersion, 3);
  assert.match(confirmed.sql, /attendance_closure_version/);
}

run().then(() => console.log('wage-daily-settlement-preview-tests-ok')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
