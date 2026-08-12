const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const employeeService = read('src/services/employee.service.js');
const workTaskService = read('src/services/work-task.service.js');
const onsitePage = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const onboardPage = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.js');
const resignPage = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.js');

assert.match(
  employeeService,
  /UPDATE hr_work_task SET task_status=2[\s\S]*task_type='ARRIVAL'[\s\S]*task_status IN \(0,1\)/,
  '确认入职后必须关闭员工的到岗待办'
);
assert.match(
  employeeService,
  /createOnboardingCompliance\([\s\S]*projectId: employee\.project_id/,
  '入职合规待办必须保留员工项目，确保驻厂数据范围一致'
);
assert.match(
  workTaskService,
  /t\.task_type='ARRIVAL' AND e\.employee_status=1/,
  '待办查询必须排除已入职员工残留的到岗待办'
);
assert.match(
  workTaskService,
  /t\.task_type IN \('OFFBOARD','INSURANCE_TERMINATION'\)[\s\S]*e\.lifecycle_status='OFFBOARDING'/,
  '离职待办必须只对应正在办理离职的员工'
);
assert.match(
  employeeService,
  /ORDER BY \(j2\.job_status=1\) DESC,j2\.id DESC LIMIT 1/,
  '员工列表必须保留最近一次任职归属，确保已离职人员仍可按客户查看'
);
assert.ok(
  (employeeService.match(/LEFT JOIN hr_employee_job j ON j\.id = \([\s\S]*?ORDER BY \(j2\.job_status=1\) DESC/g) || []).length >= 3,
  '驻厂统计、员工列表和员工详情都必须保留最近一次任职归属'
);
assert.match(onsitePage, /stage === 'left' && !item\.isLeft/, '驻厂页面缺少已离职状态筛选');
assert.match(onboardPage, /markDirty\('employees', 'home', 'tasks', 'advances'\)/, '入职完成后未刷新驻厂待办');
assert.match(resignPage, /markDirty\('employees', 'home', 'tasks', 'advances'\)/, '离职完成后未刷新驻厂待办');

console.log('onsite-task-lifecycle-sync-tests-ok');
