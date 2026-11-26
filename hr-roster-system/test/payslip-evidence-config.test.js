const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const env = require('../src/config/env');
const envSource = fs.readFileSync(path.join(root, 'src/config/env.js'), 'utf8');
const productionCompose = fs.readFileSync(path.join(root, 'docker-compose.prod.yml'), 'utf8');

assert.equal(env.payslipEvidence?.challengeTtlSeconds, 300);
assert.equal(env.payslipEvidence?.keyVersion, 'v2');
assert.match(envSource, /PAYSLIP_EVIDENCE_HMAC_SECRET/);
assert.match(
  productionCompose,
  /PAYSLIP_EVIDENCE_HMAC_SECRET:\s*\$\{PAYSLIP_EVIDENCE_HMAC_SECRET:\?PAYSLIP_EVIDENCE_HMAC_SECRET未配置\}/,
  '生产 Compose 必须将工资条证据链密钥透传给应用容器'
);
assert.doesNotMatch(envSource, /TENCENT_SMS_TEMPLATE_PAYSLIP_SIGN_CODE/);

function runProductionValidation(secret) {
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
      TENCENT_SMS_ENABLED: 'false',
      WECHAT_OFFICIAL_ENABLED: 'false',
      PAYSLIP_EVIDENCE_HMAC_SECRET: secret
    }
  });
}

assert.equal(runProductionValidation('payslip-evidence-secret-at-least-32-bytes').status, 0);
for (const secret of ['', 'too-short']) {
  const result = runProductionValidation(secret);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PAYSLIP_EVIDENCE_HMAC_SECRET/);
  assert.doesNotMatch(result.stderr, /payslip-evidence-secret-at-least-32-bytes/);
}

console.log('payslip-evidence-config-tests-ok');
