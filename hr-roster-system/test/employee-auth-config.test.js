const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/config/env.js'), 'utf8');
const example = fs.readFileSync(path.join(root, '.env.production.example'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.prod.yml'), 'utf8');
const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-production.sh'), 'utf8');

assert.match(source, /wechatMini:\s*\{/);
assert.match(source, /WECHAT_MINIPROGRAM_APPID/);
assert.match(source, /WECHAT_MINIPROGRAM_SECRET/);
assert.match(source, /EMPLOYEE_BIND_HMAC_SECRET/);

for (const name of [
  'WECHAT_MINIPROGRAM_APPID',
  'WECHAT_MINIPROGRAM_SECRET',
  'EMPLOYEE_BIND_HMAC_SECRET'
]) {
  assert.match(example, new RegExp(`^${name}=`, 'm'));
  assert.match(compose, new RegExp(name + ': \\$\\{' + name), `Docker Compose 未传入 ${name}`);
  assert.match(deploy, new RegExp(name), `生产部署脚本未预检 ${name}`);
}

function runProductionValidation(overrides = {}) {
  const script = `
    const env = require('./src/config/env');
    try {
      env.assertProductionSecurityConfig();
      process.stdout.write('ok');
    } catch (error) {
      process.stderr.write(String(error.message || error));
      process.exitCode = 1;
    }
  `;
  return spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_PASSWORD: 'database-password',
      JWT_SECRET: 'jwt-secret-at-least-32-random-bytes-long',
      DATA_ENCRYPT_KEY: '12345678901234567890123456789012',
      DATA_ENCRYPT_IV: '1234567890123456',
      WECHAT_MINIPROGRAM_APPID: 'wx-test-app-id',
      WECHAT_MINIPROGRAM_SECRET: 'wechat-app-secret-value',
      EMPLOYEE_BIND_HMAC_SECRET: 'employee-bind-hmac-secret-32-bytes',
      ...overrides
    }
  });
}

assert.equal(runProductionValidation().status, 0, '完整的生产配置应通过校验');

for (const [name, expectedMessage] of [
  ['WECHAT_MINIPROGRAM_APPID', 'WECHAT_MINIPROGRAM_APPID'],
  ['WECHAT_MINIPROGRAM_SECRET', 'WECHAT_MINIPROGRAM_SECRET'],
  ['EMPLOYEE_BIND_HMAC_SECRET', 'EMPLOYEE_BIND_HMAC_SECRET']
]) {
  const value = name === 'EMPLOYEE_BIND_HMAC_SECRET' ? 'too-short' : '';
  const result = runProductionValidation({ [name]: value });
  assert.notEqual(result.status, 0, `${name} 缺失或过短时生产启动必须失败`);
  assert.match(result.stderr, new RegExp(expectedMessage));
  assert.doesNotMatch(result.stderr, /wechat-app-secret-value|employee-bind-hmac-secret-32-bytes/);
}

console.log('employee-auth-config-tests-ok');
