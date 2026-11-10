const assert = require('node:assert/strict');
const controller = require('../src/controllers/employee.controller');
const router = require('../src/routes/employee.routes');

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

console.log('employer-insurance-module-removal-route-tests-ok');
