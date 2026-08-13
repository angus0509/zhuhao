const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const auth = read('src/middlewares/auth.middleware.js');
const routes = read('src/routes/employee.routes.js');
const controller = read('src/controllers/employee.controller.js');
const service = read('src/services/employee.service.js');
const tasks = read('src/services/work-task.service.js');

assert.match(auth, /function requireAllPermissions\(/, '缺少同时校验多个权限的中间件');
assert.match(
  routes,
  /router\.post\('\/employees\/:id\/onboarding-compliance\/confirm',[\s\S]*requireAllPermissions\(\['contract:manage', 'social:manage'\]\)[\s\S]*controller\.confirmOnboardingCompliance/,
  '合并办理接口必须同时要求合同和雇主险管理权限'
);
assert.match(controller, /exports\.confirmOnboardingCompliance[\s\S]*employeeService\.confirmOnboardingCompliance/, 'Controller 缺少一键合规处理函数');
assert.match(service, /async function confirmOnboardingCompliance\(/, 'Service 缺少一键合规业务函数');
assert.match(service, /confirmOnboardingCompliance[\s\S]*db\.transaction\([\s\S]*assertEmployeeScope\(/, '一键合规必须在事务内校验员工范围');
assert.match(service, /confirmOnboardingCompliance[\s\S]*INSERT INTO hr_labor_contract/, '一键合规必须写入已签合同');
assert.match(service, /confirmOnboardingCompliance[\s\S]*hr_social_security[\s\S]*employer_insurance_status/, '一键合规必须写入雇主险增保');
assert.match(
  service,
  /confirmOnboardingCompliance[\s\S]*contract_status='SIGNED',insurance_status='ACTIVE',lifecycle_status='ACTIVE'/,
  '一键合规必须同步员工合同、雇主险和生命周期状态'
);
assert.match(
  service,
  /confirmOnboardingCompliance[\s\S]*task_type IN \('CONTRACT','INSURANCE','ONBOARDING_COMPLIANCE'\)[\s\S]*risk_type IN \(1,7\)/,
  '一键合规必须关闭新旧合规待办和两项核心风险'
);
assert.match(service, /'入职合规'[\s\S]*'onboarding_compliance'[\s\S]*'confirm'/, '一键合规必须写操作日志');

assert.match(service, /createOnboardingCompliance[\s\S]*taskType: 'ONBOARDING_COMPLIANCE'/, '新入职必须只创建合并合规待办');
assert.doesNotMatch(
  service.match(/async function createOnboardingCompliance[\s\S]*?\n}\n\nasync function linkExistingTalentToEmployee/)?.[0] || '',
  /taskType: 'CONTRACT'[\s\S]*taskType: 'INSURANCE'/,
  '新入职不应继续分别创建合同和雇主险待办'
);
assert.match(tasks, /ONBOARDING_COMPLIANCE: '一键确认合同和雇主险'/, '待办类型名称缺少合并合规');
assert.match(
  tasks,
  /t\.task_type IN \('CONTRACT','INSURANCE','ONBOARDING_COMPLIANCE'\)[\s\S]*e\.employee_status=2/,
  '待办列表必须兼容新旧合规待办'
);

console.log('one-click-onboarding-compliance-tests-ok');
