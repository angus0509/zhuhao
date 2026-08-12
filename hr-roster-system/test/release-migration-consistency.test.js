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

console.log('release-migration-consistency-tests-ok');
