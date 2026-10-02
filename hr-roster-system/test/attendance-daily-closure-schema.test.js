const fs = require('node:fs');
const assert = require('node:assert/strict');

const migrationPath = 'sql/migrate-attendance-daily-closure-20260929.mysql.sql';
assert.equal(fs.existsSync(migrationPath), true, 'missing attendance closure migration');
const migration = fs.readFileSync(migrationPath, 'utf8');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const deploy = fs.readFileSync('scripts/deploy-production.sh', 'utf8');

for (const table of [
  'attendance_daily_closures',
  'attendance_daily_closure_events',
  'attendance_daily_review_events'
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(schema, new RegExp(`CREATE TABLE ${table}`));
}
assert.match(
  migration,
  /UNIQUE KEY uk_attendance_daily_closure \(company_id, project_id, shift_date\)/
);
assert.match(
  migration,
  /UNIQUE KEY uk_attendance_closure_request \(company_id, client_request_id\)/
);
assert.match(
  migration,
  /UNIQUE KEY uk_attendance_daily_review_request \(company_id, client_request_id\)/
);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.match(deploy, /migrate-attendance-daily-closure-20260929\.mysql\.sql/);
console.log('attendance-daily-closure-schema-tests-ok');
