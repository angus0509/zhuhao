const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/operations.service');

const scopedUser = {
  id: 9,
  companyId: 1,
  dataScope: 5,
  scopeDeptIds: [],
  permissions: ['payroll:view']
};

async function main() {
  const original = { first: db.first, query: db.query };
  const firstSql = [];
  db.first = async sql => {
    firstSql.push(sql);
    if (/COUNT\(\*\) batchCount/.test(sql)) {
      return { batchCount: 4, totalGross: 8100, totalNet: 8010, pendingBatchCount: 2 };
    }
    if (/employeeTotal/.test(sql)) {
      return { employeeTotal: 2, viewedTotal: 2, signedTotal: 2, unsignedTotal: 0 };
    }
    throw new Error(`Unexpected payroll overview SQL: ${sql}`);
  };
  db.query = async () => [
    { id: 1, batchStatus: 1, employeeCount: 8, grossTotal: 47131.14, netTotal: 45733.19 },
    { id: 2, batchStatus: 5, employeeCount: 2, grossTotal: 8100, netTotal: 8010 }
  ];

  try {
    const result = await service.payrollOverview(1, scopedUser);
    assert.equal(result.grossTotal, 8100, '累计应发只能统计已发布批次');
    assert.equal(result.netTotal, 8010, '累计实发只能统计已发布批次');
    assert.equal(result.employeeTotal, 2, '计薪人数只能统计已发布批次');
    assert.equal(result.viewedTotal, 2, '已查看只能统计已发布批次');
    assert.equal(result.signedTotal, 2, '已签收只能统计已发布批次');
    assert.equal(result.pendingBatchCount, 2, '状态1至4都必须计入待发布批次');

    const sql = firstSql.join('\n');
    assert.match(sql, /SUM\(CASE WHEN batch_status=5 THEN total_gross ELSE 0 END\)/);
    assert.match(sql, /batch_status IN \(1,2,3,4\)/);
    assert.match(sql, /db_batch\.batch_status=5/, '员工统计必须限制为已发布批次');
  } finally {
    db.first = original.first;
    db.query = original.query;
  }

  console.log('payroll-overview-consistency-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
