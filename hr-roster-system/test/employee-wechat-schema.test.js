const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('sql/migrate-employee-wechat-login-20260814.mysql.sql');
const schema = read('sql/schema.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const verify = read('scripts/verify-release-package.sh');

for (const source of [migration, schema]) {
  assert.match(source, /account_type VARCHAR\(20\).*MANAGER/s);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_wechat_binding/);
  assert.match(
    source,
    /employee_wechat_binding[\s\S]*?phone VARCHAR\(20\) DEFAULT NULL/,
    '一次性绑定码面向无手机号员工，微信绑定记录不得强制手机号'
  );
  assert.match(source, /active_employee_id BIGINT GENERATED ALWAYS AS/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_bind_code/);
  assert.match(source, /failed_attempts TINYINT NOT NULL DEFAULT 0/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_login_audit/);
}

const migrationPath = 'sql/migrate-employee-wechat-login-20260814.mysql.sql';
assert.match(deploy, /migrate-employee-wechat-login-20260814\.mysql\.sql/);
assert.ok(verify.includes(`"${migrationPath}"`), '发布包必须包含员工微信登录迁移');
assert.match(
  verify,
  /M\w*="sql\/migrate-employee-wechat-login-20260814\.mysql\.sql"/,
  '员工微信登录迁移必须进入发布安全审计清单'
);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);

console.log('employee-wechat-schema-tests-ok');
