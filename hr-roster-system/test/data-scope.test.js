const assert = require('node:assert/strict');
const { projectScope, customerScope, employeeScope } = require('../src/utils/data-scope');

function testDepartmentScope() {
  const user = { id: 8, companyId: 1, dataScope: 2, scopeDeptIds: [3, 4] };
  const employeeParams = { companyId: 1 };
  const employeeSql = employeeScope(user, employeeParams, 'e', 'j');
  assert.match(employeeSql, /j\.dept_id IN \(:scopeDeptId0, :scopeDeptId1\)/);
  assert.equal(employeeParams.scopeDeptId0, 3);
  assert.equal(employeeParams.scopeDeptId1, 4);

  const projectSql = projectScope(user, { companyId: 1 }, 'p');
  assert.match(projectSql, /scope_job\.customer_id = p\.customer_id/);
  assert.doesNotMatch(projectSql, /AND 1 = 0/);

  const customerSql = customerScope(user, { companyId: 1 }, 'c');
  assert.match(customerSql, /scope_job\.customer_id = c\.id/);
}

function testProjectAndSelfScope() {
  const projectSql = projectScope({ id: 9, companyId: 1, dataScope: 5 }, { companyId: 1 }, 'p');
  assert.match(projectSql, /sys_user_project/);

  const params = { companyId: 1 };
  const employeeProjectSql = employeeScope({ id: 9, companyId: 1, dataScope: 5 }, params, 'e', 'j');
  assert.match(employeeProjectSql, /scope_project\.id = j\.project_id/, '驻厂员工范围必须按授权项目ID隔离');
  assert.doesNotMatch(employeeProjectSql, /scope_project\.customer_id = j\.customer_id/, '驻厂员工范围不得按客户单位放大');
  assert.match(employeeProjectSql, /e\.created_by = :scopeUserId AND j\.project_id IS NULL/, '驻厂人员应保留自己录入且未分配项目的历史员工');

  const selfSql = employeeScope({ id: 10, companyId: 1, employeeId: 88, dataScope: 4 }, params);
  assert.match(selfSql, /e\.id = :scopeEmployeeId/);
  assert.equal(params.scopeEmployeeId, 88);
}

function testEmptyDepartmentScopeIsClosed() {
  const sql = employeeScope({ id: 11, companyId: 1, dataScope: 3, scopeDeptIds: [] }, { companyId: 1 });
  assert.match(sql, /AND 1 = 0/);
}

testDepartmentScope();
testProjectAndSelfScope();
testEmptyDepartmentScopeIsClosed();
console.log('data-scope-tests-ok');
