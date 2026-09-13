const assert = require('node:assert/strict');
const fs = require('node:fs');

const auth = fs.readFileSync('wechat-miniprogram/miniprogram/utils/auth.js', 'utf8');
const login = fs.readFileSync('wechat-miniprogram/miniprogram/pages/login/index.js', 'utf8');
const payroll = fs.readFileSync('wechat-miniprogram/miniprogram/pages/payroll/index.js', 'utf8');

assert.match(auth, /PENDING_DESTINATION_KEY/);
assert.match(auth, /function setPendingDestination/);
assert.match(auth, /function consumePendingDestination/);
assert.match(auth, /ALLOWED_PENDING_DESTINATIONS\s*=\s*new Set\(\['\/pages\/payroll\/index'\]\)/);
assert.match(payroll, /setPendingDestination\('\/pages\/payroll\/index'\)/);
assert.match(login, /consumePendingDestination\(\)/);
assert.match(login, /wx\.switchTab\(\{ url: destination \}\)/);
assert.doesNotMatch(auth, /setPendingDestination\([^)]*(?:employeeId|payslipId|token)/i,
  '待跳转目标不得接收任何敏感业务参数');

console.log('miniprogram-payslip-url-link-tests-ok');
