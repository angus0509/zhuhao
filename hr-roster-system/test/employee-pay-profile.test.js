const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/employee-pay-profile.service');

async function run() {
  assert.deepEqual(service.validatePayProfile({
    defaultShiftType: 'DAY', settlementMode: 'DAILY_PAID', effectiveFrom: '2026-10-01'
  }), { defaultShiftType: 'DAY', settlementMode: 'DAILY_PAID', effectiveFrom: '2026-10-01' });
  assert.throws(() => service.validatePayProfile({
    defaultShiftType: 'SWING', settlementMode: 'WEEKLY', effectiveFrom: '2026-10-01'
  }), error => error.businessCode === 'INVALID_PAY_PROFILE');

  const resolved = await service.resolvePayProfile({
    execute: async (sql, params) => {
      assert.match(sql, /effective_from<=:shiftDate/);
      assert.equal(params.shiftDate, '2026-10-08');
      return [[{
        profileId: 9, defaultShiftType: 'DAY', settlementMode: 'DAILY_PAID', effectiveFrom: '2026-10-01'
      }]];
    }
  }, 3, 12, 101, '2026-10-08');
  assert.deepEqual(resolved, {
    profileId: 9, defaultShiftType: 'DAY', settlementMode: 'DAILY_PAID', effectiveFrom: '2026-10-01'
  });

  const originalTransaction = db.transaction;
  const writes = [];
  try {
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        writes.push({ sql, params });
        if (/FROM labor_project p/.test(sql)) return [[{ id: 12 }]];
        if (/FROM hr_employee_job j/.test(sql)) return [[{ id: 41 }]];
        if (/FROM employee_pay_profiles/.test(sql) && /FOR UPDATE/.test(sql)) return [[]];
        if (/INSERT INTO employee_pay_profiles/.test(sql)) return [{ insertId: 9 }];
        return [{ insertId: 70 }];
      }
    });
    const saved = await service.savePayProfile(3, { id: 9, companyId: 3, dataScope: 1 }, 9, 12, 101, {
      defaultShiftType: 'NIGHT', settlementMode: 'DAILY_ACCRUAL', effectiveFrom: '2026-10-01'
    });
    assert.deepEqual(saved, {
      profileId: 9, employeeId: 101, projectId: 12,
      defaultShiftType: 'NIGHT', settlementMode: 'DAILY_ACCRUAL', effectiveFrom: '2026-10-01'
    });
    const insert = writes.find(item => /INSERT INTO employee_pay_profiles/.test(item.sql));
    assert.equal(insert.params.employeeId, 101);
    assert.ok(writes.some(item => /INSERT INTO hr_operation_log/.test(item.sql)));

    db.transaction = async handler => handler({
      execute: async sql => {
        if (/FROM labor_project p/.test(sql)) return [[{ id: 12 }]];
        if (/FROM hr_employee_job j/.test(sql)) return [[]];
        return [[]];
      }
    });
    await assert.rejects(
      service.savePayProfile(3, { id: 9, companyId: 3, dataScope: 1 }, 9, 12, 999, {
        defaultShiftType: 'DAY', settlementMode: 'MONTHLY', effectiveFrom: '2026-10-01'
      }),
      error => error.businessCode === 'EMPLOYEE_PROJECT_FORBIDDEN'
    );
  } finally {
    db.transaction = originalTransaction;
  }
}

run().then(() => console.log('employee-pay-profile.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
