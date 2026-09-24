const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const migrationPath = path.resolve(__dirname, '../sql/migrate-attendance-hourly-wage-20260916.mysql.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

for (const table of [
  'attendance_project_shift_rules',
  'attendance_allowance_rules',
  'employee_pay_profiles',
  'wage_calculation_runs',
  'wage_calculation_daily_lines',
  'wage_daily_payments'
]) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}

assert.match(sql, /attendance_schedules[\s\S]*shift_type/);
assert.match(sql, /attendance_schedules[\s\S]*project_shift_rule_id/);
assert.match(sql, /salary_batch[\s\S]*source_type/);
assert.match(sql, /salary_batch[\s\S]*calculation_run_id/);
assert.match(sql, /information_schema\.COLUMNS/);
assert.match(sql, /information_schema\.STATISTICS/);
assert.match(sql, /INSERT IGNORE INTO attendance_project_shift_rules/);
assert.doesNotMatch(sql, /\b(?:DELETE|DROP|TRUNCATE)\b/i);

console.log('attendance-hourly-wage-schema.test.js: passed');
