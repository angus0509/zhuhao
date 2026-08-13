const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const appJson = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));
if (!appJson.pages.includes('pages/tasks/index')) throw new Error('小程序未注册风险与合规处理页');

const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
const homeWxml = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
assertIncludes(homeJs, 'goEmployeeStage(event)', '首页缺少驻厂状态直达入口');
assertIncludes(homeWxml, 'data-stage="pending"', '首页缺少待到岗入口');
assertIncludes(homeWxml, 'data-stage="active"', '首页缺少在职员工入口');
assertIncludes(homeWxml, 'data-stage="left"', '首页缺少已离职入口');
if (/goRiskCenter|goTodo|驻厂待处理|合规待办|驻厂处理队列/.test(homeJs + homeWxml)) throw new Error('小程序工作台仍保留已取消的待办处理入口');

const taskJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
const taskWxml = read('wechat-miniprogram/miniprogram/pages/tasks/index.wxml');
assertIncludes(taskJs, "request({ url: '/risk-alerts' })", '页面未读取风险提醒');
assertIncludes(taskJs, "request({ url: '/work-tasks?taskStatus=0' })", '页面未读取待处理合规任务');
assertIncludes(taskJs, "request({ url: '/work-tasks?taskStatus=1' })", '页面未读取处理中合规任务');
assertIncludes(taskJs, "CONTRACT: { kind: 'compliance'", '页面未将历史合同待办归入合并合规');
assertIncludes(taskJs, "kind === 'compliance'", '风险数据未归类为合并合规待办');
assertIncludes(taskJs, '/pages/employees/compliance/index?id=', '合同和雇主险待办未直达合并办理');
assertIncludes(taskJs, "taskType === 'ARRIVAL'", '到岗待办未直达确认入职');
assertIncludes(taskJs, '/pages/employees/onboard/index?id=', '到岗待办缺少确认入职页面');
assertIncludes(taskJs, "taskType === 'DOCUMENT'", '资料待补未直达员工编辑');
assertIncludes(taskJs, '/pages/employees/add/index?id=', '资料待补缺少员工编辑页面');
assertIncludes(taskJs, "taskType === 'OFFBOARD'", '离职待办未识别离职交接');
assertIncludes(taskJs, '/pages/employees/resign/index?id=', '离职待办缺少交接页面');
assertIncludes(taskJs, "taskType === 'TRANSFER_ACCEPTANCE'", '转岗待办未识别转岗接收');
assertIncludes(taskJs, '/pages/employees/transfer-handle/index?changeId=', '转岗待办缺少处理页面');
assertIncludes(taskJs, '/work-tasks/${item.taskId}/start', '直接办理前未留下待办开始处理状态');
assertIncludes(taskWxml, 'data-id="{{item.employeeId}}"', '具体事项未关联员工档案');
assertIncludes(taskWxml, 'bindtap="handleItem"', '具体事项缺少直接处理按钮');
if (taskWxml.includes('.slice(')) throw new Error('WXML 中不应调用 JavaScript 方法');

const webApp = read('public/app.js');
for (const label of ['直接登记合同', '直接办理增保', '确认已减保并离职']) {
  assertIncludes(webApp, label, `网页端待办缺少操作：${label}`);
}
assertIncludes(webApp, 'data-insurance-action="ADD"', '网页端增保入口未明确传递增保动作');
assertIncludes(webApp, 'data-open-offboard=', '网页端减保事项未合并到离职办理');
assertIncludes(webApp, "function openSocialModal(id, requestedAction = '')", '雇主险弹窗无法接收明确的增减保动作');
assertIncludes(webApp, 'openSocialModal(id, actionButton.dataset.insuranceAction)', '雇主险按钮动作未传入办理弹窗');
assertIncludes(webApp, 'data-todo-id=', '网页端待办未传递具体类型');
assertIncludes(webApp, "todoId === 'contract'", '网页端合同待办不能精确筛选');
assertIncludes(webApp, "todoId === 'insurance'", '网页端雇主险待办不能精确筛选');

const employeeService = read('src/services/employee.service.js');
const summaryRiskQuery = employeeService.slice(
  employeeService.indexOf('const risk = await db.first('),
  employeeService.indexOf('const unsigned = await db.first(')
);
assertIncludes(summaryRiskQuery, 'r.risk_type IN (1, 7)', '首页未处理风险统计口径未限定合同和雇主险');
assertIncludes(summaryRiskQuery, 'e.employee_status = 2', '首页未处理风险仍包含非在职员工');
assertIncludes(summaryRiskQuery, "e.lifecycle_status <> 'OFFBOARDING'", '首页未处理风险仍包含离职交接员工');
assertIncludes(summaryRiskQuery, 'e.deleted_at IS NULL', '首页未处理风险仍包含已删除员工');

const operationsService = read('src/services/operations.service.js');
assertIncludes(
  operationsService,
  ".filter(item => !['CONTRACT', 'INSURANCE', 'ONBOARDING_COMPLIANCE'].includes(item.taskType))",
  '今日待办仍重复显示合同和雇主险生命周期任务'
);
const complianceQueryBlock = operationsService.slice(
  operationsService.indexOf('db.first(`SELECT COUNT(*) total FROM hr_employee e'),
  operationsService.indexOf('db.first(`SELECT COUNT(*) total FROM salary_detail d')
);
const offboardingFilters = complianceQueryBlock.match(/e\.lifecycle_status <> 'OFFBOARDING'/g) || [];
if (offboardingFilters.length < 2) throw new Error('合规待办统计仍包含离职交接员工');
assertIncludes(
  complianceQueryBlock,
  '(es.employer_end_date IS NULL OR es.employer_end_date >= CURRENT_DATE())',
  '合规待办未将已过保险终止日期的员工计入雇主险待办'
);

const complianceMigration = read('sql/migrate-onboarding-compliance-risk-20260810.mysql.sql');
assertIncludes(complianceMigration, 'INSERT INTO hr_work_task', '历史员工合规迁移未补齐驻厂可见待办');
assertIncludes(complianceMigration, "'EMPLOYEE_ONBOARDING'", '历史合规待办未使用统一入职业务来源');
assertIncludes(complianceMigration, "t.task_type='CONTRACT'", '迁移未防止重复生成合同待办');
assertIncludes(complianceMigration, "t.task_type='INSURANCE'", '迁移未防止重复生成雇主险待办');

console.log('未处理风险和合规待办可点击、可关联、可直接办理检查通过。');
