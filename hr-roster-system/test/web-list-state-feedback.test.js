const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const tableBody = { innerHTML: '' };
const context = vm.createContext({
  document: {
    querySelector(selector) {
      return selector === '#testTableBody' ? tableBody : null;
    },
    querySelectorAll() {
      return [];
    }
  }
});

vm.runInContext(read('public/js/core/state.js'), context);
vm.runInContext(`
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
`, context);

vm.runInContext(`
  renderTableFailure(
    '#testTableBody',
    9,
    '预支台账加载失败',
    new Error('<script>alert(1)</script>'),
    'advances'
  )
`, context);

assert.match(tableBody.innerHTML, /colspan="9"/, '错误状态未保持表格列对齐');
assert.match(tableBody.innerHTML, /预支台账加载失败/, '错误状态缺少用户能理解的标题');
assert.match(tableBody.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, '接口错误信息未安全转义');
assert.doesNotMatch(tableBody.innerHTML, /<script>/, '接口错误信息可注入页面 HTML');
assert.match(tableBody.innerHTML, /data-retry-view="advances"/, '错误状态缺少当前页面重试入口');

const app = read('public/app.js');
const html = read('public/index.html');

assert.match(app, /暂无预支记录/, '预支台账无数据时仍显示空白表格');
assert.match(app, /renderTableFailure\('#advanceTableBody',\s*9,/,
  '预支台账加载失败时未渲染可重试错误状态');
assert.match(app, /renderTableFailure\('#talentTableBody',\s*10,/,
  '人才库加载失败时未渲染可重试错误状态');
assert.match(app, /renderTableFailure\('#auditTableBody',\s*6,/,
  '操作日志加载失败时未渲染可重试错误状态');
assert.match(app, /renderTableFailure\('#blacklistTableBody',\s*8,/,
  '黑名单加载失败时未渲染可重试错误状态');
assert.match(app, /renderTableFailure\('#permissionUserTableBody',\s*6,/,
  '权限账号加载失败时未渲染可重试错误状态');
assert.match(app, /renderTableFailure\('#channelTableBody',\s*6,/,
  '招聘渠道加载失败时未渲染可重试错误状态');
assert.match(app, /data-retry-view[\s\S]*switchView\(retryView\.dataset\.retryView\)/,
  '错误状态的重试按钮没有重新加载当前权限范围内页面');

assert.doesNotMatch(html, /记录员工、合同、雇主险、证件、风险和账号安全等关键操作/,
  '操作日志页面仍描述已取消的合同和雇主险办理流程');
assert.match(html, /记录员工、工资条和账号权限等关键操作/,
  '操作日志页面未说明当前实际留痕范围');

console.log('web-list-state-feedback-tests-ok');
