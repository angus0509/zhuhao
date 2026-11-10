const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db');
const controller = require('../src/controllers/employee.controller');
const router = require('../src/routes/employee.routes');
const operationsService = require('../src/services/operations.service');
const portalService = require('../src/services/portal.service');
const riskService = require('../src/services/risk.service');
const workTaskService = require('../src/services/work-task.service');
const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const miniSources = [
  'pages/employees/index.js',
  'pages/employees/index.wxml',
  'pages/employees/detail/index.js',
  'pages/employees/detail/index.wxml',
  'pages/employees/contract/index.js',
  'pages/employees/compliance/index.js',
  'pages/employees/compliance/index.json',
  'pages/employees/compliance/index.wxml'
].map(file => fs.readFileSync(path.join(miniRoot, file), 'utf8')).join('\n');

assert.equal(fs.existsSync(path.join(miniRoot, 'pages/employees/insurance/index.js')), false, '小程序雇主险页面仍存在');
assert.doesNotMatch(miniSources, /employees\/insurance|employerInsurance|insuranceComplete|insuranceGapCount|social:manage|雇主险/, '小程序仍保留雇主险字段、权限或入口');

const disableMigration = fs.readFileSync(path.join(root, 'sql/migrate-disable-employer-insurance-module-20261110.mysql.sql'), 'utf8');
assert.match(disableMigration, /permission_code\s*=\s*'social:manage'/i, '停用迁移未锁定雇主险权限');
assert.match(disableMigration, /task_type\s+IN\s*\('INSURANCE',\s*'INSURANCE_TERMINATION',\s*'ONBOARDING_COMPLIANCE'\)/i, '停用迁移未关闭历史开放事项');
assert.match(disableMigration, /risk_type\s*=\s*7/i, '停用迁移未关闭历史开放风险');
assert.doesNotMatch(disableMigration, /\b(?:DELETE|DROP|TRUNCATE)\b|employer_insurance_status\s*=/i, '停用迁移会删除或改写历史数据');

const disabledRoutes = [
  '/employees/:id/onboarding-compliance/confirm',
  '/employees/:id/contracts',
  '/employees/:id/social-security'
];
const forbiddenHandlers = new Set([
  controller.confirmOnboardingCompliance,
  controller.createContract,
  controller.updateSocialSecurity
].filter(Boolean));

for (const routePath of disabledRoutes) {
  const layer = router.stack.find(item => item.route?.path === routePath);
  assert.ok(layer, `旧接口必须保留兼容路由：${routePath}`);
  const handlers = layer.route.stack.map(item => item.handle);
  assert.equal(handlers.some(handler => forbiddenHandlers.has(handler)), false, `${routePath} 不得绑定业务控制器`);

  let statusCode = 0;
  let payload = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return body; }
  };
  handlers.at(-1)({}, res);
  assert.equal(statusCode, 410, `${routePath} 必须返回 HTTP 410`);
  assert.deepEqual(payload, { code: 410, message: '雇主险功能已停用', data: null });
}

function assertNoEmployerInsurance(value, label) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /employerInsurance|insuranceGapCount|uninsuredCount|pendingInsurance|雇主险/,
    `${label} 仍返回雇主险字段`
  );
}

async function main() {
  const originalFirst = db.first;
  const originalQuery = db.query;
  const sqlCalls = [];
  db.first = async sql => {
    sqlCalls.push(sql);
    if (/FROM hr_work_task t/.test(sql)) {
      return /t\.task_type IN \('ARRIVAL','OFFBOARD','DOCUMENT','TRANSFER_ACCEPTANCE'\)/.test(sql)
        ? null
        : { id: 99, task_type: 'INSURANCE', task_status: 0, risk_level: 1 };
    }
    return {};
  };
  db.query = async sql => {
    sqlCalls.push(sql);
    return [];
  };

  try {
    const user = { id: 7, companyId: 1, dataScope: 1, permissions: [] };
    const projects = await operationsService.listProjects(1, { page: 1, pageSize: 20 }, user);
    const home = await operationsService.operationsHome(1, user);
    const dashboard = await portalService.dashboard(1, user);
    const risks = await riskService.listRisks(1, user);
    const tasks = await workTaskService.listTasks(1, {}, user);
    await assert.rejects(
      workTaskService.startTask(1, 99, 7, user),
      /待办不存在或无项目权限/,
      '旧雇主险待办仍可通过直接 ID 开始处理'
    );

    assertNoEmployerInsurance(projects, '项目列表');
    assertNoEmployerInsurance(home, '运营首页');
    assertNoEmployerInsurance(dashboard, '驾驶舱');
    assertNoEmployerInsurance(risks, '风险列表');
    assertNoEmployerInsurance(tasks, '待办列表');
    assert.doesNotMatch(
      sqlCalls.join('\n'),
      /employer_insurance|INSURANCE_TERMINATION|task_type\s*=\s*'INSURANCE'/,
      '服务端仍查询雇主险字段或待办类型'
    );
    assert.equal('INSURANCE' in workTaskService.TASK_TYPE_NAMES, false);
    assert.equal('INSURANCE_TERMINATION' in workTaskService.TASK_TYPE_NAMES, false);
  } finally {
    db.first = originalFirst;
    db.query = originalQuery;
  }

  console.log('employer-insurance-module-removal-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
