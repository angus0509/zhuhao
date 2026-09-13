const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const operations = read('src/services/operations.service.js');
const prototype = read('server.js');

assert.match(html, /id="officeLifecycleFlow"/, '办公中心缺少员工生命周期快捷流');
assert.match(operations, /SUM\(employee_status = 6\) interview/, '生产办公接口缺少面试人数');
assert.match(operations, /SUM\(employee_status = 1\) pending_arrival/, '生产办公接口缺少待到岗人数');
assert.match(prototype, /interview:\s*[^,]+filter\(item => item\.employeeStatus === 6/, '原型办公接口缺少面试人数');
assert.match(prototype, /pendingArrival:\s*[^,]+filter\(item => item\.employeeStatus === 1/, '原型办公接口缺少待到岗人数');

for (const action of ['interviews', 'pending-arrival', 'employees']) {
  assert.match(app, new RegExp(`['"]?${action}['"]?\\s*:`), `办公中心缺少 ${action} 权限配置`);
}
assert.match(app, /function openRosterStatus\(status\)/, '办公中心缺少统一花名册状态跳转');
assert.match(app, /data-lifecycle-status=/, '生命周期卡片缺少可点击状态入口');

for (const removed of ['用工记录', '离职办理', '员工反馈', '未结查询', '还款管理', '预支统计']) {
  assert.ok(!app.includes(`['${removed}'`) && !app.includes(`["${removed}"`), `办公中心仍保留重复或无效入口：${removed}`);
}

console.log('web-office-lifecycle-flow-tests-ok');
