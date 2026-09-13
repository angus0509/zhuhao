const assert = require('node:assert/strict');

const {
  buildNavigationModel,
  getNavigationFallbackView
} = require('../public/js/core/navigation-groups');

const employeePermissions = ['office:menu', 'employee:menu', 'talent:menu', 'employee:view'];
const employeeNavigation = buildNavigationModel({
  activeView: 'talents',
  permissions: employeePermissions,
  isCompanyAdmin: false
});

assert.deepEqual(
  employeeNavigation.map(group => group.label),
  ['工作台', '人员管理'],
  'HR 人员权限不应看到薪资、风险或系统菜单'
);
assert.equal(employeeNavigation[1].active, true, '人才库页面应激活人员管理一级菜单');
assert.equal(employeeNavigation[1].activeView, 'talents', '人员管理应保留当前人才库子页面');
assert.deepEqual(
  employeeNavigation[1].items.map(item => item.view),
  ['roster', 'recruitmentSources', 'talents'],
  '人员管理必须包含花名册、招聘来源和人才库'
);
assert.equal(employeeNavigation.some(group => group.id === 'delivery'), false, '没有客户项目权限时不应显示空的客户与驻厂分组');

const payrollNavigation = buildNavigationModel({
  activeView: 'payroll',
  permissions: ['office:menu', 'employee:view', 'payroll:menu', 'payroll:view'],
  isCompanyAdmin: false
});
assert.deepEqual(
  payrollNavigation.map(group => group.label),
  ['工作台', '薪资结算'],
  '薪资专员只能看到工作台和薪资结算'
);

const menuOnlyNavigation = buildNavigationModel({
  activeView: 'risk',
  permissions: ['risk:menu'],
  isCompanyAdmin: false
});
assert.equal(menuOnlyNavigation.some(group => group.items.some(item => item.view === 'risk')), false,
  '只有风险菜单权限、没有 risk:view 时不应显示打不开的风险页面');

const viewWithoutMenuNavigation = buildNavigationModel({
  activeView: 'advances',
  permissions: ['advance:view'],
  isCompanyAdmin: false
});
assert.equal(viewWithoutMenuNavigation.some(group => group.items.some(item => item.view === 'advances')), false,
  '只有查看权限、没有菜单权限时不应绕过菜单配置显示页面');
assert.deepEqual(
  payrollNavigation[1].items.map(item => item.view),
  ['payroll'],
  '没有预支权限时薪资结算不得展示预支记录'
);

const adminNavigation = buildNavigationModel({
  activeView: 'audit',
  permissions: [],
  isCompanyAdmin: true
});
assert.equal(adminNavigation.length, 6, '企业管理员应看到六个一级菜单');
assert.deepEqual(adminNavigation.find(group => group.id === 'delivery').items.map(item => item.view), ['projects'], '企业管理员的客户与驻厂分组只保留客户项目');
assert.equal(adminNavigation.find(group => group.id === 'system').active, true, '操作日志应归入系统设置');
assert.equal(getNavigationFallbackView(adminNavigation), 'office', '默认入口必须为工作台');

console.log('web-navigation-groups-tests-ok');
