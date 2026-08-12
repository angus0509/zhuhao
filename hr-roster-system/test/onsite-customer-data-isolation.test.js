const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('src/services/employee.service.js');
const controller = read('src/controllers/employee.controller.js');
const { employeeScope } = require('../src/utils/data-scope');

for (const operation of ['listEmployees', 'getEmployeeDetail', 'updateEmployee', 'resignEmployee']) {
  assert.match(service, new RegExp(`(?:async function|function) ${operation}\\b`), `缺少员工操作：${operation}`);
}
assert.match(service, /getEmployeeDetail[\s\S]*resolveDataScope[\s\S]*applyDataScope/, '员工详情必须应用数据范围');
const scopedSql = employeeScope({ id: 7, companyId: 1, dataScope: 5 }, { companyId: 1 }, 'e', 'j');
assert.match(scopedSql, /sys_user_project/, '驻厂范围必须绑定授权项目');
assert.match(scopedSql, /scope_project\.id\s*=\s*j\.project_id/, '驻厂员工范围不得按客户扩大');
assert.doesNotMatch(scopedSql, /scope_project\.customer_id\s*=\s*j\.customer_id/, '驻厂员工范围不得按客户扩大');
assert.match(controller, /showSensitive[\s\S]*getEmployeeDetail[\s\S]*user:\s*req\.user/, '敏感信息接口也必须传入当前用户范围');

console.log('onsite-customer-data-isolation-tests-ok');
