const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('sql/migrate-tencent-sms-20260814.mysql.sql', 'utf8');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const envSource = fs.readFileSync('src/config/env.js', 'utf8');
const envExample = fs.readFileSync('.env.production.example', 'utf8');
const deploy = fs.readFileSync('scripts/deploy-production.sh', 'utf8');
const releaseVerify = fs.readFileSync('scripts/verify-release-package.sh', 'utf8');
const compose = fs.readFileSync('docker-compose.prod.yml', 'utf8');

for (const source of [migration, schema]) {
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_sms_verification/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?sms_delivery_job/);
  assert.match(source, /uk_company_dedupe/);
  assert.match(source, /idx_pending/);
  assert.match(source, /phone_hash CHAR\(64\)/);
  assert.match(source, /code_hash CHAR\(64\)/);
}
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);

for (const name of [
  'TENCENT_SMS_ENABLED', 'TENCENT_SMS_REGION', 'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME', 'TENCENT_SMS_TEMPLATE_LOGIN_CODE',
  'TENCENT_SMS_TEMPLATE_PAYSLIP_PUBLISHED', 'TENCENT_SMS_TEMPLATE_PAYSLIP_REMINDER',
  'TENCENT_SMS_PAYSLIP_URL_LINK', 'WECHAT_MINIPROGRAM_URL_SCHEME', 'SMS_CODE_HMAC_SECRET'
]) {
  assert.match(envSource, new RegExp(name));
  assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  assert.match(compose, new RegExp(name + ': \\$\\{' + name), `Docker Compose 未传入 ${name}`);
}
assert.match(envExample, /^TENCENT_SMS_ENABLED=false$/m);
assert.match(envExample, /^TENCENT_SMS_TEMPLATE_PAYSLIP_PUBLISHED=2727678$/m,
  '工资条发布短信模板未配置为最新模板2727678');
assert.match(envExample, /^TENCENT_SMS_TEMPLATE_PAYSLIP_REMINDER=2727678$/m,
  '工资条催签短信模板未配置为最新模板2727678');
assert.match(envSource, /if \(!env\.tencentSms\.payslipUrlLink\)/,
  '短信启用时生产启动必须要求小程序 URL Link');
assert.match(envSource, /if \(!env\.wechatMini\.urlScheme\)/,
  '短信启用时生产启动必须要求微信小程序 URL Scheme');
assert.match(deploy, /短信启用时缺少小程序URL Link/,
  '短信启用时部署必须要求小程序 URL Link');
assert.match(deploy, /生产环境缺少WECHAT_MINIPROGRAM_URL_SCHEME/,
  '生产部署必须要求微信小程序 URL Scheme');
assert.match(deploy, /migrate-tencent-sms-20260814\.mysql\.sql/);
assert.match(releaseVerify, /migrate-tencent-sms-20260814\.mysql\.sql/);

console.log('tencent-sms-schema-config-tests-ok');
