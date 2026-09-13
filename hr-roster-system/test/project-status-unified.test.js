const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const web = read('public/app.js');
const prototype = read('server.js');
const operations = read('src/services/operations.service.js');
const portal = read('src/services/portal.service.js');
const employee = read('src/services/employee.service.js');
const schema = read('sql/schema.mysql.sql');
const packageJson = JSON.parse(read('package.json'));
const releaseVerify = read('scripts/verify-release-package.sh');
const deploy = read('scripts/deploy-production.sh');
const migrationPath = path.join(root, 'sql/migrate-remove-project-preparation-20260817.mysql.sql');
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';
const fixture = JSON.parse(read('data/db.json'));

assert.doesNotMatch(web, />筹备<|status === 1 \? 'selected'/, 'Web 项目状态不得再显示筹备');
assert.match(
  web,
  /projects\.filter\(item => Number\(item\.status\) === 2\)\.length/,
  'Web 生效项目必须只统计进行中项目'
);
assert.match(
  web,
  /canViewCustomers \? apiAllPages\('\/api\/clients'\)[\s\S]*?apiAllPages\('\/api\/projects'\)/,
  '客户项目页必须读取完整客户和项目分页，不能只统计默认第一页的 20 条'
);
assert.match(
  web,
  /Number\(item\.customerId\) === customerId && Number\(item\.status\) === 2/,
  '预支项目选择器只能展示进行中项目'
);
assert.match(web, /生效 \$\{item\.effectiveProjectCount \|\| 0\} \/ 全部 \$\{item\.projectCount \|\| 0\}/,
  '客户卡片必须分别展示生效项目数和全部项目数');

assert.match(operations, /p\.status = 2 \$\{projectScope\(user, params, 'p'\)\}/,
  '生产工作台在营项目必须只统计进行中项目');
assert.equal((operations.match(/p\.status=2 \$\{projectScope\(user, projectParams, 'p'\)\}/g) || []).length >= 3, true,
  '预支、工资预览和工资创建都必须只允许进行中项目');
assert.doesNotMatch(operations, /p\.status IN \(1,2\)/,
  '生产项目业务校验不得继续接受已取消的筹备状态');
assert.doesNotMatch(employee, /p\.status IN \(1,2\)|status IN \(1,2\)/,
  '员工录入、权限范围和批量导入不得继续接受筹备项目');
assert.match(portal, /COUNT\(DISTINCT CASE WHEN p\.status = 2 THEN p\.id END\) effectiveProjectCount/,
  '客户列表必须返回生效项目数');

assert.match(prototype, /delivery:\s*\{[\s\S]*?activeProjects:\s*db\.projects\.filter\(item => Number\(item\.status\) === 2\)\.length/,
  '本地工作台必须返回与生产一致的在营项目统计');
assert.equal((prototype.match(/item\.status === 2/g) || []).length >= 2, true,
  '本地工资和预支项目校验必须使用进行中状态');
assert.doesNotMatch(prototype, /projectName: '[^']+'[^\n]+status: 1/,
  '本地原型新建数据的项目默认状态不得为筹备');

assert.match(schema, /status TINYINT NOT NULL DEFAULT 2 COMMENT '2进行中 3暂停 4结束'/,
  '新建项目的数据库默认状态必须为进行中');
assert.match(migration, /UPDATE labor_project\s+SET status = 2\s+WHERE status = 1/i,
  '迁移必须把历史筹备项目转为进行中');
assert.doesNotMatch(migration, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i,
  '项目状态迁移不得删除业务数据');
assert.equal(fixture.projects.every(project => Number(project.status) !== 1), true,
  '本地原型项目数据不得保留筹备状态');
assert.match(packageJson.scripts.precheck, /node test\/project-status-unified\.test\.js/,
  '项目状态回归测试必须进入完整检查');
assert.match(releaseVerify, /M26="sql\/migrate-remove-project-preparation-20260817\.mysql\.sql"/,
  '项目状态迁移必须进入发布包安全检查');
assert.match(deploy, /run_migration "\$STAGE_DIR\/sql\/migrate-remove-project-preparation-20260817\.mysql\.sql"/,
  '生产部署脚本必须执行项目状态迁移');

console.log('project-status-unified-tests-ok');
