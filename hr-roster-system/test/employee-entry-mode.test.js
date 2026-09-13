const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const html = read('public/index.html');
const webApp = read('public/app.js');
const miniJs = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
const miniWxml = read('wechat-miniprogram/miniprogram/pages/employees/add/index.wxml');
const service = read('src/services/employee.service.js');

for (const fieldId of ['employeeStatusField', 'mobileEmployeeStatusField']) {
  const field = html.match(new RegExp(`<label id="${fieldId}">([\\s\\S]*?)<\\/label>`))?.[1] || '';
  assert.equal((field.match(/<option /g) || []).length, 2, `${fieldId} 只能显示面试和待到岗`);
  assert.match(field, /<option value="6" selected>面试/, `${fieldId} 必须默认选择面试`);
  assert.match(field, /<option value="1">待到岗<\/option>/, `${fieldId} 必须显示待到岗选项`);
  assert.doesNotMatch(field, /value="2"|value="5"/, `${fieldId} 不得直接创建在职或未入职员工`);
}

assert.match(webApp, /const interview = employeeStatus === 6;/, '网页端必须按录入模式切换必填规则');
assert.match(miniJs, /entryMode:\s*'interview'/, '小程序必须默认选择面试');
assert.match(miniJs, /setEntryMode\(event\)/, '小程序缺少录入模式切换');
assert.match(miniJs, /employeeStatus:\s*this\.data\.entryMode === 'interview' \? 6 : 1/, '小程序直接入职必须提交到待到岗');
assert.match(miniWxml, /data-mode="interview"[^>]*>面试</, '小程序缺少面试选项');
assert.match(miniWxml, /data-mode="direct"[^>]*>待到岗</, '小程序缺少待到岗选项');
assert.match(miniWxml, /保存后进入面试名单/, '小程序必须说明面试流向');
assert.match(miniWxml, /保存后进入待到岗/, '小程序必须说明直接入职流向');

assert.match(service, /requestedEmployeeStatus === 2[\s\S]*新增员工请先录入为待到岗，再确认入职/, '后端必须阻止直接创建在职员工');
assert.match(service, /!\[1, 6\]\.includes\(requestedEmployeeStatus\)/, '后端新增员工只能接受面试或待到岗状态');
assert.match(service, /SET employee_status=2,lifecycle_status='ACTIVE',arrival_status='CONFIRMED'/, '确认入职必须统一写入 ACTIVE');

console.log('employee-entry-mode-tests-ok');
