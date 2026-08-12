const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));
const wxss = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxss');
const js = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.js');

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const defaultColor = escapeRegExp(app.tabBar.color);
const selectedColor = escapeRegExp(app.tabBar.selectedColor);

assert.match(
  wxss,
  new RegExp(`\\.tab-item\\s*\\{[^}]*color:\\s*${defaultColor}`, 's'),
  '自定义菜单普通色必须与 app.json 保持一致'
);
assert.match(
  wxss,
  new RegExp(`\\.tab-item\\.active\\s*\\{[^}]*color:\\s*${selectedColor}`, 's'),
  '自定义菜单选中色必须与 app.json 保持一致'
);
assert.match(
  wxss,
  new RegExp(`\\.tab-item\\.active \\.tab-mark\\s*\\{[^}]*color:\\s*${selectedColor}`, 's'),
  '当前页圆形标记色必须与菜单选中色保持一致'
);
assert.doesNotMatch(wxss, /\.tab-item\.active\s*\{[^}]*background:/s, '选中菜单不应整块变色');
assert.doesNotMatch(wxss, /\.tab-item(?::active|\.pressed)/, '菜单不应出现按压颜色');
assert.match(js, /this\.setData\(\{\s*selected:\s*index,\s*switching:\s*true\s*\}\)/, '点击后应立即同步菜单选中色');

console.log('miniprogram-tabbar-color-alignment-tests-ok');
