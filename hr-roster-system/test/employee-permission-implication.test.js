const assert = require('node:assert/strict');
const authService = require('../src/services/auth.service');

assert.deepEqual(
  authService.normalizePermissions(['employee:create', 'employee:update']),
  ['employee:create', 'employee:update', 'employee:view'],
  '新增或编辑员工的历史账号必须自动具备员工查看权限'
);

assert.deepEqual(
  authService.normalizePermissions(['employee:sensitive:view']),
  ['employee:sensitive:view', 'employee:view'],
  '敏感员工查看权限不能绕过基础员工查看权限'
);

assert.deepEqual(
  authService.normalizePermissions(['payroll:view']),
  ['payroll:view'],
  '无员工管理权限的账号不应被动获得 employee:view'
);

assert.equal(authService.effectiveDataScope([
  { data_scope: 5 },
  { data_scope: 5 }
]), 5, '驻厂多角色账号仍使用项目授权范围');

console.log('employee-permission-implication-tests-ok');
