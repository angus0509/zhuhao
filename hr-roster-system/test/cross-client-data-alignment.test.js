const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const app = read('public/app.js');
const api = read('public/js/core/api.js');
const roster = read('public/js/views/roster.js');
const html = read('public/index.html');
const employeeService = read('src/services/employee.service.js');

assertIncludes(api, "async function apiAllPages(path, query = '', pageSize = 200)", 'Web 缺少统一完整分页工具');
assertIncludes(roster, "apiAllPages('/api/employees', query)", '桌面 Web 花名册未读取完整员工数据');
assertIncludes(app, "apiAllPages('/api/employees', query)", '手机 Web 未使用与桌面端一致的员工接口');
if (app.includes('/api/employees/mine')) throw new Error('手机 Web 仍只显示自己创建的员工');
assertIncludes(app, "apiAllPages('/api/advances')", 'Web 工资预支未读取完整权限范围数据');
assertIncludes(app, "form.elements.advanceAt.value = localDateTimeInputValue()", 'Web 驻厂预支未默认当前登记时间');
assertIncludes(app, "emp.lifecycleStatus === 'OFFBOARDING'", '手机 Web 未识别离职交接中状态');
assertIncludes(html, 'id="employeeStatusField"', '桌面 Web 新增员工缺少录入状态');
assertIncludes(html, 'id="mobileEmployeeStatusField"', '手机 Web 新增员工缺少录入状态');
assertIncludes(html, '<option value="6" selected>面试（先简单登记）</option>', 'Web 新增员工未默认面试');
assertIncludes(html, '<option value="5">未入职（自动进入人才库）</option>', 'Web 新增员工缺少未入职状态');
assertIncludes(app, 'delete body.employeeStatus', 'Web 编辑员工仍可能覆盖生命周期状态');
assertIncludes(app, 'function applyEmployeeFormDefaults(form)', 'Web 新增员工缺少跨端统一默认值');
assertIncludes(app, "item.positionCode === 'OP' || item.positionName === '普工'", 'Web 新增员工未默认定位普工岗位');
assertIncludes(
  employeeService,
  'const employeeStatus = [1, 2, 5, 6].includes(Number(body.employeeStatus)) ? Number(body.employeeStatus) : 1;',
  '后端新增员工缺省状态不是待入职'
);
assertIncludes(
  employeeService,
  "ORDER BY CASE WHEN position_code = 'OP' OR position_name = '普工' THEN 0 ELSE 1 END",
  '共享岗位字典未保证普工排在第一位'
);

for (const endpoint of ['/api/bootstrap', '/api/summary', '/api/operations/home', '/api/work-tasks', '/api/recruitment-channels', '/api/payroll/overview']) {
  assertIncludes(app, endpoint, `Web 缺少共享业务接口：${endpoint}`);
}
assertIncludes(app, 'employerInsuranceAction', 'Web 未提交雇主险增减动作');
assertIncludes(app, 'channelSource', 'Web 未关联招聘渠道字段');
assertIncludes(roster, 'recruitmentChannelName', 'Web 花名册未读取招聘渠道关联名称');

const miniRoot = path.join(root, 'wechat-miniprogram', 'miniprogram');
if (fs.existsSync(miniRoot)) {
  const miniEmployees = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
  const miniAdd = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
  const miniAdvances = read('wechat-miniprogram/miniprogram/pages/advances/index.js');
  const miniHome = read('wechat-miniprogram/miniprogram/pages/home/index.js');
  const miniPayroll = read('wechat-miniprogram/miniprogram/pages/payroll/index.js');
  const miniInsurance = read('wechat-miniprogram/miniprogram/pages/employees/insurance/index.js');

  assertIncludes(miniEmployees, 'async loadAllEmployeePages(keyword, customerId', '小程序员工列表未读取完整分页');
  assertIncludes(miniEmployees, 'url: `/employees?page=1&pageSize=200', '小程序员工未使用共享员工接口');
  assertIncludes(miniEmployees, "item.lifecycleStatus === 'OFFBOARDING'", '小程序未识别离职交接状态');
  assertIncludes(miniAdvances, 'async loadAllAdvancePages()', '小程序预支未读取完整分页');
  assertIncludes(miniAdvances, "url: '/advances?page=1&pageSize=200'", '小程序预支未使用共享预支接口');
  assertIncludes(miniAdvances, "recordMode: 'onsite'", '小程序预支未使用共享驻厂登记模式');
  assertIncludes(miniAdvances, "url: '/employees?page=1&pageSize=200'", '小程序预支员工选择未关联共享花名册');
  assertIncludes(miniAdd, 'employeeStatus: 1', '小程序新增员工未固定进入待到岗');
  if (/EMPLOYEE_STATUS_VALUES|employeeStatusIndex/.test(miniAdd)) throw new Error('小程序新增员工仍允许选择生命周期状态');
  assertIncludes(miniAdd, 'workTypeIndex: 0', '小程序新增员工工资类型未与 Web 一致默认计时');
  assertIncludes(miniAdd, 'sortPositionsForEmployeeForm', '小程序岗位列表缺少普工优先排序保护');
  assertIncludes(miniAdd, 'positionIndex: defaultPositionIndex >= 0', '小程序新增员工未默认选择普工岗位');
  assertIncludes(miniAdd, 'delete payload.employeeStatus', '小程序编辑员工仍可能覆盖生命周期状态');
  assertIncludes(miniAdd, 'channelSource: f.channelSource.trim()', '小程序新增员工未提交招聘渠道');
  assertIncludes(miniInsurance, 'employerInsuranceAction', '小程序未提交雇主险增减动作');

  assertIncludes(miniHome, '/employees/onsite-overview', '小程序首页未使用共享驻厂人员概览接口');
  if (/\/work-tasks|\/operations\/home|\/summary/.test(miniHome)) throw new Error('小程序快速工作台仍加载非核心待办或运营数据');
  assertIncludes(miniPayroll, '/payroll/overview', '小程序工资页未使用共享工资接口');
  assertIncludes(miniAdd, '/bootstrap', '小程序员工录入未使用共享基础数据接口');
  assertIncludes(miniAdd, '/recruitment-channels', '小程序员工录入未使用共享招聘渠道接口');
}

console.log(fs.existsSync(miniRoot)
  ? '网页端、手机 Web 与小程序数据关联契约检查通过。'
  : 'Web/API 发布包数据关联契约检查通过（小程序源码独立发布）。');
