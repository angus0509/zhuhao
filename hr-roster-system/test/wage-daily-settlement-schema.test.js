const fs = require('node:fs');
const assert = require('node:assert/strict');

const path = 'sql/migrate-wage-daily-settlement-events-20260929.mysql.sql';
assert.equal(fs.existsSync(path), true, '日结事件迁移文件缺失');
const migration = fs.readFileSync(path, 'utf8');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const deploy = fs.readFileSync('scripts/deploy-production.sh', 'utf8');
const release = fs.readFileSync('scripts/verify-release-package.sh', 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS wage_daily_payment_events/);
assert.match(migration, /UNIQUE KEY uk_wage_daily_payment_event_request \(company_id, client_request_id, employee_id\)/);
assert.match(migration, /attendance_closure_id BIGINT DEFAULT NULL/);
assert.match(migration, /attendance_closure_version INT UNSIGNED DEFAULT NULL/);
assert.match(schema, /CREATE TABLE wage_daily_payment_events/);
assert.match(deploy, /run_migration "\$STAGE_DIR\/sql\/migrate-wage-daily-settlement-events-20260929\.mysql\.sql"/);
assert.match(release, /M36="sql\/migrate-wage-daily-settlement-events-20260929\.mysql\.sql"/);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
console.log('wage-daily-settlement-schema-tests-ok');
