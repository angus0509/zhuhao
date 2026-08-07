const assert = require('assert');
const db = require('../src/db');
const employeeService = require('../src/services/employee.service');

async function main() {
  const originalFirst = db.first;
  const originalQuery = db.query;
  let listQueryChecked = false;

  try {
    db.first = async (_sql, params) => {
      assert.strictEqual(params.pageSize, 2);
      assert.strictEqual(params.offset, 0);
      return { total: 0 };
    };
    db.query = async (sql, params) => {
      if (/LIMIT\s+:pageSize\s+OFFSET\s+:offset/i.test(sql)) {
        assert.strictEqual(params.pageSize, 2);
        assert.strictEqual(params.offset, 0);
        listQueryChecked = true;
      }
      return [];
    };

    const result = await employeeService.listEmployees(1, { page: 1, pageSize: 2 }, null);
    assert.strictEqual(listQueryChecked, true);
    assert.deepStrictEqual(result.list, []);
  } finally {
    db.first = originalFirst;
    db.query = originalQuery;
    await db.pool.end();
  }

  console.log('employee-pagination-contract-tests-ok');
}

main().catch(async error => {
  console.error(error);
  await db.pool.end();
  process.exit(1);
});
