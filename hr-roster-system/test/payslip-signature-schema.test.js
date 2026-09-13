const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const migrationPath = 'sql/migrate-payslip-signature-dispute-20260814.mysql.sql';
const migration = read(migrationPath);
const schema = read('sql/schema.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const verify = read('scripts/verify-release-package.sh');

for (const source of [migration, schema]) {
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?salary_signature/);
  assert.match(source, /signature_sha256 CHAR\(64\) NOT NULL/);
  assert.match(source, /active_salary_detail_id BIGINT GENERATED ALWAYS AS/);
  assert.match(source, /UNIQUE KEY uk_salary_signature_active/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?salary_dispute/);
  assert.match(source, /open_salary_detail_id BIGINT GENERATED ALWAYS AS/);
  assert.match(source, /UNIQUE KEY uk_open_dispute/);
}

assert.match(deploy, /migrate-payslip-signature-dispute-20260814\.mysql\.sql/);
assert.ok(verify.includes(`"${migrationPath}"`), '发布包必须包含工资签名与异议迁移');
assert.match(
  verify,
  /M\w*="sql\/migrate-payslip-signature-dispute-20260814\.mysql\.sql"/,
  '工资签名与异议迁移必须进入发布安全审计清单'
);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);

console.log('payslip-signature-schema-tests-ok');
