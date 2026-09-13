const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/payslip.service');

const employeeUser = { id: 501, accountType: 'EMPLOYEE', employeeId: 88 };

async function main() {
  const originalPoolExecute = db.pool.execute;
  const originalFirst = db.first;
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  try {
    db.pool.execute = async sql => {
      const supportsDeparted = /employee_status\s+IN\s*\(2,3\)/i.test(sql);
      return [supportsDeparted ? [{ id: 88, name: '离职员工' }] : []];
    };
    db.first = async (sql, params) => {
      assert.match(sql, /COUNT\(\*\)/);
      assert.deepEqual(params, {
        companyId: 1,
        employeeId: 88,
        yearStart: '2026-01',
        yearEnd: '2026-12'
      });
      return { total: 2 };
    };
    let listSql = '';
    let listParams;
    db.query = async (sql, params) => {
      listSql = sql;
      listParams = params;
      return [{
        id: 901,
        salaryMonth: '2026-07',
        batchNo: 'PAY-2026-07',
        projectName: '装配项目',
        grossAmount: '5200.00',
        netAmount: '4800.00',
        receiptStatus: 1,
        viewed: 0,
        openDisputeId: null
      }];
    };

    const list = await service.listMyPayslips(1, employeeUser, {
      year: '2026',
      page: '2',
      pageSize: '1',
      employeeId: 999
    });
    assert.deepEqual(listParams, {
      companyId: 1,
      employeeId: 88,
      yearStart: '2026-01',
      yearEnd: '2026-12',
      pageSize: 1,
      offset: 1
    });
    assert.match(listSql, /d\.company_id=:companyId/);
    assert.match(listSql, /d\.employee_id=:employeeId/);
    assert.match(listSql, /b\.batch_status=5/);
    assert.deepEqual({ page: list.page, pageSize: list.pageSize, total: list.total }, {
      page: 2, pageSize: 1, total: 2
    });
    assert.equal(list.list[0].displayStatus, '待查看');
    assert.equal(Object.hasOwn(list.list[0], 'employeeId'), false);

    db.first = async (sql, params) => {
      assert.match(sql, /b\.salary_month=:salaryMonth/);
      assert.deepEqual(params, {
        companyId: 1,
        employeeId: 88,
        salaryMonth: '2026-08'
      });
      return { total: 1 };
    };
    db.query = async (sql, params) => {
      assert.match(sql, /b\.salary_month=:salaryMonth/);
      assert.deepEqual(params, {
        companyId: 1,
        employeeId: 88,
        salaryMonth: '2026-08',
        pageSize: 20,
        offset: 0
      });
      return [];
    };
    const monthList = await service.listMyPayslips(1, employeeUser, {
      year: '2026',
      month: '2026-08',
      page: '1',
      pageSize: '20'
    });
    assert.equal(monthList.total, 1);
    await assert.rejects(
      () => service.listMyPayslips(1, employeeUser, { month: '2026-13' }),
      /工资月份格式/
    );

    const executed = [];
    db.transaction = async handler => handler({
      async execute(sql, params) {
        executed.push({ sql, params });
        if (/FROM hr_employee/.test(sql)) return [[{ id: 88, name: '张三' }]];
        if (/FROM salary_detail d/.test(sql)) {
          return [[{
            id: 901,
            salaryMonth: '2026-07',
            batchNo: 'PAY-2026-07',
            grossAmount: '5200.00',
            netAmount: '4800.00',
            receiptStatus: 1,
            viewed: 0,
            openDisputeId: null,
            activeSignatureId: null
          }]];
        }
        if (/INSERT INTO salary_receipt_log/.test(sql)) return [{ insertId: 1, affectedRows: 1 }];
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    });
    const detail = await service.getMyPayslip(1, 901, employeeUser, {
      ipAddress: '127.0.0.1',
      userAgent: 'test-device'
    });
    assert.equal(detail.displayStatus, '待签字', '查看详情写入 VIEW 后应进入待签字状态');
    assert.equal(executed.some(item => /action_type/.test(item.sql) && item.params.actionType === 'VIEW'), true);
    const detailQuery = executed.find(item => /FROM salary_detail d/.test(item.sql));
    assert.deepEqual(detailQuery.params, { companyId: 1, payslipId: 901, employeeId: 88 });
  } finally {
    db.pool.execute = originalPoolExecute;
    db.first = originalFirst;
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }

  console.log('employee-payslip-query-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
