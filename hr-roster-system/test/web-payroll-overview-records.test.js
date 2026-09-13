const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/styles.css');
const prototype = read('server.js');

for (const tab of ['overview', 'records', 'disputes']) {
  assert.match(html, new RegExp(`data-payroll-workspace-tab="${tab}"`), `缺少工资工作区页签：${tab}`);
  assert.match(html, new RegExp(`data-payroll-workspace-panel="${tab}"`), `缺少工资工作区面板：${tab}`);
}

assert.match(html, /id="payrollOverviewTasks"/, '概览缺少可操作待办区');
assert.match(html, /id="payrollRecentBatches"/, '概览缺少最近工资批次');
assert.match(html, /id="payrollRecordsGroups"/, '发放记录缺少按月分组容器');
assert.match(html, /id="payrollRecordStatusFilter"/, '发放记录缺少状态筛选');
assert.match(app, /function switchPayrollWorkspace/);
assert.match(app, /function renderPayrollOverview/);
assert.match(app, /function renderPayrollRecords/);
const overviewBlock = app.slice(app.indexOf('function renderPayrollOverview'), app.indexOf('function payrollRecordMatches'));
assert.doesNotMatch(overviewBlock, /累计应发|累计实发/, '工资工作台概览不应显示应发和实发总金额');
assert.match(overviewBlock, /['"]计薪人数['"]/);
assert.match(app, /payroll-record-month-head[\s\S]*items\.length/,
  '工资发放记录必须按工资月份分组并显示每月批次数');
assert.match(app, /data-payroll-record-filter/);
assert.match(app, /data\.employeeTotal/, '计薪人数必须使用后端已发布批次统计');
assert.match(app, /data\.viewedTotal/, '已查看必须使用后端已发布批次统计');
assert.match(app, /data\.signedTotal/, '已签收必须使用后端已发布批次统计');
assert.match(app, /data\.pendingBatchCount/, '待发布数量必须使用后端全量统计');
assert.match(app, /pendingBatchStatuses/,
  '待处理筛选必须限制在草稿、核算中、待复核、待发放状态，不能包含已归档批次');
assert.match(app, /viewRate/);
assert.match(app, /signRate/);
assert.match(css, /\.payroll-record-month/);
assert.match(css, /\.payroll-progress-track/);
assert.match(css, /\.payroll-overview-kpis\s*\{\s*grid-template-columns:\s*repeat\(4,/,
  '工资概览应使用四项核心指标的紧凑布局');
assert.match(
  css,
  /\.payroll-overview-kpis \.mini-kpi strong\s*\{[^}]*font-family:\s*Inter,\s*"SF Pro Text",\s*"PingFang SC",\s*"Microsoft YaHei",\s*sans-serif/s,
  '工资概览数字必须使用常规无衬线字体'
);
assert.match(prototype, /viewedCount/);
assert.match(prototype, /batchStatus/);

console.log('web-payroll-overview-records-tests-ok');
