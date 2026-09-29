const fs = require('node:fs');
const assert = require('node:assert/strict');
const routes = fs.readFileSync('src/routes/daily-settlement.routes.js', 'utf8');
const index = fs.readFileSync('src/routes/index.js', 'utf8');
assert.match(routes, /router\.get\('\/wage-daily-settlements\/projects', requireAuth, requirePermission\('payroll:view'\), controller\.projects\)/);
for (const [method, path, permission] of [
  ['post', 'preview', 'payroll:manage'],
  ['get', '', 'payroll:view'],
  ['post', 'batch-confirm', 'payroll:manage'],
  ['post', ':id/revoke', 'payroll:manage'],
  ['get', ':id/events', 'payroll:view']
]) {
  const marker = `router.${method}('/wage-daily-settlements${path ? '/' + path : ''}'`;
  assert.ok(routes.includes(marker), `缺少 ${marker}`);
  assert.ok(routes.slice(routes.indexOf(marker), routes.indexOf(marker) + 180).includes(`requirePermission('${permission}')`));
}
assert.match(index, /router\.use\(dailySettlementRoutes\)/);
console.log('wage-daily-settlement-api-tests-ok');
