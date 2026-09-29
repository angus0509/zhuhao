const assert = require('node:assert/strict');
const fs = require('node:fs');
const db = require('../src/db');
const { requirePermission } = require('../src/middlewares/auth.middleware');
const settlement = require('../src/services/daily-settlement.service');

function permissionResult(permission, permissions) {
  return new Promise(resolve => requirePermission(permission)({
    user: { accountType: 'MANAGER', permissions }
  }, {}, error => resolve(error || null)));
}

async function run() {
  assert.equal((await permissionResult('payroll:view', ['attendance:view']))?.statusCode, 403);
  assert.equal((await permissionResult('payroll:manage', ['payroll:view']))?.statusCode, 403);
  assert.equal(await permissionResult('payroll:view', ['payroll:view']), null);

  const route = fs.readFileSync('src/routes/daily-settlement.routes.js', 'utf8');
  assert.match(route, /router\.get\('\/wage-daily-settlements', requireAuth, requirePermission\('payroll:view'\)/);
  assert.match(route, /router\.post\('\/wage-daily-settlements\/batch-confirm', batchLimiter, requireAuth, requirePermission\('payroll:manage'\)/);

  const originalQuery = db.query;
  const queries = [];
  try {
    db.query = async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM labor_project p/.test(sql) && /LEFT JOIN wage_calculation_runs/.test(sql)) return [];
      if (/FROM labor_project p/.test(sql)) return [{ projectId: 12, projectName: '一厂项目', customerId: 7, customerName: '客户A' }];
      return [];
    };
    const scopedUser = { id: 9, companyId: 3, dataScope: 5, permissions: ['payroll:view'] };
    await settlement.listProjects(3, scopedUser);
    assert.match(queries[0].sql, /sys_user_project/);
    assert.equal(queries[0].params.scopeUserId, 9);
    await assert.rejects(
      settlement.listDailySettlements(3, scopedUser, { projectId: 13, shiftDate: '2026-09-29' }),
      error => error.businessCode === 'PROJECT_FORBIDDEN'
    );
    assert.match(queries[1].sql, /sys_user_project/);
    assert.equal(queries[1].params.projectId, 13);
  } finally { db.query = originalQuery; }
}

run().then(() => console.log('attendance-payroll-permission-isolation-tests-ok')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
