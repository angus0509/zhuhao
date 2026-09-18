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
  const queries = [];
  db.first = async (sql, params) => {
    firstSql.push({ sql, params: { ...params } });
    if (/COUNT\(\*\) batchCount/.test(sql)) {
      return { batchCount: 40, totalGross: 8100, totalNet: 8010, pendingBatchCount: 2 };
    }
    if (/COUNT\(\*\) filteredBatchCount/.test(sql)) {
      return { filteredBatchCount: params.salaryMonth ? 1 : 40 };
    }
    if (/employeeTotal/.test(sql)) {
      return { employeeTotal: 2, viewedTotal: 2, signedTotal: 2, unsignedTotal: 0 };
    }
    throw new Error(`Unexpected payroll overview SQL: ${sql}`);
  };
  db.query = async (sql, params) => {
    queries.push({ sql, params });
    return [
      { id: 1, batchStatus: 1, employeeCount: 8, grossTotal: 47131.14, netTotal: 45733.19 },
      { id: 2, batchStatus: 5, employeeCount: 2, grossTotal: 8100, netTotal: 8010 }
    ];
  };

  try {
    const result = await service.payrollOverview(1, scopedUser, { page: 2, pageSize: 20 });
    assert.equal(result.grossTotal, 8100, '累计应发只能统计已发布批次');
    assert.equal(result.netTotal, 8010, '累计实发只能统计已发布批次');
    assert.equal(result.employeeTotal, 2, '计薪人数只能统计已发布批次');
    assert.equal(result.viewedTotal, 2, '已查看只能统计已发布批次');
    assert.equal(result.signedTotal, 2, '已签收只能统计已发布批次');
    assert.equal(result.pendingBatchCount, 2, '状态1至4都必须计入待发布批次');
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 20);
    assert.equal(result.total, 40);

    assert.match(queries[0].sql, /LIMIT :pageSize OFFSET :offset/, '工资批次列表必须支持参数化分页');
    assert.equal(queries[0].params.pageSize, 20);
    assert.equal(queries[0].params.offset, 20);

    const sql = firstSql.map(item => item.sql).join('\n');
    assert.match(sql, /SUM\(CASE WHEN batch_status=5 THEN total_gross ELSE 0 END\)/);
    assert.match(sql, /batch_status IN \(1,2,3,4\)/);
    assert.match(sql, /db_batch\.batch_status=5/, '员工统计必须限制为已发布批次');

    queries.length = 0;
    const filtered = await service.payrollOverview(1, scopedUser, {
      page: 3,
      pageSize: 20,
      salaryMonth: '2026-09',
      status: 'failed'
    });
    assert.equal(filtered.total, 1, '筛选后的总数必须由数据库按完整结果集统计');
    assert.equal(filtered.page, 1, '筛选后超出范围的页码必须回到有效页');
    assert.equal(queries[0].params.salaryMonth, '2026-09');
    assert.equal(queries[0].params.status, 'failed');
    assert.match(queries[0].sql, /b\.salary_month\s*=\s*:salaryMonth/);
    assert.match(queries[0].sql, /b\.batch_status=5/);
    assert.match(queries[0].sql, /receipt_status=0/);

    const filteredCount = firstSql.find(item => /filteredBatchCount/.test(item.sql) && item.params.salaryMonth);
    assert.ok(filteredCount, '工资批次筛选必须先计算完整结果集总数');
    assert.match(filteredCount.sql, /b\.salary_month\s*=\s*:salaryMonth/);
    assert.match(filteredCount.sql, /receipt_status=0/);

    await assert.rejects(
      () => service.payrollOverview(1, scopedUser, { salaryMonth: '2026/09' }),
      /工资月份格式不正确/
    );
    await assert.rejects(
      () => service.payrollOverview(1, scopedUser, { status: 'unknown' }),
      /工资批次筛选状态无效/
    );
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
