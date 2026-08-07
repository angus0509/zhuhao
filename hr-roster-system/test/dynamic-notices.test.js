const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, text, message) => {
  if (!source.includes(text)) throw new Error(message);
};

const migration = read('sql/migrate-system-notices-20260804.mysql.sql');
assertIncludes(migration, 'CREATE TABLE IF NOT EXISTS hr_system_notice', '缺少动态通知迁移表');
assertIncludes(migration, 'employee_id BIGINT', '通知未关联员工，无法执行员工数据隔离');
assertIncludes(migration, 'project_id BIGINT', '通知未关联项目，无法执行项目数据隔离');
assertIncludes(migration, 'UNIQUE KEY uk_company_dedupe', '通知缺少业务幂等约束');

const noticeService = read('src/services/notice.service.js');
assertIncludes(noticeService, 'employeeScope(user, employeeParams', '员工通知未应用员工数据范围');
assertIncludes(noticeService, 'projectScope(user, projectParams', '项目通知未应用项目数据范围');
assertIncludes(noticeService, 'n.employee_id IS NULL AND n.project_id IS NULL', '缺少全公司通知范围');

const operationsRoutes = read('src/routes/operations.routes.js');
assertIncludes(operationsRoutes, "router.get('/notices'", '缺少动态通知查询接口');

const operationsService = read('src/services/operations.service.js');
assertIncludes(operationsService, 'advance-approved:', '预支审批未生成动态通知');
assertIncludes(operationsService, 'payroll-published:', '工资发布未生成动态通知');

const employeeService = read('src/services/employee.service.js');
for (const key of ['resign:', 'dedupeKey: `notice:${reminder.riskKey}`', 'contract:', 'insurance:']) {
  assertIncludes(employeeService, key, `员工核心流程未生成通知：${key}`);
}

const riskService = read('src/services/risk.service.js');
assertIncludes(riskService, '`risk:${risk.riskKey}`', '风险扫描未生成幂等通知');

const frontend = read('public/app.js');
assertIncludes(frontend, "api('/api/notices')", '办公首页仍未读取动态通知接口');
if (frontend.includes("title: '工资条发布必须执行复核'")) throw new Error('办公首页仍保留硬编码演示通知');

console.log('动态通知、数据隔离与核心业务触发检查通过。');
