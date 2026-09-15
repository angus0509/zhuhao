const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const verify = read('scripts/verify-release-package.sh');
const deploy = read('scripts/deploy-production.sh');
const migration = read('sql/migrate-remove-insurance-menu-20260807.mysql.sql');

const migrationPath = 'sql/migrate-remove-insurance-menu-20260807.mysql.sql';
assert.ok(verify.includes(`"${migrationPath}"`), '发布包验收必须要求保险菜单迁移文件存在');
assert.match(verify, /M\d+="sql\/migrate-remove-insurance-menu-20260807\.mysql\.sql"/, '保险菜单迁移必须进入统一安全审计清单');
assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${migrationPath}"`), '部署脚本必须执行保险菜单迁移');
assert.doesNotMatch(migration, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i, '停用菜单不得物理删除角色权限或历史数据');
assert.match(migration, /permission_code IN \('insurance:menu', 'insurance:view'\)/, '迁移必须精确停用旧保险菜单权限');
assert.match(migration, /status=0/, '迁移必须通过状态停用旧权限');

// 防止驻厂客户/项目管理权限迁移再次从生产部署链路中遗漏。
const onsitePermissionMigrationPath = 'sql/migrate-onsite-management-permissions-20260801.mysql.sql';
assert.ok(
  verify.includes(`"${onsitePermissionMigrationPath}"`),
  '发布包验收必须要求驻厂管理权限迁移文件存在'
);
assert.match(
  verify,
  /M\d+="sql\/migrate-onsite-management-permissions-20260801\.mysql\.sql"/,
  '驻厂管理权限迁移必须进入统一安全审计清单'
);
assert.ok(
  deploy.includes(`run_migration "$STAGE_DIR/${onsitePermissionMigrationPath}"`),
  '部署脚本必须执行驻厂管理权限迁移'
);
assert.match(
  deploy,
  /ONSITE_PROJECT_MANAGE_BROKEN=.*permission_code='project:manage'/,
  '部署后必须核验驻厂人员项目管理权限'
);
assert.match(
  deploy,
  /test "\$ONSITE_PROJECT_MANAGE_BROKEN" = "0"/,
  '驻厂人员缺少项目管理权限时部署必须失败'
);

const rememberLoginMigrationPath = 'sql/migrate-manager-remember-login-20260817.mysql.sql';
const rememberLoginMigration = read(rememberLoginMigrationPath);
assert.ok(verify.includes(`"${rememberLoginMigrationPath}"`), '发布包验收必须包含管理端记住登录迁移');
assert.match(verify, /M25="sql\/migrate-manager-remember-login-20260817\.mysql\.sql"/,
  '记住登录迁移必须进入统一安全审计清单');
assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${rememberLoginMigrationPath}"`),
  '部署脚本必须执行管理端记住登录迁移');
assert.match(deploy, /MANAGER_LOGIN_DEVICE_READY=.*manager_login_device/,
  '部署后必须核验管理端设备凭证表');
assert.match(rememberLoginMigration, /token_hash CHAR\(64\) NOT NULL/,
  '设备凭证只能保存SHA-256摘要');
assert.doesNotMatch(rememberLoginMigration, /password|refresh_token/i,
  '迁移表禁止保存密码或设备凭证明文');

const activeLifecycleMigrationPath = 'sql/migrate-active-employee-lifecycle-20260817.mysql.sql';
const activeLifecycleMigration = read(activeLifecycleMigrationPath);
assert.ok(verify.includes(`"${activeLifecycleMigrationPath}"`), '发布包验收必须包含在职生命周期修复迁移');
assert.match(verify, /M27="sql\/migrate-active-employee-lifecycle-20260817\.mysql\.sql"/,
  '在职生命周期修复迁移必须进入统一安全审计清单');
assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${activeLifecycleMigrationPath}"`),
  '部署脚本必须执行在职生命周期修复迁移');
assert.match(deploy, /STALE_ACTIVE_LIFECYCLE_COUNT=.*employee_status=2.*lifecycle_status='ONBOARDING'/,
  '部署后必须核验在职员工生命周期');
assert.doesNotMatch(activeLifecycleMigration, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i,
  '在职生命周期迁移不得删除任何数据');

const flexiblePayslipMigrationPath = 'sql/migrate-flexible-payslip-items-20260818.mysql.sql';
const flexiblePayslipMigration = read(flexiblePayslipMigrationPath);
assert.ok(verify.includes(`"${flexiblePayslipMigrationPath}"`), '发布包必须包含动态工资条迁移');
assert.match(verify, /M28="sql\/migrate-flexible-payslip-items-20260818\.mysql\.sql"/,
  '动态工资条迁移必须进入统一安全审计清单');
assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${flexiblePayslipMigrationPath}"`),
  '部署脚本必须执行动态工资条迁移');
assert.doesNotMatch(flexiblePayslipMigration, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i,
  '动态工资条迁移不得删除任何历史数据');

const payslipViewPolicyMigrationPath = 'sql/migrate-payslip-view-policy-20260820.mysql.sql';
const payslipViewPolicyMigration = read(payslipViewPolicyMigrationPath);
assert.ok(verify.includes(`"${payslipViewPolicyMigrationPath}"`), '发布包必须包含工资条查看策略迁移');
assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${payslipViewPolicyMigrationPath}"`), '部署脚本必须执行工资条查看策略迁移');
assert.match(payslipViewPolicyMigration, /employee_view_enabled/);
assert.match(payslipViewPolicyMigration, /view_once/);
assert.match(payslipViewPolicyMigration, /view_expires_minutes/);
assert.doesNotMatch(payslipViewPolicyMigration, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i, '查看策略迁移不得删除历史数据');

for (const attendanceMigrationPath of [
  'sql/migrate-attendance-timekeeping-20260909.mysql.sql',
  'sql/migrate-attendance-geofence-20260915.mysql.sql',
  'sql/migrate-web-project-attendance-20260915.mysql.sql'
]) {
  const attendanceMigration = read(attendanceMigrationPath);
  assert.ok(verify.includes(`"${attendanceMigrationPath}"`), `发布包必须包含 ${attendanceMigrationPath}`);
  assert.match(verify, new RegExp(`M\\d+=\"${attendanceMigrationPath.replaceAll('.', '\\.') }\"`),
    `${attendanceMigrationPath} 必须进入统一安全审计清单`);
  assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${attendanceMigrationPath}"`),
    `部署脚本必须执行 ${attendanceMigrationPath}`);
  assert.doesNotMatch(attendanceMigration, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i,
    `${attendanceMigrationPath} 不得删除历史数据`);
}
assert.match(deploy, /ATTENDANCE_TABLE_COUNT=.*attendance_shift_rules.*attendance_schedules.*attendance_punches.*attendance_daily_results.*attendance_correction_requests/s,
  '部署后必须核验考勤核心表');
assert.match(deploy, /ATTENDANCE_GEOFENCE_READY=.*attendance_geofences.*punch_id/s,
  '部署后必须核验电子围栏表和异常打卡关联字段');
assert.match(deploy, /PROJECT_ATTENDANCE_READY=.*attendance_project_rules.*attendance_project_calendar.*attendance_project_geofence.*customer_id.*attendance_schedules.*attendance_punches.*attendance_daily_results/s,
  '部署后必须核验项目考勤表、客户围栏和历史项目快照');

console.log('release-migration-consistency-tests-ok');
