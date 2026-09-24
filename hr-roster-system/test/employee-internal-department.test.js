const assert = require('node:assert/strict');
const employeeService = require('../src/services/employee.service');

async function run() {
  assert.equal(typeof employeeService.ensureInternalDepartment, 'function');

  const existingCalls = [];
  const existingId = await employeeService.ensureInternalDepartment({
    execute: async (sql, params) => {
      existingCalls.push({ sql, params });
      if (/FROM hr_company/.test(sql)) return [[{ id: 1 }]];
      if (/FROM hr_department/.test(sql)) return [[{ id: 7, status: 1 }]];
      throw new Error(`不应执行写入: ${sql}`);
    }
  }, 1);
  assert.equal(existingId, 7);
  const departmentLookup = existingCalls.find(item => /FROM hr_department/.test(item.sql));
  assert.match(departmentLookup.sql, /dept_code=:deptCode/);
  assert.equal(departmentLookup.params.deptCode, 'SYSTEM_UNASSIGNED');
  assert.equal(existingCalls.some(item => /INSERT INTO hr_department/.test(item.sql)), false);

  const disabledCalls = [];
  const restoredId = await employeeService.ensureInternalDepartment({
    execute: async (sql, params) => {
      disabledCalls.push({ sql, params });
      if (/FROM hr_company/.test(sql)) return [[{ id: 1 }]];
      if (/FROM hr_department/.test(sql)) return [[{ id: 8, status: 0 }]];
      if (/UPDATE hr_department/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`未识别 SQL: ${sql}`);
    }
  }, 1);
  assert.equal(restoredId, 8);
  const restore = disabledCalls.find(item => /UPDATE hr_department/.test(item.sql));
  assert.equal(restore.params.deptId, 8);
  assert.equal(restore.params.deptName, '未分部门（系统）');

  const emptyCalls = [];
  const fallbackId = await employeeService.ensureInternalDepartment({
    execute: async (sql, params) => {
      emptyCalls.push({ sql, params });
      if (/FROM hr_company/.test(sql)) return [[{ id: 1 }]];
      if (/FROM hr_department/.test(sql)) return [[]];
      if (/INSERT INTO hr_department/.test(sql)) return [{ insertId: 19, affectedRows: 1 }];
      throw new Error(`未识别 SQL: ${sql}`);
    }
  }, 1);
  assert.equal(fallbackId, 19);
  const companyLock = emptyCalls.find(item => /FROM hr_company/.test(item.sql));
  assert.match(companyLock.sql, /FOR UPDATE/);
  const insert = emptyCalls.find(item => /INSERT INTO hr_department/.test(item.sql));
  assert.equal(insert.params.deptName, '未分部门（系统）');
  assert.equal(insert.params.deptCode, 'SYSTEM_UNASSIGNED');
}

run().then(() => console.log('employee-internal-department.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
