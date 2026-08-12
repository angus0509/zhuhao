const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('wechat-miniprogram/miniprogram/pages/home/index.js');
const wxml = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
const onsiteWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const onsiteWxss = read('wechat-miniprogram/miniprogram/pages/employees/index.wxss');
const onsiteJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');

assert.match(js, /onsite_customer_id/, '工作台应读取驻厂页共享的当前客户');
assert.match(js, /employees\/onsite-overview/, '工作台客户统计必须复用已隔离的驻厂概览接口');
assert.match(js, /customerChanged/, '工作台返回时应识别驻厂客户切换并跳过旧缓存');
assert.match(onsiteJs, /markDirty\('home'\)/, '驻厂切换客户后必须标记工作台数据已变化');
assert.match(wxml, /当前驻厂客户/, '工作台应明确显示当前驻厂客户');
assert.match(wxml, /待到岗/, '工作台与驻厂页应统一使用“待到岗”');
assert.match(onsiteWxml, /page-title[^>]*>驻厂管理</, '驻厂页面标题缺失');
assert.match(onsiteWxss, /\.onsite-page \.page-title\s*\{[^}]*white-space:\s*nowrap/s, '驻厂管理四字必须保持单行对齐');

console.log('miniprogram-workbench-onsite-link-tests-ok');
