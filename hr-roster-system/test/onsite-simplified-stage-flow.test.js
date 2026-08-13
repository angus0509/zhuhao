const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const routes = read('src/routes/employee.routes.js');
const controller = read('src/controllers/employee.controller.js');
const service = read('src/services/employee.service.js');

assert.match(
  routes,
  /router\.put\('\/employees\/:id\/interview-result',[\s\S]*requirePermission\('employee:update'\)[\s\S]*controller\.handleInterviewResult/,
  '缺少面试结果写接口或 employee:update 权限校验'
);
assert.match(
  routes,
  /router\.put\('\/employees\/:id\/arrival-result',[\s\S]*requirePermission\('employee:update'\)[\s\S]*controller\.handleArrivalResult/,
  '缺少待到岗结果写接口或 employee:update 权限校验'
);
assert.match(controller, /exports\.handleInterviewResult[\s\S]*employeeService\.handleInterviewResult/, 'Controller 缺少面试结果处理函数');
assert.match(controller, /exports\.handleArrivalResult[\s\S]*employeeService\.handleArrivalResult/, 'Controller 缺少待到岗结果处理函数');

assert.match(service, /async function handleInterviewResult\(/, 'Service 缺少 handleInterviewResult');
assert.match(service, /async function handleArrivalResult\(/, 'Service 缺少 handleArrivalResult');
assert.match(service, /handleInterviewResult[\s\S]*assertEmployeeScope\(/, '面试结果必须校验员工数据范围');
assert.match(service, /handleArrivalResult[\s\S]*assertEmployeeScope\(/, '待到岗结果必须校验员工数据范围');

assert.match(
  service,
  /handleInterviewResult[\s\S]*employee_status\)\s*!==\s*6[\s\S]*employee_status=1,lifecycle_status='PENDING_ARRIVAL',arrival_status='PENDING'/,
  '面试转待到岗必须校验面试状态并同步三个状态字段'
);
assert.match(
  service,
  /handleInterviewResult[\s\S]*task_type='ARRIVAL'[\s\S]*task_status IN \(0,1\)[\s\S]*createWorkTask\(/,
  '面试转待到岗必须关闭残留到岗待办并创建唯一 ARRIVAL 待办'
);
assert.match(
  service,
  /handleInterviewResult[\s\S]*employee_status=5,lifecycle_status='NOT_JOINED',arrival_status='NO_SHOW'[\s\S]*closeEmployeeOpenItems\([\s\S]*sourceType: 'INTERVIEW_REJECTED'/,
  '面试未通过必须关闭开放事项并以 INTERVIEW_REJECTED 来源流转人才库'
);
assert.match(
  service,
  /handleArrivalResult[\s\S]*!\[1, 6\]\.includes\(Number\(employee\.employee_status\)\)[\s\S]*employee_status=5,lifecycle_status='NOT_JOINED',arrival_status='NO_SHOW'[\s\S]*sourceType: 'UNJOINED'/,
  '待到岗与历史面试人员标记未入职时必须校验状态并流转人才库'
);
assert.ok(
  (service.match(/'员工生命周期'[\s\S]{0,220}'employee'[\s\S]{0,220}'update'/g) || []).length >= 2,
  '面试结果和待到岗结果必须分别写入操作日志'
);
assert.match(service, /module\.exports[\s\S]*handleInterviewResult[\s\S]*handleArrivalResult/, '新业务函数必须导出');

console.log('onsite-simplified-stage-flow-tests-ok');
