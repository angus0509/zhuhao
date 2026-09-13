const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const markup = fs.readFileSync(
  path.join(root, 'wechat-miniprogram/miniprogram/pages/login/index.wxml'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(root, 'wechat-miniprogram/miniprogram/pages/login/index.wxss'),
  'utf8'
);
const logic = fs.readFileSync(
  path.join(root, 'wechat-miniprogram/miniprogram/pages/login/index.js'),
  'utf8'
);

assert.match(markup, /class="employee-login-hero"/, '员工登录需要独立的首屏引导区');
assert.match(markup, /class="login-mode-hint"/, '登录模式需要明确的当前身份提示');
assert.match(markup, /class="sms-login-box sms-login-primary"/, '验证码登录需要作为首屏主入口');
assert.doesNotMatch(markup, /wx:if="\{\{smsExpanded\}\}" class="sms-login-box/, '验证码登录不能默认折叠');
assert.match(markup, /class="quick-login-section"/, '手机号快捷登录需要保留为辅助入口');
assert.match(markup, /快捷登录手机号须与入职档案填写的手机号码一致/, '快捷登录必须提示使用入职档案手机号');
const quickIndex = markup.indexOf('手机号快捷登录');
const smsIndex = markup.indexOf('手机号验证码登录');
const bindIndex = markup.indexOf('使用一次性绑定码');
assert.ok(quickIndex > 0 && quickIndex < smsIndex, '手机号快捷登录必须位于验证码登录之前');
assert.ok(smsIndex < bindIndex, '一次性绑定码必须位于员工登录区域最底层');
assert.match(markup, /class="login-trust-row"/, '登录页需要展示隐私与安全承诺');
assert.doesNotMatch(logic, /smsExpanded|toggleSmsLogin/, '验证码作为主入口后不应保留折叠状态');
assert.match(css, /\.employee-login-hero\s*\{[^}]*display\s*:\s*flex/s, '员工首屏引导区需要使用弹性布局');
assert.match(css, /\.sms-login-primary\s*\{[^}]*border/s, '验证码主入口需要明确的视觉边界');
assert.match(css, /\.login-trust-row\s*\{[^}]*display\s*:\s*flex/s, '安全承诺区域需要横向排列');

console.log('miniprogram-employee-login-redesign-tests-ok');
