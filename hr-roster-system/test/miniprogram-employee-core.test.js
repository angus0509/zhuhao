const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const miniAppPath = path.join(root, 'wechat-miniprogram/miniprogram/app.json');
if (fs.existsSync(miniAppPath)) {
  const appJson = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));
  for (const page of [
    'pages/employees/add/index',
    'pages/employees/onboard/index',
    'pages/employees/transfer/index',
    'pages/employees/insurance/index',
    'pages/employees/resign/index'
  ]) {
    if (!appJson.pages.includes(page)) throw new Error(`核心员工页面未注册：${page}`);
  }
  const onsiteTab = appJson.tabBar.list.find(item => item.pagePath === 'pages/employees/index');
  if (onsiteTab?.text !== '驻厂') throw new Error('员工核心入口未调整为驻厂管理');

  const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
  const homeWxml = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
  assertIncludes(homeJs, "request({ url: '/work-tasks?taskStatus=0' })", '小程序首页未加载待处理驻厂队列');
  assertIncludes(homeJs, "request({ url: '/work-tasks?taskStatus=1' })", '小程序首页遗漏处理中的驻厂待办');
  assertIncludes(homeJs, "wx.setStorageSync('onsite_employee_stage'", '小程序首页无法直达员工生命周期筛选');
  assertIncludes(homeWxml, '驻厂人员管理', '小程序首页缺少驻厂人员管理主入口');
  assertIncludes(homeWxml, '驻厂处理队列', '小程序首页缺少现场待办队列');

  const addJs = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
  assertIncludes(addJs, 'employeeStatusIndex: 0', '新增员工必须默认进入待入职状态');
  assertIncludes(addJs, 'employeeStatus: this.data.employeeStatusIndex === 1 ? 2 : 1', '新增员工未提交录入状态');
  assertIncludes(addJs, "if (!f.channelSource.trim())", '招聘渠道必须由录入人员自行填写');
  assertIncludes(addJs, 'channelSource: f.channelSource.trim()', '新增员工未提交自由文本招聘渠道');
  assertIncludes(addJs, 'editingEmployeeId', '小程序新增员工页未支持编辑模式');
  assertIncludes(addJs, "method: this.data.editingEmployeeId ? 'PUT' : 'POST'", '小程序员工编辑未调用更新接口');
  assertIncludes(addJs, "url: '/employees/precheck'", '新增员工未执行身份证、黑名单和重复预检查');

  const onboardJs = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.js');
  assertIncludes(onboardJs, "hasPermission(session.user, 'social:manage')", '确认入职未根据权限控制雇主险后续办理');
  assertIncludes(onboardJs, '&action=ADD', '确认入职后的雇主险入口未明确指定增保');

  const listJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
  assertIncludes(listJs, 'customerStats', '员工列表缺少客户分类统计');
  assertIncludes(listJs, 'insuranceComplete: employerCovered', '员工列表未按雇主险判断完成状态');
  assertIncludes(listJs, 'activeInsurance', '员工列表缺少雇主险筛选');
  assertIncludes(listJs, "activeStage: 'active'", '驻厂人员页未默认展示在职员工');
  assertIncludes(listJs, "stage === 'offboarding'", '驻厂人员页缺少离职处理中筛选');
  assertIncludes(listJs, 'goOnboard(event)', '驻厂人员列表缺少快捷确认入职');
  assertIncludes(listJs, 'goResign(event)', '驻厂人员列表缺少快捷离职管理');
  assertIncludes(listJs, 'async loadAllEmployeePages(keyword)', '驻厂人员页仍只读取前200名员工');
  assertIncludes(listJs, 'startPage += 4', '大花名册加载缺少移动网络并发控制');

  const insuranceJs = read('wechat-miniprogram/miniprogram/pages/employees/insurance/index.js');
  const insuranceWxml = read('wechat-miniprogram/miniprogram/pages/employees/insurance/index.wxml');
  assertIncludes(insuranceJs, "ACTION_VALUES = ['', 'ADD', 'REMOVE']", '小程序雇主险页面缺少增保减保选项');
  assertIncludes(insuranceJs, 'employerInsuranceAction', '小程序未提交雇主险增减动作');
  assertIncludes(insuranceJs, "requestedAction: ''", '雇主险页面仍可能自动预选危险操作');
  assertIncludes(insuranceJs, "['ADD', 'REMOVE'].includes(options.action)", '雇主险页面未限制明确业务入口动作');
  if (/社保状态|公积金/.test(insuranceWxml)) throw new Error('小程序雇主险页面仍显示社保或公积金');

  const detailJs = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.js');
  assertIncludes(detailJs, 'goEdit()', '小程序员工详情缺少编辑入口');
  assertIncludes(detailJs, "hasPermission(session.user, 'employee:update')", '员工详情缺少入职权限判断');
  assertIncludes(detailJs, "hasPermission(session.user, 'social:manage')", '员工详情缺少保险权限判断');
  assertIncludes(detailJs, "hasPermission(session.user, 'employee:resign')", '员工详情缺少离职权限判断');
  assertIncludes(detailJs, "hasPermission(session.user, 'employee:transfer')", '员工详情缺少转岗权限判断');
  assertIncludes(detailJs, 'onShow()', '员工详情返回后不会自动刷新');
  assertIncludes(detailJs, "basic.lifecycleStatus === 'OFFBOARDING'", '员工详情未识别离职交接状态');
  assertIncludes(detailJs, 'offboardingCompleted / 6 * 35', '员工生命周期进度仍为固定值，未关联真实交接状态');

  const transferJs = read('wechat-miniprogram/miniprogram/pages/employees/transfer/index.js');
  assertIncludes(transferJs, 'newProjectId', '小程序转岗缺少目标项目');
  assertIncludes(transferJs, '/job-transfer', '小程序转岗未调用后端接口');

  const resignJs = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.js');
  for (const field of ['badgeReturned', 'toolsReturned', 'dormCleared', 'attendanceConfirmed']) {
    assertIncludes(resignJs, field, `小程序离职缺少交接项：${field}`);
  }
  assertIncludes(resignJs, 'progressMode', '小程序离职页面缺少交接进度模式');
  assertIncludes(resignJs, '`/resignations/${this.data.resignationId}/progress`', '小程序无法更新离职交接进度');
  assertIncludes(resignJs, 'employerInsuranceCovered', '离职进度未关联雇主险减保状态');
  assertIncludes(resignJs, "hasPermission(session.user, 'payroll:manage')", '薪资专员无法进入离职工资结算流程');
  assertIncludes(resignJs, 'buildProgressPayload()', '离职进度未按角色拆分提交字段');
  assertIncludes(resignJs, '&action=REMOVE', '离职减保入口未明确指定减保动作');
}

