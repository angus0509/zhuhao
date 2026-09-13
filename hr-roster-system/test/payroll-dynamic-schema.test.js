const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrationPath = 'sql/migrate-flexible-payslip-items-20260818.mysql.sql';
const schema = read('sql/schema.mysql.sql');
const migration = read(migrationPath);
const deploy = read('scripts/deploy-production.sh');
const verify = read('scripts/verify-release-package.sh');

assert.match(schema, /CREATE TABLE salary_import_profile/, '主结构缺少项目工资字段映射表');
assert.match(schema, /item_snapshot JSON DEFAULT NULL/, '工资明细缺少动态项目快照');
assert.match(schema, /source_row_no INT DEFAULT NULL/, '工资明细缺少原表行号');
assert.match(schema, /import_profile_id BIGINT DEFAULT NULL/, '工资批次缺少导入映射ID');
assert.match(schema, /source_sheet_name VARCHAR\(100\) DEFAULT NULL/, '工资批次缺少工作表名称');

assert.match(migration, /information_schema\.COLUMNS/, '迁移没有幂等检查已有字段');
assert.match(migration, /CREATE TABLE IF NOT EXISTS salary_import_profile/, '迁移缺少映射表');
assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i, '迁移不得删除历史工资数据');
assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${migrationPath}"`), '生产部署未执行动态工资条迁移');
assert.match(deploy, /PAYROLL_PROFILE_READY=.*salary_import_profile/, '部署后未核验字段映射表');
assert.match(deploy, /PAYROLL_ITEMS_READY=.*item_snapshot/, '部署后未核验工资项目快照字段');
assert.ok(verify.includes(`"${migrationPath}"`), '发布包未要求动态工资条迁移文件');
assert.match(verify, /M28="sql\/migrate-flexible-payslip-items-20260818\.mysql\.sql"/, '动态工资条迁移未进入安全审计清单');

console.log('payroll-dynamic-schema-tests-ok');
