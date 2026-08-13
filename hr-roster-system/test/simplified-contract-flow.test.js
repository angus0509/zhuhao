const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
const homeWxml = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
assertIncludes(homeJs, 'onsiteOperationalTotal:', '小程序首页未单独统计驻厂现场待办');
assertIncludes(homeJs, "!['CONTRACT', 'INSURANCE', 'ONBOARDING_COMPLIANCE'].includes(item.taskType)", '驻厂待办未排除合规事项');
assertIncludes(homeWxml, '<text>驻厂待处理</text>', '首页未将重复的未处理风险改为驻厂待处理');
assertIncludes(homeWxml, 'data-mode="operations"', '驻厂待处理未进入非重复业务队列');
if (homeWxml.includes('<text>未处理风险</text>')) throw new Error('首页仍显示与合规待办重复的未处理风险');

const taskJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
assertIncludes(taskJs, "['risk', 'compliance', 'all', 'operations']", '待办页未支持驻厂业务专用模式');
assertIncludes(taskJs, "this.data.mode === 'operations'", '驻厂业务队列未排除合规重复事项');

const miniContractJs = read('wechat-miniprogram/miniprogram/pages/employees/contract/index.js');
const miniContractWxml = read('wechat-miniprogram/miniprogram/pages/employees/contract/index.wxml');
assertIncludes(miniContractJs, "SIGN_STATUS_NAMES = ['未签', '已签']", '小程序合同快速登记仍包含多余状态');
assertIncludes(miniContractJs, 'contractDate:', '小程序合同快速登记缺少统一合同日期');
assertIncludes(miniContractJs, 'data: { signStatus, contractDate: form.contractDate }', '小程序未使用最小合同请求');
assertIncludes(miniContractWxml, '<text>签署状态 *</text>', '小程序合同登记缺少签署状态');
assertIncludes(miniContractWxml, '<text>合同日期 *</text>', '小程序合同登记缺少合同日期');
for (const removed of ['合同编号 *', '合同类型 *', '开始日期 *', '续签次数']) {
  if (miniContractWxml.includes(removed)) throw new Error(`小程序合同快速登记仍显示多余字段：${removed}`);
}

const html = read('public/index.html');
const webContractBlock = html.slice(html.indexOf('id="contractModal"'), html.indexOf('id="socialModal"'));
assertIncludes(webContractBlock, 'name="contractDate"', '网页端合同登记缺少合同日期');
for (const removed of ['name="contractNo"', 'name="contractType"', 'name="startDate"', 'name="endDate"', 'name="renewalCount"']) {
  if (webContractBlock.includes(removed)) throw new Error(`网页端合同快速登记仍显示多余字段：${removed}`);
}

const employeeService = read('src/services/employee.service.js');
assertIncludes(employeeService, 'body.contractDate || body.signDate || body.startDate', '合同服务未兼容统一合同日期');
assertIncludes(employeeService, "body.contractType || 2", '合同服务未为快速登记设置默认合同类型');
assertIncludes(employeeService, "`HT${datePart}${employeeId}${uniquePart}`", '合同服务未自动生成合同编号');

console.log('待办去重与合同快速登记流程检查通过。');
