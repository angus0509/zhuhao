const mysql = require('mysql2/promise');
const env = require('./config/env');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  // 显式指定连接字符集，避免云数据库或命令行客户端默认字符集导致中文乱码。
  charset: 'utf8mb4_unicode_ci',
  namedPlaceholders: true,
  dateStrings: true
});

function requiresTextProtocol(sql) {
  // MySQL 8.4 的二进制预处理协议不接受 mysql2 传入的 LIMIT/OFFSET 数字参数，
  // 会返回 ER_WRONG_ARGUMENTS。文本协议仍会由 mysql2 对占位符做安全转义。
  return /\b(?:LIMIT|OFFSET)\s+(?::[a-zA-Z_][a-zA-Z0-9_]*|\?)/i.test(String(sql || ''));
}

async function queryWithClient(client, sql, params = {}) {
  const method = requiresTextProtocol(sql) ? 'query' : 'execute';
  const [rows] = await client[method](sql, params);
  return rows;
}

async function query(sql, params = {}) {
  return queryWithClient(pool, sql, params);
}

async function first(sql, params = {}) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function transaction(handler) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  query,
  first,
  transaction,
  _testing: {
    requiresTextProtocol,
    queryWithClient
  }
};