const routeSource = read('src/routes/employee.routes.js');
assertIncludes(routeSource, "router.post('/employees/:id/onboard'", '后端未注册确认入职接口');
assertIncludes(routeSource, "router.put('/employees/:id/social-security'", '后端未注册保险管理接口');
assertIncludes(routeSource, "router.post('/employees/:id/resign'", '后端未注册离职接口');
assertIncludes(routeSource, "'/resignations/:resignationId/progress'", '后端未注册离职进度接口');
assertIncludes(routeSource, "requireAnyPermission(['employee:resign', 'payroll:manage'])", '离职进度接口未支持驻厂与薪资职责分离');

const serviceSource = read('src/services/employee.service.js');
assertIncludes(serviceSource, 'async function onboardEmployee', '缺少确认入职业务逻辑');
assertIncludes(serviceSource, 'onboard_contract:', '确认入职未生成合同提醒');
assertIncludes(serviceSource, 'onboard_insurance:', '确认入职未生成保险提醒');
assertIncludes(serviceSource, '离职待减雇主险', '离职未生成雇主险减保待办');
assertIncludes(serviceSource, "['ADD', 'REMOVE'].includes(employerInsuranceAction)", '后端未限制雇主险增保减保动作');
assertIncludes(serviceSource, 'const insuranceDone = Number(row.employer_insurance_status || 0) !== 1;', '历史社保状态仍会阻塞离职完成');
assertIncludes(serviceSource, "permissions.includes('payroll:manage')", '后端未限制离职工资结算权限');

console.log(fs.existsSync(miniAppPath)
  ? '小程序驻厂员工入职、在职维护、雇主险和离职交接核心契约检查通过。'
  : 'Web发布包员工核心后端契约检查通过（小程序源码独立发布）。');
