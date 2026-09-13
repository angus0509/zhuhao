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
    db.pool.execute = async () => [[{ id: 88, name: '张三' }]];
    db.first = async () => ({ total: 4 });
    let listSql = '';
    db.query = async sql => {
      listSql = sql;
      return [
        {
          id: 1,
          salaryMonth: '2026-08',
          receiptStatus: 1,
          itemSnapshot: JSON.stringify([
            { label: '实发工资', value: 4730, category: 'summary', sortOrder: 4 },
            { label: '夜班奖', value: 380, category: 'income', sortOrder: 2 },
            { label: '身份证号', value: '320101199001011234', category: 'display', sortOrder: 1 }
          ])
        },
        {
          id: 2,
          salaryMonth: '2026-07',
          receiptStatus: 2,
          itemSnapshot: [
            { label: '班组', value: 'A组', category: 'display', sortOrder: 2 },
            { label: '全勤奖', value: 0, category: 'income', sortOrder: 1 }
          ]
        },
        { id: 3, salaryMonth: '2026-06', receiptStatus: 1, itemSnapshot: '{bad json' },
        { id: 4, salaryMonth: '2026-05', receiptStatus: 1, itemSnapshot: null }
      ];
    };

    const result = await service.listMyPayslips(1, employeeUser, { page: 1, pageSize: 20 });
    assert.match(listSql, /d\.item_snapshot itemSnapshot/);
    assert.match(listSql, /d\.company_id=:companyId/);
    assert.match(listSql, /d\.employee_id=:employeeId/);
    assert.match(listSql, /b\.batch_status=5/);
    assert.match(listSql, /d\.receipt_status IN \(1,2,3\)/);
    assert.deepEqual(result.list[0].items, [
      { label: '夜班奖', value: 380, category: 'income', sortOrder: 2 },
      { label: '实发工资', value: 4730, category: 'summary', sortOrder: 4 }
    ]);
    assert.deepEqual(result.list[1].items, [
      { label: '全勤奖', value: 0, category: 'income', sortOrder: 1 },
      { label: '班组', value: 'A组', category: 'display', sortOrder: 2 }
    ]);
    assert.deepEqual(result.list[2].items, []);
    assert.deepEqual(result.list[3].items, []);

    let detailSql = '';
    db.transaction = async handler => handler({
      async execute(sql) {
        if (/FROM hr_employee/.test(sql)) return [[{ id: 88, name: '张三' }]];
        if (/FROM salary_detail d/.test(sql)) {
          detailSql = sql;
          return [[{
            id: 1,
            salaryMonth: '2026-08',
            receiptStatus: 1,
            itemSnapshot: [{ label: '银行卡号', value: '6222020000000000', category: 'display', sortOrder: 1 }]
          }]];
        }
        if (/INSERT INTO salary_receipt_log/.test(sql)) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    });
    const detail = await service.getMyPayslip(1, 1, employeeUser);
    assert.match(detailSql, /d\.company_id=:companyId/);
    assert.match(detailSql, /d\.employee_id=:employeeId/);
    assert.deepEqual(detail.items, []);
  } finally {
    db.pool.execute = originalPoolExecute;
    db.first = originalFirst;
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }

  console.log('payslip-dynamic-items-security-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
