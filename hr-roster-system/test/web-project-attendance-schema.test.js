const fs = require('node:fs');
const assert = require('node:assert/strict');

const sql = fs.readFileSync('sql/migrate-web-project-attendance-20260915.mysql.sql', 'utf8');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const deploy = fs.readFileSync('scripts/deploy-production.sh', 'utf8');

for (const table of [
  'attendance_project_rules',
  'attendance_project_calendar',
  'attendance_project_geofence'
]) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}

assert.match(sql, /attendance_geofences[\s\S]*customer_id/);
assert.match(
  sql,
  /TABLE_NAME='attendance_geofences'[\s\S]*COLUMN_NAME='project_id'[\s\S]*IS_NULLABLE='NO'[\s\S]*MODIFY COLUMN project_id BIGINT DEFAULT NULL/,
  '旧项目围栏的 project_id 必须幂等改为可空，支持客户围栏脱离单一项目'
);
assert.doesNotMatch(sql, /ON DUPLICATE KEY UPDATE[\s\S]*status/i,
  '重复执行迁移不得重新启用或改写项目围栏关联状态');
assert.match(sql, /INSERT IGNORE INTO attendance_project_geofence/,
  '旧围栏关联只能补充不存在的数据');

for (const table of ['attendance_schedules', 'attendance_punches', 'attendance_daily_results']) {
  assert.match(sql, new RegExp(`TABLE_NAME='${table}'[\\s\\S]*COLUMN_NAME='project_id'`));
}

assert.match(sql, /TABLE_NAME='attendance_schedules'[\s\S]*COLUMN_NAME='project_rule_id'/,
  '排班必须支持项目规则快照');
assert.match(
  sql,
  /TABLE_NAME='attendance_schedules'[\s\S]*COLUMN_NAME='shift_rule_id'[\s\S]*IS_NULLABLE='NO'[\s\S]*MODIFY COLUMN shift_rule_id BIGINT DEFAULT NULL/,
  '旧班次规则必须幂等改为可空'
);
assert.match(
  sql,
  /TABLE_NAME='attendance_schedules'[\s\S]*CONSTRAINT_NAME='chk_attendance_schedule_rule_source'[\s\S]*CHECK \(\(shift_rule_id IS NOT NULL\) <> \(project_rule_id IS NOT NULL\)\)/,
  '迁移必须幂等增加手工班次规则或项目规则恰好二选一约束'
);

for (const table of ['attendance_shift_rules', 'attendance_correction_requests']) {
  assert.match(schema, new RegExp(`CREATE TABLE ${table} \\(`), `全量结构缺少 ${table}`);
}
assert.match(schema, /CREATE TABLE attendance_correction_requests[\s\S]*punch_id BIGINT DEFAULT NULL/,
  '全量结构的异常申请必须包含围栏异常关联打卡');
assert.match(schema, /CREATE TABLE attendance_schedules[\s\S]*shift_rule_id BIGINT DEFAULT NULL[\s\S]*project_rule_id BIGINT DEFAULT NULL/,
  '全量排班结构必须支持旧班次规则或项目规则二选一');
assert.match(schema, /CONSTRAINT chk_attendance_schedule_rule_source CHECK \(\(shift_rule_id IS NOT NULL\) <> \(project_rule_id IS NOT NULL\)\)/,
  '全量排班结构必须约束规则来源恰好二选一');

for (const name of [
  'uk_attendance_geofence_customer_name',
  'idx_attendance_schedule_project_date',
  'idx_attendance_punch_project_date',
  'idx_attendance_daily_project_date'
]) {
  assert.match(deploy, new RegExp(name), `部署后必须核验关键索引 ${name}`);
}
assert.match(deploy, /project_rule_id/, '部署后必须核验项目规则列');
assert.match(deploy, /shift_rule_id[\s\S]*IS_NULLABLE='YES'/, '部署后必须核验旧班次规则已可空');
assert.match(deploy, /attendance_geofences[\s\S]*project_id[\s\S]*IS_NULLABLE='YES'/,
  '部署后必须核验客户围栏不再强制绑定单一项目');
assert.match(deploy, /CONSTRAINT_NAME='chk_attendance_schedule_rule_source'/,
  '部署后必须核验排班规则来源约束');
assert.match(deploy, /UNASSIGNED_ATTENDANCE_GEOFENCE_COUNT=.*customer_id IS NULL/,
  '部署后必须只读统计未归属客户的历史围栏');
assert.match(deploy, /echo .*未归属客户的历史围栏/,
  '部署日志必须明确打印未归属客户的历史围栏数量');

assert.doesNotMatch(sql, /\b(?:DELETE|DROP|TRUNCATE)\b/i);

console.log('web-project-attendance-schema-tests-ok');
