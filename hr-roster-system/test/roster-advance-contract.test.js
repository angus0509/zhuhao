const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const operations = fs.readFileSync(path.join(root, 'src/services/operations.service.js'), 'utf8');
const employeeService = require('../src/services/employee.service');

assert(!html.includes('<span>工号</span><input name="employeeNo"'), '员工录入页面不应再要求填写工号');
assert(html.includes('id="advanceCustomerSelect"'), '预支表单必须提供客户单位选择');
assert(html.includes('id="advanceProjectSelect"'), '预支表单必须保留可选项目选择');
assert(html.includes('name="recordMode" value="onsite"'), '网页端预支表单未启用驻厂登记模式');
assert(html.includes('name="advanceAt" type="datetime-local"'), '网页端预支登记缺少预支时间');
assert(html.includes('<th>预支时间</th>'), '网页端预支台账未展示预支时间');
assert(html.includes('<th>用途</th>'), '网页端预支台账未展示用途');
assert(!html.includes('name="projectId" id="advanceProjectSelect" required'), '普通预支申请不应强制要求项目');
assert(app.includes('populateAdvanceProjectOptions'), '预支项目必须按客户单位联动');
assert(app.includes('(clientResult.list || clientResult).map'), '客户接口分页结果必须转换为客户数组');
assert(app.includes("item.clientName || item.customerName || ''"), '客户名称字段必须兼容生产接口 customerName');
assert(operations.includes('p.customer_id customerId'), '项目接口必须返回 customerId 供客户项目联动');
assert(operations.includes('c.customer_name customerName'), '预支列表必须返回客户单位名称');
assert(operations.includes('COALESCE(a.paid_at,a.created_at) advanceAt'), '预支列表未返回统一预支时间');
assert(operations.includes('creator.real_name recordedByName'), '预支列表未返回驻厂登记人');
assert(operations.includes("const onsiteRecord = body.recordMode === 'onsite';"), '后端未区分驻厂现场登记模式');
assert(operations.includes('advanceStatus: onsiteRecord ? 4 : 1'), '驻厂登记未直接形成已登记预支记录');
assert(operations.includes('outstandingAmount: onsiteRecord ? amount : 0'), '驻厂登记未同步形成未结余额');
assert(operations.includes("if (amount > 2000) throw createError('单笔预支金额不能超过2000元');"), '后端未限制单笔预支金额');
assert(operations.includes("'create_onsite_record'"), '驻厂预支登记未写入脱敏审计日志');

const miniPath = path.join(root, 'wechat-miniprogram/miniprogram/pages/advances/index.js');
if (fs.existsSync(miniPath)) {
  const miniJs = fs.readFileSync(miniPath, 'utf8');
  const miniWxml = fs.readFileSync(path.join(root, 'wechat-miniprogram/miniprogram/pages/advances/index.wxml'), 'utf8');
  assert(miniJs.includes("recordMode: 'onsite'"), '小程序未提交驻厂预支登记模式');
  assert(miniJs.includes('advanceAt: `${form.advanceDate}T${form.advanceTime}`'), '小程序未提交预支时间');
  assert(miniJs.includes('loadAllActiveEmployees'), '小程序驻厂预支无法选择完整在职员工');
  assert(miniWxml.includes('驻厂预支记录'), '小程序预支页面未调整为驻厂台账');
  assert(miniWxml.includes('预支用途 *'), '小程序预支登记缺少用途字段');
  assert(miniWxml.includes('登记人'), '小程序预支台账未展示登记人');
}
assert.strictEqual(typeof employeeService.buildInternalEmployeeNo, 'function', '员工服务必须提供内部编号生成器');
assert(/^YY[A-Z0-9]+$/.test(employeeService.buildInternalEmployeeNo()), '内部员工编号格式不正确');

console.log('roster-advance-contract-ok');
