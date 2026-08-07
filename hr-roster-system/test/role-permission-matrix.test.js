const assert = require('node:assert/strict');
const { requireAuth, requirePermission, requireAnyPermission } = require('../src/middlewares/auth.middleware');
const { verifyToken } = require('../src/utils/token');
const authService = require('../src/services/auth.service');
const systemService = require('../src/services/system.service');
const { employeeScope, projectScope, customerScope } = require('../src/utils/data-scope');

// 不依赖真实数据库的中间件单元测试。模拟包含特定 permissions 的 req 对象。

function makeReq(user = null) {
  return { user, header: () => '' };
}

function makeRes() {
  return {};
}

function captureNextError() {
  let called = false;
  let captured = null;
  const next = (err) => { called = true; captured = err || null; };
  return { next, getError: () => captured, wasCalled: () => called };
}

// -------------------------------------------------------------------
// 一、requirePermission 中间件
// -------------------------------------------------------------------

// 1.1 未登录用户
{
  const req = makeReq(null);
  const { next, getError } = captureNextError();
  requirePermission('employee:view')(req, makeRes(), next);
  const err = getError();
  assert.ok(err, '未登录应返回错误');
  assert.equal(err.statusCode || 401, 401, '未登录应返回 401');
}

// 1.2 有权限
{
  const req = makeReq({ permissions: ['employee:view', 'employee:create'] });
  const { next, getError } = captureNextError();
  requirePermission('employee:view')(req, makeRes(), next);
  assert.equal(getError(), null, '拥有权限时不应报错');
}

// 1.3 无权限
{
  const req = makeReq({ permissions: ['employee:view'] });
  const { next, getError } = captureNextError();
  requirePermission('employee:create')(req, makeRes(), next);
  const err = getError();
  assert.ok(err, '缺少权限应返回错误');
  assert.equal(err.statusCode || 403, 403, '缺少权限应返回 403');
}

// 1.4 insurance:view — 有权限场景
{
  const req = makeReq({ permissions: ['insurance:view'] });
  const { next, getError } = captureNextError();
  requirePermission('insurance:view')(req, makeRes(), next);
  assert.equal(getError(), null, '拥有 insurance:view 应通过');
}

// 1.5 insurance:view — 无权限场景（模拟驻厂专员/薪资专员）
{
  const req = makeReq({ permissions: ['employee:view', 'employee:create'] });
  const { next, getError } = captureNextError();
  requirePermission('insurance:view')(req, makeRes(), next);
  const err = getError();
  assert.ok(err, '缺少 insurance:view 应返回 403（驻厂/薪资专员场景）');
  assert.equal(err.statusCode || 403, 403);
}

// 1.6 audit:view — 有权限场景
{
  const req = makeReq({ permissions: ['audit:view'] });
  const { next, getError } = captureNextError();
  requirePermission('audit:view')(req, makeRes(), next);
  assert.equal(getError(), null, '拥有 audit:view 应通过');
}

// 1.7 audit:view — 无权限场景（模拟驻厂专员/薪资专员）
{
  const req = makeReq({ permissions: ['employee:view'] });
  const { next, getError } = captureNextError();
  requirePermission('audit:view')(req, makeRes(), next);
  const err = getError();
  assert.ok(err, '缺少 audit:view 应返回 403（驻厂/薪资专员场景）');
  assert.equal(err.statusCode || 403, 403);
}

// 1.8 system:role — 驻厂专员不应拥有
{
  const req = makeReq({ permissions: ['employee:view', 'employee:create', 'customer:manage'] });
  const { next, getError } = captureNextError();
  requirePermission('system:role')(req, makeRes(), next);
  const err = getError();
  assert.ok(err, '驻厂专员不应拥有 system:role');
  assert.equal(err.statusCode || 403, 403);
}

// -------------------------------------------------------------------
// 二、多权限要求（requirePermission 链式调用模拟）
// -------------------------------------------------------------------

// 离职进度允许驻厂离职权限或薪资管理权限进入，再由服务层校验可修改字段。
for (const permission of ['employee:resign', 'payroll:manage']) {
  const req = makeReq({ permissions: [permission] });
  const { next, getError } = captureNextError();
  requireAnyPermission(['employee:resign', 'payroll:manage'])(req, makeRes(), next);
  assert.equal(getError(), null, `${permission} 应可进入离职进度接口`);
}
{
  const req = makeReq({ permissions: ['employee:view'] });
  const { next, getError } = captureNextError();
  requireAnyPermission(['employee:resign', 'payroll:manage'])(req, makeRes(), next);
  assert.equal(getError()?.statusCode || 403, 403, '普通查看权限不能进入离职进度接口');
}

