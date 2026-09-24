const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/attendance.service');

async function run() {
  assert.equal(typeof service.resolveEmployeeShift, 'function');
  assert.equal(typeof service.upsertProjectSchedules, 'function');

  const scheduled = await service.resolveEmployeeShift({
    execute: async sql => {
      if (/FROM attendance_schedules s/.test(sql)) return [[{
        scheduleId: 55, projectRuleId: 25, projectShiftRuleId: 252,
        shiftType: 'NIGHT', scheduleStatus: 'WORK'
      }]];
      return [[]];
    }
  }, 3, 12, 101, '2026-10-08');
  assert.equal(scheduled.shiftType, 'NIGHT');
  assert.equal(scheduled.source, 'SCHEDULE');

  const defaultShift = await service.resolveEmployeeShift({
    execute: async (sql) => {
      if (/FROM attendance_schedules s/.test(sql)) return [[]];
      if (/FROM employee_pay_profiles/.test(sql)) return [[{
        profileId: 9, defaultShiftType: 'DAY', settlementMode: 'MONTHLY', effectiveFrom: '2026-10-01'
      }]];
      if (/FROM attendance_project_rules/.test(sql)) return [[{ id: 25 }]];
      if (/FROM attendance_project_shift_rules/.test(sql)) return [[{
        projectShiftRuleId: 251, shiftType: 'DAY', workStartTime: '08:00:00', workEndTime: '17:00:00'
      }]];
      return [[]];
    }
  }, 3, 12, 101, '2026-10-08');
  assert.equal(defaultShift.shiftType, 'DAY');
  assert.equal(defaultShift.source, 'DEFAULT');
  assert.equal(defaultShift.projectShiftRuleId, 251);

  const missing = await service.resolveEmployeeShift({ execute: async () => [[]] }, 3, 12, 101, '2026-10-08');
  assert.deepEqual(missing, { source: 'MISSING_PAY_PROFILE', shiftType: null });

  const originalTransaction = db.transaction;
  const writes = [];
  try {
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        writes.push({ sql, params });
        if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
        if (/FROM hr_employee_job j/.test(sql)) return [[{ employeeId: params.employeeId }]];
        if (/FROM attendance_project_rules/.test(sql)) return [[{ id: 25 }]];
        if (/FROM attendance_project_shift_rules/.test(sql)) return [[{
          projectShiftRuleId: params.shiftType === 'NIGHT' ? 252 : 251, shiftType: params.shiftType
        }]];
        return [{ insertId: 1 }];
      }
    });
    const result = await service.upsertProjectSchedules(3, { id: 9, companyId: 3, dataScope: 1 }, 9, 12, {
      shiftDate: '2026-10-08',
      assignments: [{ employeeId: 101, shiftType: 'NIGHT' }, { employeeId: 102, shiftType: 'DAY' }]
    });
    assert.deepEqual(result, { projectId: 12, shiftDate: '2026-10-08', updatedCount: 2 });
    const scheduleWrites = writes.filter(item => /INSERT INTO attendance_schedules/.test(item.sql));
    assert.deepEqual(scheduleWrites.map(item => item.params.shiftType), ['NIGHT', 'DAY']);
    assert.deepEqual(scheduleWrites.map(item => item.params.projectShiftRuleId), [252, 251]);
  } finally {
    db.transaction = originalTransaction;
  }
}

run().then(() => console.log('attendance-shift-assignment.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
