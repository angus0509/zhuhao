const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const webHtml = read('public/index.html');
const webApp = read('public/app.js');
const miniAdd = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
const miniDetail = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.js');
const miniAdvance = read('wechat-miniprogram/miniprogram/pages/advances/index.js');
const miniAdvanceView = read('wechat-miniprogram/miniprogram/pages/advances/index.wxml');
const employeeService = read('src/services/employee.service.js');

assert.match(webHtml, /id="advanceMonthFilter"[^>]*type="month"/, '网页预支台账缺少月份选择器');
assert.match(webApp, /openExistingEmployeeRecord/, '网页端身份证重复后未提供员工档案跳转');
assert.match(webApp, /\/api\/employees\/\$\{id\}\/reactivate/, '网页端未调用重新录用接口');
assert.match(webApp, /month=\$\{encodeURIComponent\(month\)\}/, '网页端未按月份请求预支台账');

assert.match(miniAdd, /checkExistingEmployee/, '小程序身份证输入后未立即检查现有档案');
assert.match(miniAdd, /pages\/employees\/detail\/index\?id=/, '小程序身份证重复后未跳转员工档案');
assert.match(miniDetail, /\/employees\/\$\{this\.data\.employeeId\}\/reactivate/, '小程序未调用重新录用接口');
assert.match(miniAdvance, /selectedMonth/, '小程序预支台账缺少月份状态');
assert.match(miniAdvance, /month=\$\{encodeURIComponent\(this\.data\.selectedMonth\)\}/, '小程序未按月份请求预支台账');
assert.match(miniAdvanceView, /fields="month"/, '小程序预支台账缺少月份选择器');
assert.match(miniAdvanceView, /已扣回/, '小程序月度汇总缺少已扣回金额');
assert.match(
  employeeService,
  /ORDER BY \(job_status=1\) DESC,id DESC LIMIT 1/,
  '编辑离职或未入职员工时必须读取最新历史任职信息'
);
assert.match(
  employeeService,
  /Number\(currentJobForDept\.job_status\) === 1/,
  '历史员工编辑时不得覆盖已关闭任职记录'
);

console.log('cross-client-duplicate-month-ledger-tests-ok');
