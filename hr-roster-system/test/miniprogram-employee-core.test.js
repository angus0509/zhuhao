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
    'pages/employees/contract/index',
    'pages/employees/transfer/index',
    'pages/employees/transfer-handle/index',
    'pages/employees/insurance/index',
    'pages/employees/resign/index',
    'pages/tasks/index'
  ]) {
    if (!appJson.pages.includes(page)) throw new Error(`核心员工页面未注册：${page}`);
  }
  const onsiteTab = appJson.tabBar.list.find(item => item.pagePath === 'pages/employees/index');
  if (onsiteTab?.text !== '驻厂') throw new Error('员工核心入口未与当前底部菜单名称对齐');

  const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
  const homeWxml = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
  assertIncludes(homeJs, "request({ url: '/employees/onsite-overview' })", '小程序首页未加载驻厂员工概览');
  assertIncludes(homeJs, "wx.setStorageSync('onsite_employee_stage'", '小程序首页无法直达员工生命周期筛选');
  assertIncludes(homeWxml, '驻厂快速办理', '小程序首页缺少驻厂快速办理入口');
  for (const label of ['录入新员工', '待到岗', '在职员工', '已离职']) assertIncludes(homeWxml, label, `首页缺少快速入口：${label}`);
  if (/驻厂处理队列|合规待办|goRiskCenter|goTodo/.test(homeJs + homeWxml)) throw new Error('首页仍保留旧驻厂待办流程');

  const taskJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
  const taskWxml = read('wechat-miniprogram/miniprogram/pages/tasks/index.wxml');
  assertIncludes(taskJs, "request({ url: '/risk-alerts' })", '风险处理页未加载具体风险提醒');
  assertIncludes(taskJs, "request({ url: '/work-tasks?taskStatus=0' })", '合规待办页未加载待处理事项');
  assertIncludes(taskJs, "request({ url: '/work-tasks?taskStatus=1' })", '合规待办页未加载处理中事项');
  assertIncludes(taskJs, '/pages/employees/compliance/index?id=', '合同和雇主险待办无法直达合并办理');
  assertIncludes(taskJs, "hasPermission(session.user, 'contract:manage')", '合同待办直接办理缺少权限校验');
  assertIncludes(taskJs, "hasPermission(session.user, 'social:manage')", '雇主险待办直接办理缺少权限校验');
  assertIncludes(taskJs, 'avatarText:', '风险事项未在 JS 中生成微信兼容的头像文字');
  if (taskWxml.includes('.slice(')) throw new Error('风险处理页 WXML 不应直接调用 JavaScript 方法');
  assertIncludes(taskWxml, 'bindtap="handleItem"', '具体风险事项缺少直接处理按钮');

  const addJs = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
  assertIncludes(addJs, 'employeeStatus: 1', '新增员工必须固定进入待到岗');
  assertIncludes(addJs, 'workTypeIndex: 0', '新增员工工资类型应与网页端一致默认计时');
  assertIncludes(addJs, 'function sortPositionsForEmployeeForm', '新增员工岗位缺少普工优先排序逻辑');
  assertIncludes(addJs, "item.positionCode === 'OP' || item.positionName === '普工'", '新增员工未默认定位普工岗位');
  if (/EMPLOYEE_STATUS_VALUES|employeeStatusIndex/.test(addJs)) throw new Error('新增员工仍允许选择生命周期状态');
  if (addJs.includes("if (!f.channelSource.trim())")) throw new Error('招聘渠道仍被强制必填');
  assertIncludes(addJs, 'channelSource: f.channelSource.trim()', '新增员工未提交自由文本招聘渠道');
  assertIncludes(addJs, 'editingEmployeeId', '小程序新增员工页未支持编辑模式');
  assertIncludes(addJs, "method: this.data.editingEmployeeId ? 'PUT' : 'POST'", '小程序员工编辑未调用更新接口');
  assertIncludes(addJs, "url: '/employees/precheck'", '新增员工未执行身份证、黑名单和重复预检查');
  assertIncludes(addJs, 'wx.chooseMedia({', '新增员工缺少身份证拍摄或相册选择能力');
  assertIncludes(addJs, 'wx.compressImage({', '身份证图片上传前未压缩');
  assertIncludes(addJs, "encoding: 'base64'", '身份证图片未转换为OCR接口要求的Base64格式');
  assertIncludes(addJs, "url: '/ocr/idcard'", '新增员工未调用身份证OCR接口');
  assertIncludes(addJs, "'form.name': result.name", '身份证OCR未自动回填员工姓名');
  assertIncludes(addJs, "'form.gender': [1, 2].includes", '身份证OCR未自动回填员工性别');
  assertIncludes(addJs, "'form.idCardNo': result.idCardNo", '身份证OCR未自动回填身份证号');
  assertIncludes(addJs, "'form.address': result.address", '身份证OCR未自动回填身份证地址');
  assertIncludes(addJs, '您仍可手工填写', '身份证OCR失败后缺少手工录入降级提示');
  const addWxml = read('wechat-miniprogram/miniprogram/pages/employees/add/index.wxml');
  assertIncludes(addWxml, '客户与岗位归属', '新增员工页缺少客户与岗位分区');
  assertIncludes(addWxml, '用工与计费信息', '新增员工页缺少用工与计费分区');
  assertIncludes(addWxml, 'submit-dock', '新增员工页缺少固定提交操作区');
  if (/wx:elif="\{\{submitError\}\}"/.test(addWxml)) throw new Error('提交错误仍会隐藏整个新增员工表单');

  const onboardJs = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.js');
  assertIncludes(onboardJs, "url: `/employees/${this.data.employeeId}/onboard`", '确认入职未调用员工入职接口');
  assertIncludes(onboardJs, "markDirty('employees', 'home', 'tasks', 'advances')", '确认入职后未刷新人员数据');

  const listJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
  assertIncludes(listJs, 'customerStats', '员工列表缺少客户分类统计');
  assertIncludes(listJs, 'insuranceComplete: employerCovered', '员工列表未按雇主险判断完成状态');
  if (listJs.includes('activeInsurance')) throw new Error('驻厂人员页仍保留已取消的独立雇主险筛选');
  assertIncludes(listJs, "activeStage: ''", '驻厂人员页应默认展示当前客户全部人员');
  assertIncludes(listJs, 'Number(item.employeeStatus) === 1 || Number(item.employeeStatus) === 6', '驻厂人员页未将历史面试并入待到岗');
  assertIncludes(listJs, "stage === 'left'", '驻厂人员页缺少已离职筛选');
  assertIncludes(listJs, 'goOnboard(event)', '驻厂人员列表缺少快捷确认入职');
  assertIncludes(listJs, 'goResign(event)', '驻厂人员列表缺少快捷离职管理');
  assertIncludes(listJs, 'async loadAllEmployeePages(keyword, customerId', '驻厂人员页仍只读取前200名员工');
  assertIncludes(listJs, "request({ url: '/employees/onsite-overview' })", '驻厂人员页未使用轻量客户统计接口');
  assertIncludes(listJs, 'startPage += 4', '大花名册加载缺少移动网络并发控制');

  const insuranceJs = read('wechat-miniprogram/miniprogram/pages/employees/insurance/index.js');
  const insuranceWxml = read('wechat-miniprogram/miniprogram/pages/employees/insurance/index.wxml');
  assertIncludes(insuranceJs, "ACTION_VALUES = ['', 'ADD', 'REMOVE']", '小程序雇主险页面缺少增保减保选项');
  assertIncludes(insuranceJs, 'employerInsuranceAction', '小程序未提交雇主险增减动作');
  assertIncludes(insuranceJs, "requestedAction: ''", '雇主险页面仍可能自动预选危险操作');
  assertIncludes(insuranceJs, "['ADD', 'REMOVE'].includes(options.action)", '雇主险页面未限制明确业务入口动作');
  if (/社保状态|公积金/.test(insuranceWxml)) throw new Error('小程序雇主险页面仍显示社保或公积金');

  const detailJs = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.js');
  const detailWxml = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml');
  assertIncludes(detailJs, 'goEdit()', '小程序员工详情缺少编辑入口');
  assertIncludes(detailJs, "hasPermission(session.user, 'employee:update')", '员工详情缺少入职权限判断');
  if (/goContract|goInsurance|contract:manage|social:manage/.test(detailJs) || /登记合同|雇主险增减/.test(detailWxml)) throw new Error('员工详情仍保留驻厂合同或雇主险办理入口');
  assertIncludes(detailJs, "hasPermission(session.user, 'employee:resign')", '员工详情缺少离职权限判断');
  assertIncludes(detailJs, "hasPermission(session.user, 'employee:transfer')", '员工详情缺少转岗权限判断');
  assertIncludes(detailJs, 'onShow()', '员工详情返回后不会自动刷新');
  assertIncludes(detailJs, "basic.lifecycleStatus === 'OFFBOARDING'", '员工详情未识别离职交接状态');
  assertIncludes(detailJs, 'isOffboarding ? 80', '员工生命周期进度未按快速离职流程计算');

  const transferJs = read('wechat-miniprogram/miniprogram/pages/employees/transfer/index.js');
  assertIncludes(transferJs, 'newProjectId', '小程序转岗缺少目标项目');
  assertIncludes(transferJs, '/job-transfer', '小程序转岗未调用后端接口');
  assertIncludes(transferJs, 'projectRequired', '小程序转岗未根据驻厂范围强制选择项目');
  assertIncludes(transferJs, 'currentProjectId', '小程序转岗未保留员工当前项目关联');

  const contractJs = read('wechat-miniprogram/miniprogram/pages/employees/contract/index.js');
  assertIncludes(contractJs, "hasPermission(session.user, 'contract:manage')", '小程序合同页缺少权限校验');
  assertIncludes(contractJs, '`/employees/${this.data.employeeId}/contracts`', '小程序合同页未调用合同登记接口');
  assertIncludes(contractJs, 'contractDate: today()', '小程序合同页缺少默认合同日期');
  assertIncludes(contractJs, 'data: { signStatus, contractDate: form.contractDate }', '小程序合同页未使用快速登记请求');
  assertIncludes(contractJs, "require('../../../utils/upload')", '小程序合同页未接入受保护附件上传');
  assertIncludes(contractJs, 'wx.chooseMessageFile({', '小程序合同页无法选择微信文件');
  assertIncludes(contractJs, 'wx.chooseMedia({', '小程序合同页无法拍摄合同图片');
  assertIncludes(contractJs, "bizType: 'contract'", '小程序合同附件未关联劳动合同记录');
  assertIncludes(contractJs, 'savedContractId', '合同已保存但附件失败时无法安全重试');

  const uploadUtil = read('wechat-miniprogram/miniprogram/utils/upload.js');
  assertIncludes(uploadUtil, 'wx.uploadFile({', '小程序缺少文件上传封装');
  assertIncludes(uploadUtil, "name: 'file'", '小程序上传字段名与后端不一致');
  assertIncludes(uploadUtil, 'authorization: `Bearer ${session.token}`', '小程序附件上传缺少登录凭证');

  const downloadUtil = read('wechat-miniprogram/miniprogram/utils/download.js');
  assertIncludes(downloadUtil, 'wx.downloadFile({', '小程序缺少受保护附件下载');
  assertIncludes(downloadUtil, 'wx.openDocument({', '小程序无法打开PDF或Word合同');
  assertIncludes(downloadUtil, 'wx.previewImage({', '小程序无法预览合同图片');

  const transferHandleJs = read('wechat-miniprogram/miniprogram/pages/employees/transfer-handle/index.js');
  assertIncludes(transferHandleJs, "hasPermission(session.user, 'employee:transfer')", '小程序转岗接收页缺少权限校验');
  assertIncludes(transferHandleJs, '`/employee-transfers/${this.data.changeId}/handle`', '小程序转岗接收页未调用处理接口');
  assertIncludes(transferHandleJs, 'approved: approved ? 1 : 0', '小程序转岗接收页未明确提交接收或拒绝结果');

  const resignJs = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.js');
  for (const field of ['badgeReturned', 'toolsReturned', 'dormCleared', 'attendanceConfirmed']) {
    assertIncludes(resignJs, field, `小程序离职缺少交接项：${field}`);
  }
  assertIncludes(resignJs, 'progressMode', '小程序离职页面缺少历史交接兼容模式');
  assertIncludes(resignJs, '`/resignations/${this.data.resignationId}/progress`', '小程序无法更新离职交接进度');
  if (/employerInsuranceCovered|terminateEmployerInsurance/.test(resignJs)) throw new Error('离职页面仍要求雇主险减保');
  assertIncludes(resignJs, '确认离职并归档', '离职页面缺少一次办结确认');
  if (/payroll:manage|settlementStatus|工资结算/.test(resignJs)) throw new Error('小程序离职仍包含薪资结算环节');
}

