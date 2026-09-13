const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(
  path.join(root, 'wechat-miniprogram/miniprogram/pages/login/index.wxss'),
  'utf8'
);

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `缺少样式规则：${selector}`);
  return match[1];
}

function rpxValue(text, property) {
  const match = text.match(new RegExp(`${property}\\s*:\\s*(?:calc\\()?([0-9]+)rpx`));
  assert.ok(match, `${property} 必须使用可验证的 rpx 数值`);
  return Number(match[1]);
}

const page = rule('.login-page');
assert.match(page, /display\s*:\s*flex/, '登录页应使用纵向全屏布局填充可用高度');
assert.match(page, /flex-direction\s*:\s*column/, '登录页内容应纵向组织');
assert.ok(rpxValue(page, 'padding') <= 48, '登录页顶部留白不能超过48rpx');

const copy = rule('.login-copy');
assert.ok(rpxValue(copy, 'margin') <= 32, '品牌说明与登录卡片之间留白不能超过32rpx');

const card = rule('.login-card');
assert.match(card, /flex\s*:\s*1/, '登录卡片应填满剩余屏幕，避免底部大面积留白');
assert.match(card, /display\s*:\s*flex/, '登录卡片应使用弹性布局');
assert.match(card, /flex-direction\s*:\s*column/, '登录卡片内容应纵向组织');

const panels = rule('.employee-login-panel, .manager-login-panel');
assert.match(panels, /flex\s*:\s*1/, '员工和管理登录面板应共同适配屏幕剩余高度');

console.log('miniprogram-login-density-tests-ok');
