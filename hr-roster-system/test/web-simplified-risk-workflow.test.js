const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('public/index.html');
const app = read('public/app.js');
const router = read('public/js/core/router.js');
const state = read('public/js/core/state.js');
const navigation = require('../public/js/core/navigation-groups');
const workbenchPath = path.join(root, 'public/js/core/risk-workbench.js');

const employeeNavigation = navigation.buildNavigationModel({
  activeView: 'roster',
  permissions: ['office:menu', 'employee:menu', 'talent:menu'],
  isCompanyAdmin: false
});
assert.equal(
  employeeNavigation.some(group => group.id === 'delivery'),
  false,
  '没有客户项目权限的账号不应再看到仅包含驻厂待办的菜单组'
);

const adminNavigation = navigation.buildNavigationModel({
  activeView: 'projects',
  permissions: [],
  isCompanyAdmin: true
});
assert.deepEqual(
  adminNavigation.find(group => group.id === 'delivery').items.map(item => item.view),
  ['projects'],
  '客户与驻厂菜单只应保留客户项目'
);

for (const removedHtml of [
  'id="tasksView"',
  'id="contractForm"',
  'id="complianceForm"',
  'id="socialForm"',
  'id="riskCaseForm"',
  'name="terminateEmployerInsurance"'
]) {
  assert.equal(html.includes(removedHtml), false, `网页仍保留已取消入口：${removedHtml}`);
}
for (const removedRiskUi of ['id="riskView"', 'id="riskStatusFilter"', 'id="riskTableBody"', 'id="riskDetailModal"', 'id="riskDetailContent"', '/js/core/risk-workbench.js']) {
  assert.equal(html.includes(removedRiskUi), false, `网页仍保留已下线风险页面：${removedRiskUi}`);
}
assert.equal(app.includes('/合同|雇主险|保险减员/'), true, '办公消息未过滤已取消流程的行动提示');

for (const removedScript of [
  'loadWorkTasks',
  'openContractModal',
  'openComplianceModal',
  'openSocialModal',
  'submitContract',
  'submitOnboardingCompliance',
  'submitSocial',
  'openRiskCaseModal',
  'saveRiskCase',
  'terminateEmployerInsurance'
]) {
  assert.equal(app.includes(removedScript), false, `网页脚本仍保留已取消流程：${removedScript}`);
}
assert.equal(router.includes('tasks:'), false, '网页路由仍注册驻厂待办');
assert.equal(state.includes('workTasks:'), false, '网页状态仍保存驻厂待办数据');
assert.equal(state.includes('riskCases:'), false, '网页状态仍保存已取消的风险整改任务');

assert.equal(fs.existsSync(workbenchPath), true, '历史风险筛选模块应保留供后端兼容测试');
const { buildRiskWorkbench } = require(workbenchPath);
const rows = [
  { id: 1, employeeName: '张三', customerName: '甲公司', projectId: 10, riskLevel: 3, handleStatus: 0 },
  { id: 2, employeeName: '李四', customerName: '乙公司', projectId: 20, riskLevel: 2, handleStatus: 2 },
  { id: 3, employeeName: '王五', customerName: '甲公司', projectId: 10, riskLevel: 1, handleStatus: 1 }
];

assert.deepEqual(buildRiskWorkbench(rows, { status: 'open' }).filtered.map(row => row.id), [1, 3]);
assert.deepEqual(buildRiskWorkbench(rows, { status: 'handled' }).filtered.map(row => row.id), [2]);
assert.deepEqual(buildRiskWorkbench(rows, { status: 'all', keyword: '乙公司' }).filtered.map(row => row.id), [2]);
assert.deepEqual(buildRiskWorkbench(rows, { status: 'all', projectId: 10 }).filtered.map(row => row.id), [1, 3]);
assert.deepEqual(buildRiskWorkbench(rows).summary, { total: 3, open: 2, high: 1, handled: 1 });

console.log('web-simplified-risk-workflow-tests-ok');
