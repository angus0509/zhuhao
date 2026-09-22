const assert = require('node:assert/strict');
process.env.DATA_ENCRYPT_KEY = '12345678901234567890123456789012';
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

  const placementCalls = [];
  const placementConnection = {
    execute: async (sql, params = {}) => {
      placementCalls.push({ sql, params });
      if (sql.includes('SELECT id,dept_id,customer_id,project_id,job_status')) {
        return [[{
          id: 199,
          dept_id: 77,
          customer_id: 21,
          project_id: 31,
          job_status: 2
        }]];
      }
      if (sql.includes('SELECT * FROM hr_employee')) {
        return [[{
          id: 88,
          company_id: 7,
          employee_no: 'E88',
          name: '张三',
          gender: 1,
          id_card_no: '320311199001011234',
          id_card_hash: 'old-hash',
          address: null,
          phone: '13800000000',
          bank_card_no: null,
          emergency_phone: null,
          employee_status: 3,
          created_by: 9
        }]];
      }
      if (sql.includes('SELECT id FROM hr_company') && sql.includes('FOR UPDATE')) return [[{ id: 7 }]];
      if (sql.includes('FROM hr_department') && sql.includes('dept_code=:deptCode')) {
        return [[{ id: 8, status: 1 }]];
      }
      if (sql.includes('FROM person_blacklist')) return [[]];
      if (sql.includes('SELECT id FROM hr_employee')) return [[]];
      if (sql.includes('FROM crm_customer')) return [[{ id: 22 }]];
      if (sql.includes('SELECT id FROM hr_department') && sql.includes('id = :deptId')) {
        return [Number(params.deptId) === 8 ? [{ id: 8 }] : []];
      }
      if (sql.includes('FROM hr_position') && sql.includes('status = 1')) return [[{ id: 42 }]];
      if (sql.includes('FROM labor_project') && sql.includes('customer_id=:customerId')) return [[{ id: 32 }]];
      if (sql.includes('SELECT e.*,j.customer_id')) {
        return [[{
          id: 88,
          name: '张三',
          employee_status: 3,
          customer_id: 22,
          project_id: 32,
          position_id: 42,
          position_name: '操作工',
          created_by: 9
        }]];
      }
      if (sql.includes('SELECT e.id') && sql.includes('FROM hr_employee e')) return [[{ id: 88 }]];
      return [{ affectedRows: 1, insertId: 300 }];
    }
  };
  db.transaction = async callback => callback(placementConnection);
  await employeeService.updateEmployee(7, 88, {
    name: '张三',
    gender: 1,
    customerId: 22,
    projectId: 32,
    positionId: 42,
    employmentType: 1,
    workType: 1,
    hireDate: '2026-09-22'
  }, 9, {
    id: 9,
    dataScope: 1,
    permissions: ['employee:update']
  });
  assert.ok(
    placementCalls.some(call => call.sql.includes('INSERT INTO hr_employee_job') && call.params?.deptId === 8),
    '离职员工跨单位重新派驻必须使用启用的系统占位部门建立新任职'
  );
  assert.equal(
    placementCalls.some(call => call.sql.includes('SELECT id FROM hr_department') && call.params?.deptId === 77),
    false,
    '重新派驻不得继续校验已停用的历史部门'
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
