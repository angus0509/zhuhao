const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const authService = require('../src/services/auth.service');
const {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireManagerAccount,
  requireEmployeeAccount
} = require('../src/middlewares/auth.middleware');
const { hashPassword } = require('../src/utils/password');
const { verifyToken } = require('../src/utils/token');
const payslipRouter = require('../src/routes/payslip.routes');
const attachmentRouter = require('../src/routes/attachment.routes');

function runGuard(guard, user) {
  let nextError;
  let called = false;
  guard({ user }, {}, error => {
    called = true;
    nextError = error || null;
  });
  assert.equal(called, true, '账号守卫必须调用 next');
  return nextError;
}

async function withDbStubs(stubs, callback) {
  const originalFirst = db.first;
  const originalQuery = db.query;
  db.first = stubs.first || originalFirst;
  db.query = stubs.query || originalQuery;
  try {
    return await callback();
  } finally {
    db.first = originalFirst;
    db.query = originalQuery;
  }
}

async function main() {
  // 通用附件接口承载合同、证件、雇主险和风险材料，必须保持为管理端业务入口。
  const attachmentLayers = attachmentRouter.stack || [];
  const attachmentAuthIndex = attachmentLayers.findIndex(layer => layer.name === 'requireAuth');
  const attachmentManagerIndex = attachmentLayers.findIndex(layer => layer.name === 'requireManagerAccount');
  const attachmentRouteLayers = attachmentLayers.filter(layer => layer.route);
  assert.ok(attachmentAuthIndex >= 0, '管理附件接口必须验证登录状态');
  assert.ok(attachmentManagerIndex > attachmentAuthIndex, '管理附件接口必须校验管理账号类型');
  assert.equal(attachmentRouteLayers.length, 3, '管理附件接口应保持上传、列表和下载三条路由');
  assert.ok(attachmentRouteLayers.every(routeLayer => attachmentManagerIndex < attachmentLayers.indexOf(routeLayer)),
    '附件上传、列表和下载都必须位于管理账号守卫之后');
  const attachmentManagerLayer = attachmentLayers[attachmentManagerIndex];
  assert.equal(attachmentManagerLayer.match('/attachments'), true, '管理账号守卫必须覆盖附件接口');
  assert.equal(
    attachmentManagerLayer.match('/me/payslips'),
    false,
    '附件管理守卫不得拦截后续员工本人工资条路由'
  );

  // 生产变更若从工资条路由移除员工账号守卫，关联 employee_id 的管理账号会冒充员工本人。
  const payslipLayers = payslipRouter.stack || [];
  const authLayerIndex = payslipLayers.findIndex(layer => layer.name === 'requireAuth');
  const employeeGuardIndex = payslipLayers.findIndex(layer => layer.name === 'requireEmployeeAccount');
  const payslipRouteLayers = payslipLayers.filter(layer => layer.route);
  assert.ok(authLayerIndex >= 0, '员工本人工资条路由必须先验证登录状态');
  assert.ok(employeeGuardIndex > authLayerIndex, '员工本人工资条路由必须在登录后校验员工账号类型');
  assert.equal(payslipRouteLayers.length, 5, '员工本人工资条应包含列表、详情、签名、签收和异议五条接口');
  assert.ok(payslipRouteLayers.every((_layer, index) => employeeGuardIndex < payslipLayers.indexOf(payslipRouteLayers[index])),
    '所有员工本人工资条接口都必须位于员工账号守卫之后');

  // 生产变更若漏掉账号类型守卫，员工将可以复用管理权限进入后台。
  assert.equal(runGuard(requireManagerAccount, {
    id: 10,
    accountType: 'MANAGER',
    employeeId: null
  }), null, '管理账号应通过管理端守卫');
  assert.equal(runGuard(requireManagerAccount, {
    id: 20,
    accountType: 'EMPLOYEE',
    employeeId: 88
  })?.statusCode, 403, '员工账号必须被管理端守卫拒绝');

  assert.equal(runGuard(requireEmployeeAccount, {
    id: 20,
    accountType: 'EMPLOYEE',
    employeeId: 88
  }), null, '已绑定员工档案的员工账号应通过员工端守卫');
  assert.equal(runGuard(requireEmployeeAccount, {
    id: 10,
    accountType: 'MANAGER',
    employeeId: 88
  })?.statusCode, 403, '管理账号不能冒充员工本人');
  assert.equal(runGuard(requireEmployeeAccount, {
    id: 21,
    accountType: 'EMPLOYEE',
    employeeId: null
  })?.statusCode, 403, '未绑定员工档案的员工账号不能访问员工本人接口');

  const inheritedPermissions = ['employee:view', 'payroll:manage'];
  const employeeUser = { accountType: 'EMPLOYEE', employeeId: 88, permissions: inheritedPermissions };
  assert.equal(runGuard(requirePermission('employee:view'), employeeUser)?.statusCode, 403,
    '即使存在历史角色权限，员工账号也不能通过单权限管理守卫');
  assert.equal(runGuard(requireAnyPermission(['employee:view']), employeeUser)?.statusCode, 403,
    '即使存在历史角色权限，员工账号也不能通过任一权限管理守卫');
  assert.equal(runGuard(requireAllPermissions(['employee:view']), employeeUser)?.statusCode, 403,
    '即使存在历史角色权限，员工账号也不能通过全部权限管理守卫');

  const password = 'Manager123';
  await withDbStubs({
    first: async sql => {
      assert.match(sql, /account_type[^\n]*MANAGER/i,
        '账号密码登录必须把员工账号排除在管理端入口之外');
      return {
        id: 11,
        company_id: 1,
        username: 'manager',
        real_name: '管理员',
        phone: '13800000000',
        employee_id: null,
        account_type: 'MANAGER',
        token_version: 2,
        password_hash: hashPassword(password)
      };
    },
    query: async () => []
  }, async () => {
    const result = await authService.login({ companyId: 1, username: 'manager', password });
    assert.equal(result.user.accountType, 'MANAGER', '管理端登录响应必须明确账号类型');
    assert.equal(verifyToken(result.token).accountType, 'MANAGER', '管理端 Token 必须携带账号类型');
  });

  let activeLookupSql = '';
  await withDbStubs({
    first: async sql => {
      activeLookupSql = sql;
      return {
        id: 21,
        company_id: 1,
        username: 'employee-88',
        real_name: '员工甲',
        phone: '13800000000',
        employee_id: 88,
        account_type: 'EMPLOYEE',
        employee_status: 2,
        employee_deleted_at: null,
        token_version: 0
      };
    },
    query: async () => [{
      id: 999,
      role_name: '错误继承角色',
      role_code: 'company_admin',
      data_scope: 1,
      permission_code: 'system:role'
    }]
  }, async () => {
    const user = await authService.getUserById(21);
    assert.equal(user.accountType, 'EMPLOYEE');
    assert.deepEqual(user.roles, [], '员工账号不得继承任何管理角色');
    assert.deepEqual(user.permissions, [], '员工账号不得继承任何管理权限');
    assert.equal(user.dataScope, 4, '员工账号数据范围必须固定为本人');
    assert.deepEqual(user.scopeDeptIds, [], '员工账号不得继承管理部门范围');
  });
  assert.match(activeLookupSql, /JOIN\s+hr_employee/i, '员工会话刷新必须关联员工档案');
  assert.match(activeLookupSql, /employee_status\s+IN\s*\(2,3\)/i,
    '员工会话刷新必须允许在职和已离职档案访问本人已发布工资条');
  assert.match(activeLookupSql, /deleted_at\s+IS\s+NULL/i, '员工会话刷新必须拒绝已删除档案');

  await withDbStubs({
    first: async () => ({
      id: 22,
      company_id: 1,
      username: 'departed-89',
      employee_id: 89,
      account_type: 'EMPLOYEE',
      employee_status: 3,
      employee_deleted_at: null,
      token_version: 0
    }),
    query: async () => {
      throw new Error('离职员工受限会话不应读取管理角色和权限');
    }
  }, async () => {
    const departed = await authService.getUserById(22);
    assert.equal(departed.accountType, 'EMPLOYEE');
    assert.equal(departed.employeeId, 89);
    assert.deepEqual(departed.roles, []);
    assert.deepEqual(departed.permissions, [], '离职员工仅保留本人端会话，不能继承管理权限');
    assert.equal(departed.dataScope, 4);
  });

  console.log('employee-account-isolation-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
