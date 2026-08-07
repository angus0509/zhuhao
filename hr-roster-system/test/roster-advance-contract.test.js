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
assert(!html.includes('name="projectId" id="advanceProjectSelect" required'), '普通预支申请不应强制要求项目');
assert(app.includes('populateAdvanceProjectOptions'), '预支项目必须按客户单位联动');
assert(app.includes('(clientResult.list || clientResult).map'), '客户接口分页结果必须转换为客户数组');
assert(app.includes("item.clientName || item.customerName || ''"), '客户名称字段必须兼容生产接口 customerName');
assert(operations.includes('p.customer_id customerId'), '项目接口必须返回 customerId 供客户项目联动');
assert(operations.includes('c.customer_name customerName'), '预支列表必须返回客户单位名称');
assert.strictEqual(typeof employeeService.buildInternalEmployeeNo, 'function', '员工服务必须提供内部编号生成器');
assert(/^YY[A-Z0-9]+$/.test(employeeService.buildInternalEmployeeNo()), '内部员工编号格式不正确');

console.log('roster-advance-contract-ok');
