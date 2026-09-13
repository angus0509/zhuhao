const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const employeeService = read('src/services/employee.service.js');
const riskService = read('src/services/risk.service.js');
const migration = read('sql/migrate-disable-contract-insurance-risk-20260831.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const operations = read('src/services/operations.service.js');
const workTasks = read('src/services/work-task.service.js');
const notices = read('src/services/notice.service.js');
const routes = read('src/routes/employee.routes.js');
const contractPage = read('wechat-miniprogram/miniprogram/pages/employees/contract/index.js');
const insurancePage = read('wechat-miniprogram/miniprogram/pages/employees/insurance/index.js');
const compliancePage = read('wechat-miniprogram/miniprogram/pages/employees/compliance/index.js');

for (const fn of ['confirmOnboardingCompliance', 'createContract', 'updateSocialSecurity']) {
  const start = employeeService.indexOf(`async function ${fn}`);
  assert.ok(start >= 0, `${fn} 接口实现不存在`);
  const block = employeeService.slice(start, start + 220);
  assert.match(block, /throw createError\('功能已停用', 410\)/, `${fn} 未统一返回功能已停用`);
}

assert.match(riskService, /if \(\[1, 2, 3, 7\]\.includes\(Number\(risk\.riskType\)\)\) return 0;/, '合同/雇主险风险仍可被创建');
const scanStart = riskService.indexOf('async function scanRisks');
const scanBlock = riskService.slice(scanStart, scanStart + 2600);
assert.doesNotMatch(scanBlock, /scanMissingContracts\(|scanEmployerInsurance\(/, '风险扫描仍生成合同或雇主险提醒');
assert.match(scanBlock, /return \{ created: 0, disabled: true \}/, '风险扫描未返回停用状态');
assert.match(migration, /task_type IN \('CONTRACT', 'INSURANCE', 'ONBOARDING_COMPLIANCE'\)/, '旧合规待办未关闭');
assert.match(migration, /risk_type IN \(1, 2, 3, 7\)/, '旧合同/雇主险风险未关闭');
assert.match(read('server.js'), /if \(\[1, 2, 3, 7\]\.includes\(Number\(risk\.riskType\)\)\) return false;/, '原型服务仍可生成旧风险通知');
assert.match(deploy, /migrate-disable-contract-insurance-risk-20260831\.mysql\.sql/, '生产部署未执行停用迁移');
assert.match(operations, /INSURANCE_TERMINATION/);
assert.match(operations, /filter\(item => !\['CONTRACT', 'INSURANCE', 'INSURANCE_TERMINATION', 'ONBOARDING_COMPLIANCE'\]/, '工作台仍展示雇主险旧待办');
assert.doesNotMatch(workTasks, /t\.task_type IN \('OFFBOARD','INSURANCE_TERMINATION'\)/, '待办列表仍展示旧雇主险减保任务');
assert.match(notices, /disabledLegacyNotice/, '通知服务缺少旧合同/雇主险通知拦截');
assert.match(routes, /const featureDisabled = .*status\(410\)/, '旧接口未统一返回停用状态');
assert.doesNotMatch(routes, /onboarding-compliance\/confirm'.*requireAllPermissions/, '旧合规接口仍执行权限业务处理');
for (const [name, page] of [['合同', contractPage], ['雇主险', insurancePage], ['入职合规', compliancePage]]) {
  assert.match(page, /title: '功能已停用'/, `${name}页面未显示停用提示`);
  assert.match(page, /content: '[^']*历史[^']*查看/, `${name}页面未引导查看历史数据`);
}

console.log('disabled-contract-insurance-flow-tests-ok');
