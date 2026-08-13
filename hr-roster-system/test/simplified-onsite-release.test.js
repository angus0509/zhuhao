const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migrationPath = 'sql/migrate-simplified-onsite-flow-20260813.mysql.sql';
const migration = read(migrationPath);
const deploy = read('scripts/deploy-production.sh');
const verify = read('scripts/verify-release-package.sh');
const schema = read('sql/schema.mysql.sql');
const pkg = JSON.parse(read('package.json'));

assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i, '简化流程迁移不得删除结构或历史数据');
assert.match(migration, /'ONBOARDING_COMPLIANCE'/, '迁移缺少合并合规待办');
assert.match(migration, /task_type IN \('CONTRACT','INSURANCE'\)[\s\S]*task_status=3/, '迁移未关闭旧开放合规待办');
assert.match(migration, /ON DUPLICATE KEY UPDATE/, '迁移缺少重复执行保护');
assert.match(schema, /ONBOARDING_COMPLIANCE/, '主数据库结构注释未登记合并待办类型');
assert.ok(deploy.includes(`run_migration "$STAGE_DIR/${migrationPath}"`), '生产部署未执行简化流程迁移');
assert.ok(verify.includes(`"${migrationPath}"`), '发布包验收未要求简化流程迁移');
assert.match(verify, /M18="sql\/migrate-simplified-onsite-flow-20260813\.mysql\.sql"/, '迁移未加入统一安全检查清单');
assert.match(pkg.scripts.check, /onsite-simplified-stage-flow\.test\.js/, 'check 未包含面试到岗专项测试');
assert.match(pkg.scripts.check, /one-click-onboarding-compliance\.test\.js/, 'check 未包含一键合规专项测试');
assert.match(pkg.scripts.check, /miniprogram-simplified-onsite-flow\.test\.js/, 'check 未包含小程序简化流程测试');
assert.match(pkg.scripts['check:web'], /web-simplified-onsite-flow\.test\.js/, 'check:web 未包含网页简化流程测试');
assert.match(pkg.scripts.postcheck, /simplified-onsite-release\.test\.js/, 'postcheck 未包含发布专项测试');

console.log('simplified-onsite-release-tests-ok');
