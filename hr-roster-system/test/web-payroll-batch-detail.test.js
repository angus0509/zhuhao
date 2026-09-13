const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('public/index.html');
const app = read('public/app.js');
const state = read('public/js/core/state.js');
const style = read('public/styles.css');

assert.match(state, /payrollBatchDetail:\s*null/, '缺少工资批次详情前端状态');
assert.match(html, /id="payrollBatchDetailModal"/, '缺少工资批次详情弹窗');
assert.match(html, /id="payrollBatchProgress"/, '缺少工资条签收进度看板');
assert.match(html, /id="payrollBatchEmployeeBody"/, '缺少批次员工工资条明细');
assert.match(html, /id="payrollBatchDetailPager"/, '缺少批次员工分页区域');
assert.match(html, /id="payrollBatchStatusTabs"/, '缺少工资条员工状态页签');
assert.match(html, /id="payrollBatchEmployeeSearch"/, '缺少工资条员工搜索');
assert.match(html, /data-payroll-detail-export="delivery"/, '缺少发放明细导出');
assert.match(html, /data-payroll-detail-export="receipt"/, '缺少签收记录导出');

assert.match(app, /data-payroll-batch-detail=/, '工资批次列表缺少查看详情入口');
assert.match(app, /async function openPayrollBatchDetail/);
assert.match(app, /\/api\/payroll\/batches\/\$\{batchId\}\/details\?page=/);
assert.match(app, /PayrollWorkbench\.countStatuses/, '工资条状态人数必须由统一状态规则计算');
assert.match(app, /escapeHtml\(item\.employeeName\)/, '员工姓名必须转义后显示');
assert.match(app, /item\.wechatBound\s*\?\s*'已绑定'/, '批次详情缺少微信绑定状态');
assert.match(app, /item\.displayStatus/, '批次详情缺少员工工资条状态');
assert.match(app, /item\.hasAmountWarning/, '批次详情缺少金额异常标识');
assert.match(app, /item\.amountWarnings/, '批次详情缺少金额异常原因');
assert.match(app, /data-payroll-detail-page=/, '批次详情缺少分页操作');
assert.match(app, /renderPayrollBatchEmployeeRows/, '批次员工明细必须支持重新筛选渲染');
assert.match(app, /PayrollWorkbench\.filterRows/, '批次详情必须通过统一状态规则筛选员工');
assert.match(app, /payrollBatchEmployeeSearch/, '工资条详情搜索框未绑定');

assert.match(style, /\.payroll-batch-progress/);
assert.match(style, /\.payroll-detail-hero/);
assert.match(style, /\.payroll-bind-state/);
assert.match(style, /\.payroll-workbench-toolbar/);
assert.match(style, /\.payroll-status-tabs/);
assert.match(style, /\.payroll-amount-warning/);
assert.match(
  style,
  /\.modal\.payroll-workbench-modal\s*\{[^}]*width:\s*min\(1480px,\s*calc\(100vw\s*-\s*24px\)\)/s,
  '工资条专用宽弹窗会被后置的通用 modal 宽度覆盖'
);
assert.match(
  style,
  /\.payroll-batch-progress::\-webkit-scrollbar\s*\{[^}]*height:\s*6px/s,
  '工资条状态页签缺少可见的横向滚动提示'
);
assert.match(
  style,
  /@media \(max-width: 760px\)[\s\S]*\[data-payroll-sms-action="remind"\]\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
  '手机端催签按钮未独占整行，长文案会被挤压换行'
);
assert.match(
  style,
  /@media \(min-width: 761px\) and \(max-width: 1180px\)[\s\S]*\.payroll-status-tab\s*\{[^}]*padding:\s*0\s+10px[^}]*gap:\s*6px/s,
  '中等宽度电脑的工资条状态页签未收紧，末端状态会被截断'
);

console.log('web-payroll-batch-detail-tests-ok');
require('./web-payroll-view-policy-layout.test').run();
