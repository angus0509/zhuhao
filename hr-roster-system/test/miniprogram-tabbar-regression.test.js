const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.js');
const wxml = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxml');
const wxss = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxss');

assert.match(js, /text:\s*'驻厂'/, '底部菜单应使用短名称“驻厂”');
assert.match(js, /this\.setData\(\{\s*selected:\s*index,\s*switching:\s*true\s*\}\)/, '点击菜单后应立即显示目标页选中态');
assert.match(js, /fail:\s*\(\)\s*=>\s*this\.setData\(\{\s*selected:\s*previous,\s*switching:\s*false\s*\}\)/, '页面切换失败后应恢复原菜单状态');
assert.match(js, /this\.data\.switching/, '菜单切换中应拦截重复点击');
assert.match(js, /index === this\.data\.selected\) return/, '重复点击当前菜单应直接返回');
assert.doesNotMatch(wxml, /active-rail/, '旧版简洁菜单不应保留顶部动态轨道');
assert.doesNotMatch(wxss, /\.tab-item\.active\s*\{[^}]*background:/s, '选中菜单不应显示整块颜色背景');
assert.doesNotMatch(wxss, /\.tab-item(?::active|\.pressed)/, '菜单点击不应增加按压颜色');

console.log('miniprogram-tabbar-regression-tests-ok');
