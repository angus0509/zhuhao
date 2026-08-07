const assert = require('assert');
const fs = require('fs');
const path = require('path');
const systemService = require('../src/services/system.service');

const expectedRoles = ['company_admin', 'hr_manager', 'onsite_staff', 'payroll_staff'];
assert.deepStrictEqual(systemService.MANAGED_ROLE_CODES, expectedRoles, '系统只能开放四类业务角色');
assert.deepStrictEqual(
  systemService.expandPermissionIds(
    [{ id: 1, parentId: 0 }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }],
    [3]
  ).sort((a, b) => a - b),
  [1, 2, 3],
  '勾选子权限时必须自动包含全部上级菜单权限'
);

const employeeRoutes = fs.readFileSync(path.resolve(__dirname, '../src/routes/employee.routes.js'), 'utf8');
assert(
  /router\.post\('\/employees\/batch',[\s\S]*?requirePermission\('employee:batch'\)/.test(employeeRoutes),
  '批量录入必须使用独立权限'
);

const page = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
for (const permissionCode of ['employee:create', 'employee:batch', 'customer:manage', 'project:manage']) {
  assert(
    new RegExp(`data-action-perm="[^"]*${permissionCode}[^"]*"`).test(page),
    `页面操作缺少权限控制：${permissionCode}`
  );
}
assert(page.includes('id="rolePermissionHint"'), '角色权限弹窗必须说明权限生效规则');
assert(page.includes('id="rolePermissionSubmit"'), '角色权限弹窗必须提供可控保存按钮');

const seedPath = path.resolve(__dirname, '../sql/seed.mysql.sql');
if (fs.existsSync(seedPath)) {
  const seed = fs.readFileSync(seedPath, 'utf8');
  for (const roleName of ['企业管理员', 'HR主管', '驻厂人员', '薪资专员']) {
    assert(seed.includes(`'${roleName}'`), `初始化数据缺少角色：${roleName}`);
  }
  for (const removedCode of ['hr_staff', 'dept_leader', 'employee_self', 'onsite_manager', 'payroll_finance']) {
    assert(!seed.includes(`'${removedCode}'`), `初始化数据仍包含已移除角色：${removedCode}`);
  }
  for (const permissionCode of ['employee:create', 'employee:batch', 'customer:manage', 'project:manage']) {
    assert(seed.includes(`'${permissionCode}'`), `驻厂专员初始化权限缺少：${permissionCode}`);
  }
  assert(seed.includes("'audit:view'"), '种子数据缺少操作日志权限');

  // HR主管必须包含雇主险办理和操作日志查看权限
  const hrManagerStart = seed.indexOf("SELECT 2, id FROM sys_permission");
  const hrManagerEnd = seed.indexOf("SELECT 3, id FROM sys_permission");
  const hrManagerBlock = seed.slice(hrManagerStart, hrManagerEnd);
  assert(hrManagerBlock.includes("'social:manage'"), 'HR主管缺少雇主险办理权限');
  assert(hrManagerBlock.includes("'audit:view'"), 'HR主管缺少 audit:view');

  // 驻厂人员需要现场调岗、离职和保险办理，但不能包含操作日志、预支审批和工资管理权限
  const onsiteStart = seed.indexOf("SELECT 3, id FROM sys_permission");
  const onsiteEnd = seed.indexOf("SELECT 4, id FROM sys_permission");
  const onsiteBlock = seed.slice(onsiteStart, onsiteEnd);
  for (const permissionCode of ["'employee:transfer'", "'employee:resign'", "'social:manage'"]) {
    assert(onsiteBlock.includes(permissionCode), `驻厂人员初始化权限缺少：${permissionCode}`);
  }
  assert(!onsiteBlock.includes("'audit:view'"), '驻厂专员不应有 audit:view');
  assert(!onsiteBlock.includes("'advance:approve'"), '驻厂专员不应有 advance:approve');
  assert(!onsiteBlock.includes("'payroll:manage'"), '驻厂专员不应有 payroll:manage');

  // 薪资专员只能访问薪资和预支相关功能
  const payrollStart = seed.indexOf("SELECT 4, id FROM sys_permission");
  const payrollEnd = seed.indexOf("部门范围角色", payrollStart);
  const payrollBlock = seed.slice(payrollStart, payrollEnd > 0 ? payrollEnd : undefined);
  assert(payrollBlock.includes("'advance:view'"), '薪资专员缺少 advance:view');
  assert(payrollBlock.includes("'advance:approve'"), '薪资专员缺少 advance:approve');
  assert(payrollBlock.includes("'payroll:view'"), '薪资专员缺少 payroll:view');
  assert(payrollBlock.includes("'payroll:manage'"), '薪资专员缺少 payroll:manage');
  assert(!payrollBlock.includes("'system:role'"), '薪资专员不应有 system:role');
  assert(!payrollBlock.includes("'audit:view'"), '薪资专员不应有 audit:view');
}

console.log('role-catalog-tests-ok');
