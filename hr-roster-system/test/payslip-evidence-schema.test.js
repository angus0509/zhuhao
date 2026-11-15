const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migrationPath = 'sql/migrate-payslip-evidence-chain-20261112.mysql.sql';
const migration = read(migrationPath);
const schema = read('sql/schema.mysql.sql');

for (const source of [migration, schema]) {
  assert.match(source, /evidence_schema_version VARCHAR\(20\) DEFAULT NULL/);
  assert.match(source, /evidence_snapshot JSON DEFAULT NULL/);
  assert.match(source, /evidence_content_sha256 CHAR\(64\) DEFAULT NULL/);
  assert.match(source, /evidence_created_at DATETIME DEFAULT NULL/);
  assert.match(source, /challenge_id BIGINT DEFAULT NULL/);
  assert.match(source, /previous_evidence_hash CHAR\(64\) DEFAULT NULL/);
  assert.match(source, /payslip_content_sha256 CHAR\(64\) DEFAULT NULL/);
  assert.match(source, /signature_sha256 CHAR\(64\) DEFAULT NULL/);
  assert.match(source, /statement_version VARCHAR\(20\) DEFAULT NULL/);
  assert.match(source, /evidence_key_version VARCHAR\(20\) DEFAULT NULL/);
  assert.match(source, /idx_evidence_chain \(company_id,salary_detail_id,employee_id,id\)/);

  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?salary_sign_challenge/);
  assert.match(source, /id BIGINT PRIMARY KEY AUTO_INCREMENT/);
  assert.match(source, /challenge_hash CHAR\(64\) NOT NULL/);
  assert.match(source, /KEY idx_payslip_employee_time \(company_id,salary_detail_id,employee_id,created_at\)/);
  assert.match(source, /KEY idx_expire \(expires_at,consumed_at\)/);

  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?salary_evidence_receipt/);
  assert.match(source, /receipt_no VARCHAR\(50\) NOT NULL/);
  assert.match(source, /receipt_payload JSON NOT NULL/);
  assert.match(source, /storage_path VARCHAR\(500\) NOT NULL/);
  assert.match(source, /receipt_sha256 CHAR\(64\) NOT NULL/);
  assert.match(source, /UNIQUE KEY uk_salary_evidence_receipt_detail \(company_id,salary_detail_id\)/);
  assert.match(source, /UNIQUE KEY uk_salary_evidence_receipt_no \(receipt_no\)/);
}

for (const source of [migration, schema]) {
  assert.doesNotMatch(source, /salary_sign_verification|verification_id/);
}

assert.match(migration, /information_schema\.COLUMNS/);
assert.match(migration, /information_schema\.STATISTICS/);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.doesNotMatch(migration, /UPDATE\s+salary_detail/i, '迁移不得静默回填历史工资条');

console.log('payslip-evidence-schema-tests-ok');
