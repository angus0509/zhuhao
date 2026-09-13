const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

assert.match(html, /id="payrollSmsSummary"/);
assert.match(html, /data-payroll-sms-action="remind"/);
assert.match(html, /data-payroll-sms-action="retry"/);
assert.match(app, /\/api\/payroll\/batches\/\$\{batchId\}\/sms-summary/);
assert.match(app, /\/sms-reminders/);
assert.match(app, /\/sms-retry/);
assert.match(app, /confirmed:\s*true/);
assert.match(app, /handlePayrollSmsAction[\s\S]*await confirmDialog\(/, '短信催签与重试必须使用统一确认弹窗');
assert.match(app, /\*\*\*\*\$\{escapeHtml\(item\.phoneTail/);
assert.match(app, /payrollSmsBusy/);
assert.match(app, /item\.deliveryStatusName/, '短信记录必须显示中文状态');
assert.match(app, /data\.retryableCount/, '补发按钮必须使用后端可补发数量');
assert.match(app, /progress\.pendingViewCount[\s\S]*progress\.pendingSignCount/,
  '催签按钮必须使用批次待查看和待签字数量');
assert.match(app, /无可补发短信/);
assert.match(app, /批次未发布/);
assert.match(app, /batchStatus/);
assert.match(app, /const batchPublished = batchStatus === 5/,
  '草稿批次必须优先判断是否发布，不能启用催签按钮');
assert.match(app, /remindButton\.disabled = Boolean\(state\.payrollSmsBusy\) \|\| !batchPublished \|\| remindableCount === 0/);
assert.match(app, /全部已签收/);
assert.match(css, /\.payroll-sms-summary/);
assert.doesNotMatch(html, /name="(?:phone|mobile)"[^>]*data-payroll-sms/i);

console.log('web-payroll-sms-management-tests-ok');
