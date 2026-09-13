const assert = require('node:assert/strict');
const db = require('../src/db');
const operationsService = require('../src/services/operations.service');

const originalFirst = db.first;
const originalQuery = db.query;

async function main() {
  const calls = [];
  db.first = async (sql, params) => {
    calls.push({ kind: 'first', sql, params });
    if (sql.includes('COUNT(*) total')) return { total: 2 };
    if (sql.includes('summaryPaidAmount')) {
      return { summaryCount: 2, summaryPaidAmount: 800, summaryRecoveredAmount: 300, summaryOutstandingAmount: 500 };
    }
    return null;
  };
  db.query = async (sql, params) => {
    calls.push({ kind: 'query', sql, params });
    return [
      { id: 1, advanceStatus: 4, applyAmount: 500, paidAmount: 500, outstandingAmount: 500 },
      { id: 2, advanceStatus: 5, applyAmount: 300, paidAmount: 300, outstandingAmount: 0 }
    ];
  };

  const result = await operationsService.listAdvances(7, { month: '2026-08', page: 1, pageSize: 20 }, {
    id: 9,
    dataScope: 1
  });

  assert.equal(result.month, '2026-08');
  assert.deepEqual(result.summary, {
    count: 2,
    advanceAmount: 800,
    recoveredAmount: 300,
    outstandingAmount: 500
  });
  const listCall = calls.find(call => call.kind === 'query');
  assert.equal(listCall.params.monthStart, '2026-08-01 00:00:00');
  assert.equal(listCall.params.monthEnd, '2026-09-01 00:00:00');
  assert.match(listCall.sql, /COALESCE\(a\.paid_at,a\.created_at\) >= :monthStart/);
  assert.match(listCall.sql, /COALESCE\(a\.paid_at,a\.created_at\) < :monthEnd/);

  await assert.rejects(
    () => operationsService.listAdvances(7, { month: '2026-13' }, { id: 9, dataScope: 1 }),
    /月份格式不正确/
  );
}

main()
  .then(() => console.log('advance-month-ledger-tests-ok'))
  .finally(() => {
    db.first = originalFirst;
    db.query = originalQuery;
    db.pool.end();
  });
