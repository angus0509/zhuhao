const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tabJs = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.js');
const syncUtil = read('wechat-miniprogram/miniprogram/utils/tab-bar.js');

assert.match(tabJs, /switching:\s*false/, '底部菜单缺少切换锁初始状态');
assert.match(tabJs, /success:\s*\(\)\s*=>\s*this\.setData\(\{\s*switching:\s*false\s*\}\)/, '切换成功后未释放菜单锁');
assert.match(syncUtil, /page\.getTabBar\(\)/, '页面显示时未取得当前自定义菜单实例');
assert.match(syncUtil, /tabBar\.setData\(\{\s*selected,\s*switching:\s*false\s*\}\)/, '页面显示时未校正当前菜单状态');

const pages = [
  ['home/index.js', 0],
  ['employees/index.js', 1],
  ['advances/index.js', 2],
  ['payroll/index.js', 3],
  ['profile/index.js', 4]
];

for (const [file, index] of pages) {
  const source = read(`wechat-miniprogram/miniprogram/pages/${file}`);
  assert.match(source, /require\(['"]\.\.\/\.\.\/utils\/tab-bar['"]\)/, `${file} 未接入菜单同步工具`);
  assert.match(source, new RegExp(`onShow\\(\\) \\{\\s*syncTabBar\\(this, ${index}\\);`), `${file} 未在显示时立即同步正确菜单序号`);
}

console.log('miniprogram-tabbar-follow-tests-ok');
