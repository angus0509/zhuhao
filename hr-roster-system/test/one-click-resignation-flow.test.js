const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const listWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const detailWxml = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml');
const resignWxml = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.wxml');
const service = read('src/services/employee.service.js');

assert.match(listWxml, /一键办理离职/, '驻厂员工卡应提供一键办理离职入口');
assert.match(detailWxml, /一键办理离职/, '员工详情应提供一键办理离职入口');
assert.doesNotMatch(resignWxml, /已减保|雇主险减保/, '驻厂快速离职不应要求雇主险减保确认');
assert.match(service, /sourceType:\s*'RESIGNED'/, '离职完成后必须回流人才库');
assert.match(service, /ON DUPLICATE KEY UPDATE|SELECT[\s\S]*talent_candidate/i, '人才库回流必须具备幂等处理');
const completionFunction = service.match(/async function syncResignationCompletion[\s\S]*?\n}\n\nasync function terminateEmployerInsuranceForResignation/)?.[0] || '';
assert.match(
  completionFunction,
  /UPDATE hr_work_task SET task_status=3[\s\S]*employee_id=:employeeId AND task_status IN \(0,1\)/,
  '一键离职必须关闭员工全部开放待办'
);
assert.match(
  completionFunction,
  /UPDATE hr_risk_alert SET handle_status=2[\s\S]*employee_id=:employeeId AND handle_status IN \(0,1\)/,
  '一键离职必须关闭员工全部开放风险'
);
assert.match(
  completionFunction,
  /UPDATE sys_user SET status=0,token_version=token_version\+1/,
  '一键离职必须立即停用员工账号并使 Token 失效'
);
const resignFunction = service.match(/async function resignEmployee[\s\S]*?\n}\n\nasync function updateResignationProgress/)?.[0] || '';
assert.doesNotMatch(resignFunction, /createWorkTask\(/, '新的一键离职不得创建 OFFBOARD 或减保待办');
assert.doesNotMatch(resignFunction, /lifecycle_status='OFFBOARDING'/, '新的一键离职不得停留在办理中状态');

console.log('one-click-resignation-flow-tests-ok');
