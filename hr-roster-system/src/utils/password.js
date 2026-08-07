const crypto = require('crypto');

const DEFAULT_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, DEFAULT_ITERATIONS, KEY_LENGTH, DIGEST);
  return `pbkdf2$${DEFAULT_ITERATIONS}$${salt}$${hash.toString('base64')}`;
}

function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const parts = String(storedHash).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], 'base64');
  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, DIGEST);

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  hashPassword,
  verifyPassword
};