const routeSource = read('src/routes/employee.routes.js');
assertIncludes(routeSource, "router.post('/employees/:id/onboard'", '后端未注册确认入职接口');
assertIncludes(routeSource, "router.put('/employees/:id/social-security'", '后端未注册保险管理接口');
assertIncludes(routeSource, "router.post('/employees/:id/resign'", '后端未注册离职接口');
assertIncludes(routeSource, "'/resignations/:resignationId/progress'", '后端未注册离职进度接口');
assertIncludes(routeSource, "requirePermission('employee:resign')", '离职进度接口未限制为离职办理权限');

const serviceSource = read('src/services/employee.service.js');
assertIncludes(serviceSource, 'async function onboardEmployee', '缺少确认入职业务逻辑');
const onboardBlock = serviceSource.match(/async function onboardEmployee[\s\S]*?\n}\n\nasync function handleInterviewResult/)?.[0] || '';
if (/createOnboardingCompliance|contract_missing:|employer_insurance_missing:/.test(onboardBlock)) throw new Error('确认入职仍生成合同或雇主险待办');
const resignBlock = serviceSource.match(/async function resignEmployee[\s\S]*?\n}\n\nasync function updateResignationProgress/)?.[0] || '';
if (resignBlock.includes('terminateEmployerInsuranceForResignation')) throw new Error('快速离职仍强制办理雇主险减保');
assertIncludes(serviceSource, "['ADD', 'REMOVE'].includes(employerInsuranceAction)", '后端未限制雇主险增保减保动作');
assertIncludes(serviceSource, 'const insuranceDone = true;', '快速离职仍被雇主险台账状态阻塞');
if (serviceSource.includes("taskType: 'PAYROLL_SETTLEMENT'")) throw new Error('离职仍创建工资结算待办');
assertIncludes(serviceSource, "if (crossCustomer && !targetProjectId) throw createError('跨客户转岗必须选择目标项目')", '跨客户转岗仍可能丢失目标项目');
assertIncludes(serviceSource, "if (!targetPosition) throw createError('目标岗位不存在或已停用')", '调岗未校验目标岗位归属与状态');
assertIncludes(serviceSource, "目标客户、项目和岗位均未变化", '调岗未阻止无变化的重复任职记录');
assertIncludes(serviceSource, "[1, 2, 3, 4].includes(contractType)", '合同接口未限制有效合同类型');
assertIncludes(serviceSource, "[0, 1, 2].includes(signStatus)", '合同接口未限制有效签署状态');
assertIncludes(serviceSource, 'signStatus === 1 && !signDate', '合同接口未要求已签合同填写合同日期');
assertIncludes(serviceSource, "renewalCount < 0", '合同接口未校验续签次数');

console.log(fs.existsSync(miniAppPath)
  ? '小程序驻厂员工入职、在职维护、雇主险和离职交接核心契约检查通过。'
  : 'Web发布包员工核心后端契约检查通过（小程序源码独立发布）。');
