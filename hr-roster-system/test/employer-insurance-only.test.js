const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('public/index.html');
const app = read('public/app.js');
const router = read('public/js/core/router.js');
const roster = read('public/js/views/roster.js');
const dashboard = read('public/js/views/dashboard.js');
const employeeService = read('src/services/employee.service.js');
const riskService = read('src/services/risk.service.js');
const portalService = read('src/services/portal.service.js');
const apiSmoke = read('test/api-smoke.js');

assert.ok(!index.includes('data-view="insurance"'), 'Web 仍显示保险提示菜单');
assert.ok(!index.includes('id="insuranceView"'), 'Web 仍保留保险提示独立页面');
assert.ok(index.includes('name="employerInsuranceAction"'), 'Web 缺少雇主险增减选项');
assert.ok(index.includes('<option value="ADD">增保</option>'), 'Web 缺少雇主险增保选项');
assert.ok(index.includes('<option value="REMOVE">减保</option>'), 'Web 缺少雇主险减保选项');
assert.ok(!index.includes('name="socialStatus"'), 'Web 合规表单仍允许修改社保');
assert.ok(!index.includes('name="fundStatus"'), 'Web 合规表单仍允许修改公积金');
assert.ok(!router.includes("insurance: '#insuranceView'"), '路由仍注册保险提示页面');
assert.ok(!app.includes('async function loadInsurance('), '前端仍加载保险提示台账');
assert.ok(roster.includes('Number(row.employerInsuranceStatus) !== 1'), '花名册缺口未仅按雇主险计算');
assert.ok(dashboard.includes('compliance.employerInsuranceRate'), '驾驶舱合规率未切换为雇主险');
assert.ok(employeeService.includes("employerInsuranceAction === 'ADD' ? 1 : 2"), '后端未将增减动作映射为雇主险状态');
assert.ok(employeeService.includes("'雇主险','employer_insurance'"), '雇主险增减未记录独立审计日志');
assert.ok(employeeService.includes('const insuranceDone = Number(row.employer_insurance_status || 0) !== 1;'), '离职闭环仍依赖已取消的社保状态');
assert.ok(!riskService.includes('async function scanSocialSecurity('), '风险扫描仍生成社保异常');
assert.ok(riskService.includes('r.risk_type IN (1,7)'), '风险中心未限制为合同和雇主险两项');
assert.ok(riskService.includes('s.employer_end_date IS NOT NULL AND s.employer_end_date<:current'), '雇主险有效性判断未按实际失效日期处理');
assert.ok(portalService.includes('employerInsuranceRate'), '后端合规指标未切换为雇主险');
assert.ok(!apiSmoke.includes("'/insurance/overview'"), '生产只读 smoke 仍访问已下线的保险提示接口');
assert.ok(employeeService.includes("addWorksheet('雇主险信息')"), 'Excel 导出未切换为雇主险信息');

console.log('employer-insurance-only-tests-ok');
