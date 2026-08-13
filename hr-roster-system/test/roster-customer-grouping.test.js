const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const state = fs.readFileSync(path.join(root, 'public/js/core/state.js'), 'utf8');
const roster = fs.readFileSync(path.join(root, 'public/js/views/roster.js'), 'utf8');
const employeeService = fs.readFileSync(path.join(root, 'src/services/employee.service.js'), 'utf8');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram/pages/employees');

if (!page.includes('id="customerRosterRail"') || !page.includes('data-roster-mode="grouped"')) throw new Error('Web花名册缺少客户分类轨道或分组切换');
if (!state.includes("rosterViewMode: 'grouped'") || !roster.includes('customer-group-row')) throw new Error('Web花名册未默认按客户分组');
if (!roster.includes('insuranceGap') || !roster.includes('riskCount')) throw new Error('客户分组缺少保险或风险指标');
if (!employeeService.includes('applyDataScope(where, params')) throw new Error('员工列表数据隔离逻辑被移除');
// Web发布包不包含小程序源码；仅在源码仓库内校验小程序客户分类。
if (fs.existsSync(miniRoot)) {
  const miniJs = fs.readFileSync(path.join(miniRoot, 'index.js'), 'utf8');
  const miniWxml = fs.readFileSync(path.join(miniRoot, 'index.wxml'), 'utf8');
  if (!miniJs.includes('insuranceGapCount') || !miniJs.includes('activeCount')) throw new Error('小程序客户分类缺少运营指标');
  if (!miniWxml.includes('onCustomerChange') || !miniWxml.includes('site-status-grid')) throw new Error('小程序当前客户驾驶舱缺少客户切换或生命周期状态');
  if (miniWxml.includes('filterByInsurance')) throw new Error('驻厂主页面不应恢复已取消的独立雇主险筛选');
}

console.log('roster-customer-grouping-tests-ok');
