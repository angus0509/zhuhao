const fs = require('node:fs');
const assert = require('node:assert/strict');

const routes = fs.readFileSync('src/routes/attendance.routes.js', 'utf8');
const controller = fs.readFileSync('src/controllers/attendance.controller.js', 'utf8');

assert.match(routes, /router\.get\('\/attendance\/workbench', requireAuth, requirePermission\('attendance:view'\), controller\.workbench\)/);
assert.match(routes, /router\.post\('\/attendance\/daily-close', sensitiveLimiter, requireAuth, requirePermission\('attendance:review'\), controller\.confirmDailyClosure\)/);
assert.match(routes, /router\.put\('\/attendance\/daily-results\/:id\/review', sensitiveLimiter, requireAuth, requirePermission\('attendance:review'\), controller\.reviewDailyException\)/);
assert.match(routes, /router\.post\('\/attendance\/daily-reopen', sensitiveLimiter, requireAuth, requirePermission\('attendance:review'\), controller\.reopenDailyClosure\)/);

assert.match(controller, /workbenchService\.getWorkbench\(req\.companyId, req\.user, req\.query\)/);
assert.match(controller, /closureService\.confirmDailyClosure\(req\.companyId, req\.user, req\.operatorId, req\.body\)/);
assert.match(controller, /closureService\.reviewDailyException\(req\.companyId, req\.user, req\.operatorId, Number\(req\.params\.id\), req\.body\)/);
assert.match(controller, /closureService\.reopenDailyClosure\(req\.companyId, req\.user, req\.operatorId, req\.body\)/);

console.log('attendance-workbench-api-tests-ok');
