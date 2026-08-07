const assert = require('assert');
const db = require('../src/db');

async function main() {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ method: 'query', sql, params });
      return [[{ ok: 1 }], []];
    },
    async execute(sql, params) {
      calls.push({ method: 'execute', sql, params });
      return [[{ ok: 1 }], []];
    }
  };

  // MySQL 8.4 对 LIMIT/OFFSET 的二进制预处理参数会返回 ER_WRONG_ARGUMENTS，
  // 分页语句必须走 mysql2 的文本查询协议（仍由驱动安全转义占位符）。
  await db._testing.queryWithClient(client, 'SELECT 1 LIMIT :limit OFFSET :offset', { limit: 20, offset: 0 });
  assert.strictEqual(calls.pop().method, 'query');

  await db._testing.queryWithClient(client, 'SELECT 1 LIMIT ?', [20]);
  assert.strictEqual(calls.pop().method, 'query');

  await db._testing.queryWithClient(client, 'SELECT 1 WHERE id=:id', { id: 1 });
  assert.strictEqual(calls.pop().method, 'execute');

  assert.strictEqual(db._testing.requiresTextProtocol('SELECT 1 LIMIT :limit'), true);
  assert.strictEqual(db._testing.requiresTextProtocol('SELECT 1 OFFSET :offset'), true);
  assert.strictEqual(db._testing.requiresTextProtocol('SELECT 1 LIMIT 20'), false);

  await db.pool.end();
  console.log('mysql-pagination-protocol-tests-ok');
}

main().catch(async error => {
  console.error(error);
  await db.pool.end();
  process.exit(1);
});
