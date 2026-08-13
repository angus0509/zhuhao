const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'sql/schema.mysql.sql'), 'utf8');
const seed = fs.readFileSync(path.join(root, 'sql/seed.mysql.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/employee.service.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes/employee.routes.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const taskRoutes = fs.readFileSync(path.join(root, 'src/routes/work-task.routes.js'), 'utf8');
const operationsService = fs.readFileSync(path.join(root, 'src/services/operations.service.js'), 'utf8');
const workTaskService = fs.readFileSync(path.join(root, 'src/services/work-task.service.js'), 'utf8');
const dataScope = fs.readFileSync(path.join(root, 'src/utils/data-scope.js'), 'utf8');
const onsiteContractMigration = fs.readFileSync(path.join(root, 'sql/migrate-onsite-contract-permission-20260811.mysql.sql'), 'utf8');

for (const table of ['hr_recruiter', 'hr_recruitment_supplier', 'hr_work_task', 'hr_employee_change']) {
  if (!schema.includes(`CREATE TABLE ${table}`)) throw new Error(`缺少数据表：${table}`);
}

for (const field of ['recruitment_source_type', 'lifecycle_status', 'arrival_status', 'source_locked']) {
  if (!schema.includes(field)) throw new Error(`员工表缺少字段：${field}`);
}
for (const field of ['badge_returned', 'tools_returned', 'dorm_cleared', 'attendance_confirmed', 'completed_at']) {
  if (!schema.includes(field)) throw new Error(`离职表缺少闭环字段：${field}`);
}

if (!seed.includes("'驻厂人员', 'onsite_staff'")) throw new Error('驻厂角色名称未更新');
if (!routes.includes("router.post('/employees/precheck'")) throw new Error('缺少员工预检查接口');
if (!routes.includes("router.put('/employee-transfers/:changeId/handle'")) throw new Error('缺少跨项目转岗接收接口');
if (!routes.includes("'/resignations/:resignationId/progress'")) throw new Error('缺少离职进度更新接口');
if (!service.includes('validateRecruitmentSource')) throw new Error('缺少招聘来源校验');
if (!service.includes('r.handle_status IN (0, 1) AND r.risk_level = 3')) throw new Error('汇总风险字段必须使用表别名，避免员工风险等级字段引发歧义');
if ((service.match(/LEFT JOIN hr_recruiter rec/g) || []).length < 2) throw new Error('员工列表和详情均必须关联招聘人');
if ((service.match(/LEFT JOIN hr_recruitment_supplier rs/g) || []).length < 2) throw new Error('员工列表和详情均必须关联招聘供应商');
if (!service.includes("taskType: 'ONBOARDING_COMPLIANCE'")) throw new Error('到岗未生成合同和雇主险合并待办');
if (!service.includes('terminateEmployerInsuranceForResignation')) throw new Error('离职未在同一事务办理雇主险减保');
if (!service.includes("task_type='INSURANCE_TERMINATION'")) throw new Error('退保保存后未自动关闭待办');
if (!service.includes("contract_status='SIGNED'")) throw new Error('合同签署后未同步员工合规状态');
if (!service.includes("lifecycle_status='ACTIVE'")) throw new Error('合规完成后未自动转为正常在职');
if (!service.includes('PENDING_ACCEPTANCE') || !service.includes('handleTransfer')) throw new Error('缺少跨项目转岗状态或接收逻辑');
if (!service.includes('syncResignationCompletion') || !service.includes("lifecycle_status='OFFBOARDING'")) throw new Error('缺少离职交接闭环逻辑');
if (!page.includes('name="channelSource"')) throw new Error('员工表单缺少自由填写招聘渠道');
if (!page.includes('placeholder="可后续补充"') || /name="channelSource"[^>]*required/.test(page)) throw new Error('桌面端或手机Web招聘渠道未保持选填');
for (const route of ["router.get('/work-tasks'", "router.put('/work-tasks/:id/start'", "router.put('/work-tasks/:id/complete'"]) {
  if (!taskRoutes.includes(route)) throw new Error(`缺少待办接口：${route}`);
}
if (!operationsService.includes('lifecycleTodos')) throw new Error('办公首页尚未接入生命周期待办');
if (!page.includes('id="tasksView"') || !page.includes('id="recruitmentSourcesView"')) throw new Error('缺少待办或招聘来源管理页面');
if (!page.includes('id="transferProjectSelect"')) throw new Error('调岗表单缺少目标项目');
if (!app.includes('loadWorkTasks') || !app.includes('loadRecruitmentSources')) throw new Error('缺少待办或招聘来源页面加载逻辑');
if (!app.includes('data-handle-transfer')) throw new Error('待办中心缺少转岗接收操作');
if (!dataScope.includes('function workTaskScope')) throw new Error('待办数据范围未区分目标项目和当前项目');
if (!dataScope.includes('task_up.project_id = ${taskAlias}.project_id')) throw new Error('目标项目驻厂账号无法看到转岗接收待办');
if (!workTaskService.includes("workTaskScope(user, params, 't', 'e', 'j')")) throw new Error('待办查询未使用目标项目数据范围');
if (!workTaskService.includes('targetProjectName')) throw new Error('转岗待办未返回目标项目信息');
if (!seed.includes("'employee:transfer', 'employee:resign', 'contract:manage', 'social:manage'")) throw new Error('驻厂角色默认权限缺少合同登记');
if (!onsiteContractMigration.includes("permission_code='contract:manage'")) throw new Error('现有驻厂角色缺少合同权限升级迁移');
if (!app.includes('data-open-offboard') || app.includes('data-complete-settlement')) throw new Error('待办中心未统一进入离职办理页面');

console.log('onsite-lifecycle-v1-tests-ok');
