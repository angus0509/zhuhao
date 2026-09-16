const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/attendance-project.service');

const validShifts = [
  {
    shiftType: 'DAY', workStartTime: '08:00', workEndTime: '17:00',
    restStartTime: '12:00', restEndTime: '13:00', standardHours: 8, hourlyRate: '20.00'
  },
  {
    shiftType: 'NIGHT', workStartTime: '20:00', workEndTime: '05:00',
    restStartTime: '00:00', restEndTime: '01:00', standardHours: 8, hourlyRate: '23.00'
  }
];

const validAllowances = [
  { allowanceName: '夜班补贴', shiftScope: 'NIGHT', calculationType: 'PER_SHIFT', unitAmount: '30.00' },
  { allowanceName: '高温补贴', shiftScope: 'ALL', calculationType: 'PER_HOUR', unitAmount: '1.50' }
];

async function run() {
  assert.equal(service.validateShiftRules(validShifts)[1].standardMinutes, 480);
  assert.throws(
    () => service.validateShiftRules(validShifts.slice(0, 1)),
    error => error.businessCode === 'INVALID_SHIFT_RULE'
  );
  assert.throws(
    () => service.validateShiftRules([{ ...validShifts[0], standardHours: 7.25 }, validShifts[1]]),
    error => error.businessCode === 'INVALID_SHIFT_RULE'
  );
  assert.throws(
    () => service.validateAllowances([
      { allowanceName: '餐补', shiftScope: 'ALL', calculationType: 'PER_SHIFT', unitAmount: '10.00' },
      { allowanceName: '餐补', shiftScope: 'ALL', calculationType: 'PER_HOUR', unitAmount: '12.00' }
    ]),
    error => error.businessCode === 'DUPLICATE_ALLOWANCE'
  );

  const originalTransaction = db.transaction;
  const writes = [];
  try {
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        writes.push({ sql, params });
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12, customerId: 7, projectName: '一厂项目' }]];
        if (/SELECT id,effective_from/.test(sql)) return [[]];
        if (/INSERT INTO attendance_project_rules/.test(sql)) return [{ insertId: 25 }];
        return [{ insertId: 100 }];
      }
    });
    const saved = await service.saveProjectSettings(3, { id: 9, companyId: 3, dataScope: 1 }, 9, 12, {
      ruleName: '双班计薪规则', effectiveFrom: '2099-10-01', workWeekdays: [1, 2, 3, 4, 5, 6],
      lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30,
      shifts: validShifts, allowances: validAllowances
    });
    assert.deepEqual(saved, { projectId: 12, ruleId: 25, effectiveFrom: '2099-10-01' });
    const shiftWrites = writes.filter(item => /INSERT INTO attendance_project_shift_rules/.test(item.sql));
    assert.deepEqual(shiftWrites.map(item => item.params.shiftType), ['DAY', 'NIGHT']);
    assert.deepEqual(shiftWrites.map(item => item.params.standardMinutes), [480, 480]);
    const allowanceWrites = writes.filter(item => /INSERT INTO attendance_allowance_rules/.test(item.sql));
    assert.deepEqual(allowanceWrites.map(item => item.params.allowanceName), ['夜班补贴', '高温补贴']);
    const audit = writes.find(item => /INSERT INTO hr_operation_log/.test(item.sql));
    assert.ok(audit);
    assert.equal(JSON.parse(audit.params.afterData).shiftCount, 2);
    assert.equal(JSON.parse(audit.params.afterData).allowanceCount, 2);

    db.transaction = async handler => handler({
      execute: async sql => {
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12, customerId: 7, projectName: '一厂项目' }]];
        if (/FROM attendance_project_rules/.test(sql)) return [[{
          ruleId: 25, ruleName: '双班计薪规则', workStartTime: '08:00:00', workEndTime: '17:00:00',
          restStartTime: '12:00:00', restEndTime: '13:00:00', standardMinutes: 480,
          lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30,
          workWeekdays: '1,2,3,4,5,6', effectiveFrom: '2099-10-01', status: 1
        }]];
        if (/FROM attendance_project_geofence/.test(sql)) return [[]];
        if (/FROM attendance_project_shift_rules/.test(sql)) return [[
          { projectRuleId: 25, shiftType: 'DAY', standardMinutes: 480, hourlyRate: '20.00', status: 1 },
          { projectRuleId: 25, shiftType: 'NIGHT', standardMinutes: 480, hourlyRate: '23.00', status: 1 }
        ]];
        if (/FROM attendance_allowance_rules/.test(sql)) return [[{
          projectRuleId: 25, allowanceName: '夜班补贴', shiftScope: 'NIGHT',
          calculationType: 'PER_SHIFT', unitAmount: '30.00', sortOrder: 0, status: 1
        }]];
        return [[]];
      }
    });
    const settings = await service.getProjectSettings(3, { id: 9, companyId: 3, dataScope: 1 }, 12);
    assert.deepEqual(settings.rules[0].shifts.map(item => item.shiftType), ['DAY', 'NIGHT']);
    assert.equal(settings.rules[0].shifts[1].standardHours, 8);
    assert.equal(settings.rules[0].allowances[0].allowanceName, '夜班补贴');
  } finally {
    db.transaction = originalTransaction;
  }
}

run().then(() => console.log('attendance-project-wage-rules.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
