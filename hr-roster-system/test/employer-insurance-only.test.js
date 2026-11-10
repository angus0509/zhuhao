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
assert.ok(!index.includes('name="employerInsuranceAction"'), 'Web 仍保留已取消的雇主险增减表单');
assert.ok(!index.includes('name="socialStatus"'), 'Web 合规表单仍允许修改社保');
assert.ok(!index.includes('name="fundStatus"'), 'Web 合规表单仍允许修改公积金');
assert.ok(!router.includes("insurance: '#insuranceView'"), '路由仍注册保险提示页面');
assert.ok(!app.includes('async function loadInsurance('), '前端仍加载保险提示台账');
assert.doesNotMatch(roster, /雇主险|employerInsurance|insuranceGapCount/, '花名册仍读取或展示雇主险');
assert.ok(!dashboard.includes('renderCompliance('), '驾驶舱仍渲染已取消的合规面板');
assert.doesNotMatch(employeeService, /employerInsuranceAction ===|const insuranceDone = true|addWorksheet\('雇主险信息'\)/, '员工服务仍执行雇主险写入、离职阻塞或导出');
assert.ok(!riskService.includes('async function scanSocialSecurity('), '风险扫描仍生成社保异常');
assert.doesNotMatch(riskService, /scanEmployerInsurance|employer_end_date|employer_insurance_status/, '风险扫描仍读取雇主险台账');
assert.doesNotMatch(portalService, /employerInsuranceRate|employerInsuranceCount|uninsuredCount/, '驾驶舱仍返回雇主险指标');
assert.ok(!apiSmoke.includes("'/insurance/overview'"), '生产只读 smoke 仍访问已下线的保险提示接口');

console.log('employer-insurance-retirement-tests-ok');