// 2.1 创建客户需要同时有 customer:manage 和 project:manage
{
  const req = makeReq({ permissions: ['customer:manage'] });
  const { next, getError } = captureNextError();
  // 第一个通过
  requirePermission('customer:manage')(req, makeRes(), (err1) => {
    if (err1) return;
    // 第二个应该失败（缺少 project:manage）
    requirePermission('project:manage')(req, makeRes(), (err2) => {
      assert.ok(err2, '仅有 customer:manage 不能创建客户（缺 project:manage）');
    });
  });
}

// 2.2 创建客户同时有 customer:manage 和 project:manage
{
  const req = makeReq({ permissions: ['customer:manage', 'project:manage'] });
  let passed = false;
  requirePermission('customer:manage')(req, makeRes(), (err1) => {
    if (err1) return;
    requirePermission('project:manage')(req, makeRes(), (err2) => {
      if (err2) return;
      passed = true;
    });
  });
  assert.ok(passed, '同时拥有 customer:manage 和 project:manage 应通过');
}

// -------------------------------------------------------------------
// 三、数据范围隔离
// -------------------------------------------------------------------

// 3.1 全公司权限 (dataScope=1)
{
  const user = { id: 1, companyId: 1, dataScope: 1 };
  const params = { companyId: 1 };
  const sql = employeeScope(user, params, 'e', 'j');
  assert.equal(sql, '', 'dataScope=1 不应添加限制条件');
}

// 3.2 本人权限 (dataScope=4) — 只能看自己
{
  const user = { id: 10, companyId: 1, employeeId: 88, dataScope: 4 };
  const params = { companyId: 1 };
  const sql = employeeScope(user, params, 'e', 'j');
  assert.match(sql, /e\.id = :scopeEmployeeId/, 'dataScope=4 应限制为本人');
  assert.equal(params.scopeEmployeeId, 88);
}

// 3.3 项目授权 (dataScope=5)
{
  const user = { id: 9, companyId: 1, dataScope: 5 };
  const params = { companyId: 1 };
  const sql = employeeScope(user, params, 'e', 'j');
  assert.match(sql, /sys_user_project/, 'dataScope=5 应使用项目授权表');
}

// 3.4 部门范围无部门时拒绝访问
{
  const user = { id: 11, companyId: 1, dataScope: 3, scopeDeptIds: [] };
  const params = { companyId: 1 };
  const sql = employeeScope(user, params, 'e', 'j');
  assert.match(sql, /AND 1 = 0/, '无部门时应拒绝访问');
}

// 3.5 projectScope — 项目授权用户只能看已授权项目
{
  const user = { id: 9, companyId: 1, dataScope: 5 };
  const params = { companyId: 1 };
  const sql = projectScope(user, params, 'p');
  assert.match(sql, /sys_user_project/, '项目授权应过滤已授权项目');
}

// 3.6 customerScope — 项目授权用户只能看已授权项目的客户
{
  const user = { id: 9, companyId: 1, dataScope: 5 };
  const params = { companyId: 1 };
  const sql = customerScope(user, params, 'c');
  assert.match(sql, /sys_user_project/, '客户授权应过滤已授权项目的客户');
}

// -------------------------------------------------------------------
// 四、systemService 角色管理常量
// -------------------------------------------------------------------

{
  const expected = ['company_admin', 'hr_manager', 'onsite_staff', 'payroll_staff'];
  assert.deepStrictEqual(systemService.MANAGED_ROLE_CODES, expected, 'MANAGED_ROLE_CODES 必须只有四类业务角色');
}

// expandPermissionIds: 勾选子权限时自动包含上级菜单权限
{
  const perms = [
    { id: 1, parentId: 0 },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 2 },
    { id: 4, parentId: 1 }
  ];
  const result = systemService.expandPermissionIds(perms, [3, 4]).sort((a, b) => a - b);
  assert.deepStrictEqual(result, [1, 2, 3, 4], '子权限(3,4)应自动包含所有上级(1,2)');
}

// 企业管理员权限不可被压缩：勾子权限时必须自动包含所有上级
{
  const perms = [
    { id: 1, parentId: 0 },
    { id: 2, parentId: 1 }
  ];
  const result = systemService.expandPermissionIds(perms, [2]).sort((a, b) => a - b);
  assert.deepStrictEqual(result, [1, 2], '即使只勾子权限，企业管理员核心菜单权限也应自动包含上级');
}

console.log('role-permission-matrix-tests-ok');
