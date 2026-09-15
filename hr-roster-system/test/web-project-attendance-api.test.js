const fs = require('node:fs');
const assert = require('node:assert/strict');

const routes = fs.readFileSync('src/routes/attendance.routes.js', 'utf8');
const controller = fs.readFileSync('src/controllers/attendance.controller.js', 'utf8');

assert.match(routes, /get\('\/attendance\/projects', requireAuth, requirePermission\('attendance:view'\), controller\.projects\)/);
assert.match(routes, /get\('\/attendance\/projects\/:projectId\/settings', requireAuth, requirePermission\('attendance:view'\), controller\.projectSettings\)/);
assert.match(routes, /put\('\/attendance\/projects\/:projectId\/settings', requireAuth, requirePermission\('attendance:manage'\), controller\.saveProjectSettings\)/);
assert.match(routes, /get\('\/attendance\/projects\/:projectId\/exceptions', requireAuth, requirePermission\('attendance:view'\), controller\.projectExceptions\)/);
assert.match(routes, /put\('\/attendance\/projects\/:projectId\/exceptions', requireAuth, requirePermission\('attendance:manage'\), controller\.saveProjectException\)/);

assert.match(controller, /projectService\.listProjects\(req\.companyId, req\.user\)/);
assert.match(controller, /projectService\.getProjectSettings\(req\.companyId, req\.user, Number\(req\.params\.projectId\)\)/);
assert.match(controller, /projectService\.saveProjectSettings\(req\.companyId, req\.user, req\.operatorId, Number\(req\.params\.projectId\), req\.body\)/);
assert.match(controller, /projectService\.listCalendar\(req\.companyId, req\.user, Number\(req\.params\.projectId\), req\.query\.month\)/);
assert.match(controller, /projectService\.saveCalendarDay\(req\.companyId, req\.user, req\.operatorId, Number\(req\.params\.projectId\), req\.body\)/);

console.log('web-project-attendance-api.test.js: contract passed');
