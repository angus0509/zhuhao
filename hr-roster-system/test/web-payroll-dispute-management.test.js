const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('public/index.html');
const app = read('public/app.js');
const state = read('public/js/core/state.js');
const style = read('public/styles.css');

assert.match(html, /id="payrollDisputeStatusFilter"/, '工资管理页缺少异议状态筛选');
assert.match(html, /id="payrollDisputeTableBody"/, '工资管理页缺少异议列表');
assert.match(html, /id="payrollDisputeModal"/, '工资管理页缺少异议处理弹窗');
assert.match(html, /name="remark"[^>]*maxlength="500"/, '异议处理说明缺少长度限制');
assert.match(html, /data-payroll-dispute-action="processing"/, '缺少标记处理中操作');
assert.match(html, /data-payroll-dispute-action="resolve"/, '缺少确认解决操作');
assert.match(html, /data-payroll-dispute-action="reject"/, '缺少驳回异议操作');

assert.match(state, /payrollDisputes:\s*\[\]/, '前端状态未保存当前工资异议列表');
assert.match(app, /async function loadPayrollDisputes/);
assert.match(app, /\/api\/payroll\/disputes\?handleStatus=/);
assert.match(app, /escapeHtml\(item\.disputeReason\)/,
  '员工提交的工资异议原因必须转义后才能进入HTML');
assert.match(app, /data-handle-payroll-dispute=/);
assert.match(app, /\/api\/payroll\/disputes\/\$\{disputeId\}\/handle/);
assert.match(app, /method:\s*'PUT'/);
assert.match(app, /JSON\.stringify\(\{ action, remark \}\)/);
assert.match(app, /async function loadPayroll\(\)[\s\S]*Promise\.all\(\[loadPayrollOverview\(\), loadPayrollDisputes\(\)\]\)/,
  '工资管理页必须同步刷新工资汇总和异议列表');
assert.match(app, /工资异议处理完成[\s\S]{0,300}return loadPayroll\(\)/,
  '处理异议后必须同步刷新异议列表和工资汇总');

assert.match(style, /\.payroll-dispute-toolbar/);
assert.match(style, /\.payroll-dispute-reason/);
assert.match(style, /\.payroll-dispute-modal-panel/);

console.log('web-payroll-dispute-management-tests-ok');
