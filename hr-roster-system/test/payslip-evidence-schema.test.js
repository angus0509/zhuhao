const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migrationPath = 'sql/migrate-payslip-evidence-chain-20261112.mysql.sql';
const migration = read(migrationPath);
const dynamicReceiptMigrationPath = 'sql/migrate-payslip-dynamic-receipt-20261126.mysql.sql';
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
  assert.match(source, /UNIQUE KEY uk_salary_evidence_receipt_detail \(company_id,salary_detail_id\)/);
  assert.match(source, /UNIQUE KEY uk_salary_evidence_receipt_no \(receipt_no\)/);
}

assert.match(migration, /storage_path VARCHAR\(500\) NOT NULL/);
assert.match(migration, /receipt_sha256 CHAR\(64\) NOT NULL/);

assert.ok(fs.existsSync(path.join(root, dynamicReceiptMigrationPath)), '必须提供动态回执幂等迁移');
const dynamicReceiptMigration = read(dynamicReceiptMigrationPath);
assert.match(schema, /storage_mode VARCHAR\(20\) NOT NULL DEFAULT 'FILE'/);
assert.match(schema, /storage_path VARCHAR\(500\) NULL/);
assert.match(schema, /receipt_sha256 CHAR\(64\) NULL/);
assert.match(schema, /receipt_payload_hmac CHAR\(64\) NULL/);
assert.match(schema, /receipt_payload_key_version VARCHAR\(20\) NULL/);
assert.match(schema, /CHECK \(storage_mode <> 'DYNAMIC' OR receipt_payload_hmac IS NOT NULL\)/);
assert.match(schema, /CHECK \(storage_mode <> 'DYNAMIC' OR receipt_payload_key_version IS NOT NULL\)/);
assert.match(schema, /CHECK \(\(storage_mode = 'FILE' AND storage_path IS NOT NULL AND receipt_sha256 IS NOT NULL\) OR \(storage_mode = 'DYNAMIC' AND storage_path IS NULL AND receipt_sha256 IS NULL\)\)/);
assert.match(dynamicReceiptMigration, /information_schema\.COLUMNS/);
assert.match(dynamicReceiptMigration, /information_schema\.TABLE_CONSTRAINTS/);
assert.match(dynamicReceiptMigration, /storage_mode VARCHAR\(20\) NOT NULL DEFAULT ''FILE''/);
assert.match(dynamicReceiptMigration, /storage_path VARCHAR\(500\) NULL/);
assert.match(dynamicReceiptMigration, /receipt_sha256 CHAR\(64\) NULL/);
assert.match(dynamicReceiptMigration, /receipt_payload_hmac CHAR\(64\) NULL/);
assert.match(dynamicReceiptMigration, /receipt_payload_key_version VARCHAR\(20\) NULL/);
assert.match(dynamicReceiptMigration, /CONSTRAINT_TYPE='CHECK'/,
  '幂等检查必须确认同名约束确实是CHECK约束');
assert.match(dynamicReceiptMigration,
  /CHECK \(storage_mode <> ''DYNAMIC'' OR receipt_payload_hmac IS NOT NULL\)/);
assert.match(dynamicReceiptMigration,
  /CHECK \(storage_mode <> ''DYNAMIC'' OR receipt_payload_key_version IS NOT NULL\)/);
assert.match(dynamicReceiptMigration, /CHECK \(\(storage_mode = ''FILE'' AND storage_path IS NOT NULL AND receipt_sha256 IS NOT NULL\) OR \(storage_mode = ''DYNAMIC'' AND storage_path IS NULL AND receipt_sha256 IS NULL\)\)/);
assert.doesNotMatch(dynamicReceiptMigration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.doesNotMatch(dynamicReceiptMigration, /UPDATE\s+salary_evidence_receipt/i,
  '动态回执迁移不得改写历史FILE记录');

for (const source of [migration, schema]) {
  assert.doesNotMatch(source, /salary_sign_verification|verification_id/);
}

assert.match(migration, /information_schema\.COLUMNS/);
assert.match(migration, /information_schema\.STATISTICS/);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.doesNotMatch(migration, /UPDATE\s+salary_detail/i, '迁移不得静默回填历史工资条');

console.log('payslip-evidence-schema-tests-ok');
