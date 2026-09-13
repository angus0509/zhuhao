const assert = require('node:assert/strict');
const db = require('../src/db');
const employeeService = require('../src/services/employee.service');

const originalFirst = db.first;
const originalQuery = db.query;
const originalTransaction = db.transaction;

async function main() {
  const calls = [];
  db.first = async (sql, params) => {
    calls.push({ kind: 'first', sql, params });
    if (sql.includes('person_blacklist')) return null;
    if (sql.includes('SELECT id,employee_status employeeStatus')) {
      return { id: 88, employeeStatus: 3, lifecycleStatus: 'LEFT' };
    }
    if (sql.includes('SELECT e.id,e.name,e.employee_status employeeStatus')) {
      return {
        id: 88,
        name: '张三',
        employeeStatus: 3,
        lifecycleStatus: 'LEFT',
        customerName: '甲客户',
        projectName: '一厂项目'
      };
    }
    return null;
  };
  db.query = async (sql, params) => {
    calls.push({ kind: 'query', sql, params });
    return [];
  };

  const result = await employeeService.precheckEmployee(7, {
    name: '张三',
    idCardNo: '320311199001011234'
  }, {
    id: 9,
    dataScope: 1,
    permissions: ['employee:create', 'employee:view', 'employee:update']
  });

  assert.equal(result.allowOnboarding, false);
  assert.deepEqual(result.checks.duplicate, {
    passed: false,
    employeeId: 88,
    employeeName: '张三',
    employeeStatus: 3,
    lifecycleStatus: 'LEFT',
    customerName: '甲客户',
    projectName: '一厂项目',
    canOpen: true,
    canReactivate: true
  });
  assert.ok(calls.some(call => call.params?.companyId === 7), '重复档案查询必须限定当前企业');

  const transactionCalls = [];
  const connection = {
    execute: async (sql, params) => {
      transactionCalls.push({ sql, params });
      if (sql.includes('SELECT e.id') && sql.includes('job_status=1')) {
        return [[{ id: 88, name: '张三', employee_status: 3, job_id: 199, customer_id: 21, project_id: 31, position_id: 41 }]];
      }
      return [{ affectedRows: 1 }];
    }
  };
  db.transaction = async callback => callback(connection);
  await employeeService.reactivateEmployee(7, 88, { remark: '再次到岗' }, 9, {
    id: 9,
    dataScope: 1,
    permissions: ['employee:update']
  });
  assert.ok(
    transactionCalls.some(call => call.sql.includes("employee_status=1,lifecycle_status='PENDING_ARRIVAL'")),
    '重新录用必须把历史员工转为待到岗'
  );
  assert.ok(
    transactionCalls.some(call => call.sql.includes("taskType") || call.params?.taskType === 'ARRIVAL'),
    '重新录用必须建立到岗待办'
  );
}

main()
  .then(() => console.log('employee-duplicate-recovery-tests-ok'))
  .finally(() => {
    db.first = originalFirst;
    db.query = originalQuery;
    db.transaction = originalTransaction;
    db.pool.end();
  });
