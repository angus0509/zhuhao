const crypto = require('crypto');
const env = require('../config/env');

const LEGACY_ALGORITHM = 'aes-256-cbc';
const ALGORITHM = 'aes-256-gcm';
const LEGACY_PREFIX = 'enc:v1:';
const PREFIX = 'enc:v2:';

function encryptionReady() {
  return Buffer.byteLength(env.crypto.key || '', 'utf8') === 32;
}

function encryptionKey() {
  if (!encryptionReady()) throw new Error('敏感数据加密密钥未正确配置，已拒绝明文写入');
  return Buffer.from(env.crypto.key, 'utf8');
}

function encrypt(text) {
  if (!text) return null;
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${nonce.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(value) {
  if (!value) return '';
  const text = String(value);
  if (text.startsWith(PREFIX)) {
    const [nonceText, authTagText, encryptedText] = text.slice(PREFIX.length).split(':');
    if (!nonceText || !authTagText || !encryptedText) throw new Error('敏感数据密文格式无效');
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(nonceText, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64')),
      decipher.final()
    ]).toString('utf8');
  }

  // 兼容历史 AES-CBC 数据，避免上线后已有员工档案无法读取。
  if (text.startsWith(LEGACY_PREFIX)) {
    if (!encryptionReady() || Buffer.byteLength(env.crypto.iv || '', 'utf8') !== 16) return '';
    const decipher = crypto.createDecipheriv(
      LEGACY_ALGORITHM,
      encryptionKey(),
      Buffer.from(env.crypto.iv, 'utf8')
    );
    let decrypted = decipher.update(text.slice(LEGACY_PREFIX.length), 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // 历史明文只允许读取以便后续重加密，新写入必须经过 encrypt()。
  return text;
}

// 对身份证等检索字段生成不可逆摘要，用于唯一索引和黑名单命中判断。
function sha256(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(String(text).trim().toUpperCase()).digest('hex');
}

module.exports = {
  encrypt,
  decrypt,
  encryptionReady,
  sha256
};
