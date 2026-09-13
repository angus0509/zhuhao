const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('sql/migrate-payslip-view-policy-20260820.mysql.sql');
const schema = read('sql/schema.mysql.sql');
const payslipService = read('src/services/payslip.service.js');
const operationsService = read('src/services/operations.service.js');
const operationsRoutes = read('src/routes/operations.routes.js');
const html = read('public/index.html');
const app = read('public/app.js');

for (const field of ['employee_view_enabled', 'view_once', 'view_expires_minutes']) {
  assert.match(schema, new RegExp(`${field}`), `工资批次缺少员工查看策略字段：${field}`);
  assert.match(migration, new RegExp(`ADD COLUMN[^;]*${field}`), `迁移缺少字段：${field}`);
}
assert.match(payslipService, /view_once viewOnce/);
assert.match(payslipService, /view_expires_minutes viewExpiresMinutes/);
assert.match(payslipService, /阅后即焚|VIEW_ONCE|viewOnce/);
assert.match(payslipService, /employee_view_enabled/);
assert.match(operationsService, /viewOnce/);
assert.match(operationsService, /viewExpiresMinutes/);
assert.match(operationsRoutes, /view-policy/);
assert.match(html, /员工端查看权限/);
assert.match(html, /阅后即焚/);
assert.match(app, /employeeViewEnabled/);
assert.match(app, /viewOnce/);
assert.match(app, /viewExpiresMinutes/);

console.log('payroll-view-policy-tests-ok');
