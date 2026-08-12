const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/app.js');
const router = read('public/js/core/router.js');
const state = read('public/js/core/state.js');
const riskService = read('src/services/risk.service.js');
const employeeService = read('src/services/employee.service.js');
const html = read('public/index.html');
const roster = read('public/js/views/roster.js');
const channels = read('wechat-miniprogram/miniprogram/pages/channels/index.js');
const channelsWxml = read('wechat-miniprogram/miniprogram/pages/channels/index.wxml');

function block(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`无法定位代码块：${start}`);
  return source.slice(startIndex, endIndex);
}

for (const deadReference of ['loadFactoryStaff', 'factoryProjectFilter', 'factoryStaffKpis', 'factoryStaffTableBody', 'factoryStatusFilter']) {
  if (app.includes(deadReference)) throw new Error(`仍保留已删除驻厂页面的死代码：${deadReference}`);
}

for (const [start, end] of [
  ['async function submitContract', 'async function submitSocial'],
  ['async function submitSocial', 'async function submitCertificate'],
  ['async function submitCertificate', 'async function scanRisks']
]) {
  if (block(app, start, end).includes('scanRisks()')) throw new Error(`${start} 保存成功后仍强制调用风险扫描权限`);
}

const refreshBlock = block(app, 'async function refreshAll', 'function bindMetricRiskNavigation');
if (!refreshBlock.includes("permissions.includes('risk:view')")) throw new Error('refreshAll 未按 risk:view 权限决定是否加载风险');
if (refreshBlock.includes('Promise.all([loadSummary(), loadEmployees(), loadRisks()])')) throw new Error('refreshAll 仍无条件调用风险接口');

if (!app.includes("if (action === 'goto-risk')")) throw new Error('项目查看风险按钮缺少处理器');
if (!app.includes("$('#riskKeywordInput').value = project?.projectName || ''")) throw new Error('项目查看风险未自动按项目名称筛选');
if (!app.includes('state.selectedRiskProjectId = Number(project?.id || 0) || null')) throw new Error('项目查看风险未记录精确项目ID');
if (!app.includes('Number(row.projectId) !== Number(state.selectedRiskProjectId)')) throw new Error('风险中心仍未按项目ID精确筛选');
if (!state.includes('selectedRiskProjectId: null')) throw new Error('全局状态缺少风险项目筛选ID');
if (!riskService.includes('j.project_id project_id')) throw new Error('风险接口未返回员工当前项目ID');
if (!employeeService.includes('projectId: row.project_id || null')) throw new Error('风险格式化结果未输出项目ID');

for (const legacyView of ["riskCases: 'risk'", "insurance: 'risk'", "factory: 'roster'", "factoryStaff: 'roster'"]) {
  if (!router.includes(legacyView)) throw new Error(`缺少历史页面兼容映射：${legacyView}`);
}
if (!router.includes('if (!viewElements[view])')) throw new Error('未知页面没有安全回退，仍可能出现空白页');

if (!app.includes('const officeActionPermissions =')) throw new Error('办公中心缺少快捷入口权限映射');
if (!app.includes('function canRunOfficeAction(action)')) throw new Error('办公中心缺少统一权限判断');
if (!app.includes('.filter(([, , , , action]) => canRunOfficeAction(action))')) throw new Error('办公中心仍向无权限角色显示全部入口');
if (!app.includes("if (!canRunOfficeAction(action))")) throw new Error('办公快捷入口点击时未二次校验权限');
if (!html.includes('data-office-action="payroll-create" data-action-perm="payroll:manage"')) throw new Error('创建工资批次按钮缺少 payroll:manage 权限');
if (!html.includes('data-office-action="risk" data-action-perm="risk:view"')) throw new Error('办公中心合规卡缺少 risk:view 权限');
if (!app.includes('data-notice-view=')) throw new Error('消息中心通知仍不可点击跳转');
if (!app.includes("event.target.closest('[data-notice-view]')")) throw new Error('消息通知缺少点击处理器');
if (!app.includes('function configureMetricRiskAccess()')) throw new Error('顶部风险指标未按权限调整交互状态');
if (!html.includes('id="exportLink" href="/api/export/employees.csv" data-action-perm="employee:export"')) throw new Error('CSV 导出入口缺少 employee:export 权限');
if (!html.includes('id="exportXlsxLink" href="/api/export/employees.xlsx" data-action-perm="employee:export"')) throw new Error('XLSX 导出入口缺少 employee:export 权限');
if (!html.includes('id="mobileAddEmployeeBtn" data-action-perm="employee:create"')) throw new Error('手机 Web 新增员工入口缺少 employee:create 权限');
if (!roster.includes("const canCreateEmployee = permissions.includes('employee:create')")) throw new Error('空花名册未按新增员工权限渲染入口');
if (!roster.includes("const canBatchEmployee = permissions.includes('employee:batch')")) throw new Error('空花名册未按批量录入权限渲染入口');
if (!app.includes("userPermissions.includes('customer:view')")) throw new Error('项目页仍未按 customer:view 权限决定是否请求客户接口');
const bootBlock = block(app, 'async function bootAuthedApp', 'init().catch');
if (bootBlock.includes('.catch(() => {})')) throw new Error('登录后的核心数据加载错误仍被静默吞掉');
if (!bootBlock.includes('Promise.allSettled')) throw new Error('登录启动未对并行数据加载结果进行明确反馈');
if (!app.includes('async function refreshEmployeeWorkspace()')) throw new Error('员工业务保存后缺少花名册与办公中心统一刷新');
if (channelsWxml.includes('catchtap="noop"') && !channels.includes('noop() {}')) throw new Error('招聘渠道详情弹窗缺少 noop 冒泡拦截处理器');
for (const mutation of ['saveEmployee', 'submitTransfer', 'submitResign', 'submitContract', 'submitSocial', 'submitCertificate']) {
  const start = `async function ${mutation}`;
  const startIndex = app.indexOf(start);
  const nextIndex = app.indexOf('\nasync function ', startIndex + start.length);
  const source = app.slice(startIndex, nextIndex > startIndex ? nextIndex : app.length);
  if (!source.includes('refreshEmployeeWorkspace()')) throw new Error(`${mutation} 保存后未同步刷新办公中心`);
}

console.log('页面导航、权限刷新、项目风险筛选与死代码检查通过。');
