require('dotenv').config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3100),
  defaultCompanyId: Number(process.env.DEFAULT_COMPANY_ID || 1),
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
    tokenExpiresInSeconds: Number(process.env.JWT_EXPIRES_IN_SECONDS || 7 * 24 * 60 * 60)
  },
  corsOrigins: String(process.env.CORS_ORIGINS || 'https://lczpt.com,https://www.lczpt.com')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hr_roster',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10)
  },
  crypto: {
    key: process.env.DATA_ENCRYPT_KEY || '',
    iv: process.env.DATA_ENCRYPT_IV || ''
  }
};

function assertProductionSecurityConfig() {
  if (env.nodeEnv !== 'production') return;

  const errors = [];
  if (!env.db.password) errors.push('DB_PASSWORD 未配置');
  if (!env.auth.jwtSecret || env.auth.jwtSecret === 'dev-secret-change-me' || Buffer.byteLength(env.auth.jwtSecret, 'utf8') < 32) {
    errors.push('JWT_SECRET 必须为至少32字节的随机字符串');
  }
  if (Buffer.byteLength(env.crypto.key, 'utf8') !== 32) errors.push('DATA_ENCRYPT_KEY 必须为32字节');
  // 保留固定 IV 仅用于解密历史 enc:v1 数据；新数据已改用随机 nonce。
  if (Buffer.byteLength(env.crypto.iv, 'utf8') !== 16) errors.push('DATA_ENCRYPT_IV 必须为16字节');
  if (errors.length) throw new Error(`生产安全配置不完整：${errors.join('；')}`);
}

env.assertProductionSecurityConfig = assertProductionSecurityConfig;

module.exports = env;
