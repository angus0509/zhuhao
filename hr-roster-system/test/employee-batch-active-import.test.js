const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const employeeService = require('../src/services/employee.service');

async function main() {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  let employeeInsert = null;

  db.query = async sql => {
    if (sql.includes('FROM crm_customer')) return [{ id: 10, customer_name: '客户A' }];
    if (sql.includes('FROM hr_position')) return [{ id: 20, position_name: '普工' }];
    if (sql.includes('FROM labor_project')) return [];
    throw new Error(`未覆盖的批量查询：${sql}`);
  };

  const connection = {
    async execute(sql, params = {}) {
      if (sql.includes('FROM hr_company') && sql.includes('FOR UPDATE')) return [[{ id: 1 }]];
      if (sql.includes('FROM hr_department') && sql.includes('dept_code=:deptCode')) return [[{ id: 5, status: 1 }]];
      if (sql.includes('FROM person_blacklist')) return [[]];
      if (sql.includes('FROM hr_employee') && sql.includes('id_card_hash') && sql.includes('id<>')) return [[]];
      if (sql.includes('FROM hr_employee') && sql.includes('employee_no')) return [[]];
      if (sql.includes('FROM crm_customer')) return [[{ id: 10 }]];
      if (sql.includes('FROM hr_department')) return [[{ id: 5 }]];
      if (sql.includes('FROM hr_position')) return [[{ id: 20 }]];
      if (sql.includes('INSERT INTO hr_employee') && !sql.includes('hr_employee_job')) {
        employeeInsert = { ...params };
        return [{ insertId: 99 }];
      }
      if (sql.includes('INSERT INTO hr_employee_job')) return [{ insertId: 100 }];
      if (sql.includes('SELECT e.id,e.name,e.id_card_hash')) {
        return [[{
          id: 99,
          name: '老员工',
          id_card_hash: 'hash',
          phone: null,
          employee_status: 2,
          recruitment_channel_id: null,
          channel_source: null,
          created_by: 7,
          customer_id: 10,
          project_id: null,
          position_id: 20,
          position_name: '普工'
        }]];
      }
      if (sql.includes('SELECT id FROM talent_candidate')) return [[]];
      if (sql.includes('INSERT INTO hr_work_task')) return [{ insertId: 101 }];
      if (sql.includes('INSERT INTO hr_operation_log')) return [{ insertId: 102 }];
      throw new Error(`未覆盖的事务查询：${sql}`);
    }
  };
  db.transaction = handler => handler(connection);

  try {
    const result = await employeeService.createEmployeesBatch(1, [{
      name: '老员工',
      idCardNo: '320101199001011234',
      customerName: '客户A',
      positionName: '普工',
      employmentType: '派遣',
      workType: '计时',
      hireDate: '2024-01-02',
      employeeStatus: '在职'
    }], 7, null);

    assert.equal(result.successCount, 1, '历史在职员工批量导入应成功');
    assert.equal(result.failureCount, 0, '历史在职员工批量导入不应进入失败列表');
    assert.equal(employeeInsert.employeeStatus, 2, '历史在职员工必须直接写为在职');
    assert.equal(employeeInsert.lifecycleStatus, 'ACTIVE', '历史在职员工生命周期必须为 ACTIVE');
    assert.equal(employeeInsert.arrivalStatus, 'CONFIRMED', '历史在职员工到岗状态必须为已确认');

    await assert.rejects(
      employeeService.createEmployee(1, { employeeStatus: 2 }, 7, null),
      /新增员工请先录入为待到岗，再确认入职/,
      '普通新增员工接口仍必须拒绝直接创建在职员工'
    );
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
    await db.pool.end();
  }

  console.log('employee-batch-active-import-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
