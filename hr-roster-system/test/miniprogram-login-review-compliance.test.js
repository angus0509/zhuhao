const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const loginSurfaceFiles = [
  'wechat-miniprogram/miniprogram/pages/login/index.wxml',
  'wechat-miniprogram/miniprogram/pages/login/index.js',
  'wechat-miniprogram/miniprogram/pages/login/index.wxss',
  'wechat-miniprogram/miniprogram/pages/employee-bind/index.wxml',
  'wechat-miniprogram/miniprogram/pages/employee-bind/index.js',
  'wechat-miniprogram/miniprogram/pages/employee-bind/index.wxss'
];

const sources = loginSurfaceFiles.map(relativePath => ({
  relativePath,
  source: fs.readFileSync(path.join(root, relativePath), 'utf8')
}));

for (const { relativePath, source } of sources) {
  assert.doesNotMatch(
    source,
    /微信|官方(?:登录|授权)|weixin-logo|wx-logo|wechat-logo/i,
    `${relativePath} 的登录前置内容不得使用微信官方字样或近似官方元素`
  );
}

const loginMarkup = sources.find(item => item.relativePath.endsWith('pages/login/index.wxml')).source;
assert.match(loginMarkup, />手机号快捷登录<\/button>/, '员工登录主按钮应明确显示“手机号快捷登录”');
assert.match(loginMarkup, /验证手机号后匹配本人员工档案/, '登录说明应使用中性的手机号验证文案');

console.log('miniprogram-login-review-compliance-tests-ok');
