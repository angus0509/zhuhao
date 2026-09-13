const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const appJson = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));
const tabJs = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.js');
const tabWxml = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxml');
const tabWxss = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxss');
const onsiteWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const onsiteWxss = read('wechat-miniprogram/miniprogram/pages/employees/index.wxss');

if (appJson.tabBar.custom !== true) throw new Error('小程序未启用自定义底部菜单');
if ((appJson.tabBar.list || []).length !== 5) throw new Error('底部菜单数量不正确');
for (const marker of ['getCurrentPages()', 'wx.switchTab', 'syncSelected']) {
  if (!tabJs.includes(marker)) throw new Error(`自定义底部菜单缺少逻辑：${marker}`);
}
for (const label of ['工作台', '驻厂', '预支', '工资条', '我的']) {
  if (!tabWxml.includes(label) && !tabJs.includes(label)) throw new Error(`底部菜单缺少：${label}`);
}
if (!tabWxml.includes('tab-count-{{list.length}}')) throw new Error('底部菜单未按实际菜单数量自动等分');
if (!tabWxss.includes('.tab-count-3') || !tabWxss.includes('.tab-count-5')) throw new Error('底部菜单缺少员工端三栏和管理端五栏布局');
for (const marker of ['aria-role="tab"', 'aria-selected="{{selected === index}}"', 'aria-label="{{item.text}}"']) {
  if (!tabWxml.includes(marker)) throw new Error(`底部菜单缺少无障碍状态：${marker}`);
}
if (!/\.tab-label\s*\{[^}]*font-size:\s*(2[6-9]|[3-9][0-9])rpx/s.test(tabWxss)) throw new Error('底部菜单文字需保持清晰可读');
if (!tabWxss.includes('.tab-item.active')) throw new Error('底部菜单缺少稳定的当前页标识');
if (/\.tab-item\.active\s*\{[^}]*background:/s.test(tabWxss)) throw new Error('底部菜单不应使用整块选中背景');
if (!onsiteWxml.includes('onsite-page') || !onsiteWxml.includes('tab-page')) throw new Error('驻厂页未启用专属大字布局和底部安全间距');
for (const marker of ['.onsite-page .page-title', '.onsite-page .employee-primary text', '.onsite-page .customer-switch-button']) {
  if (!onsiteWxss.includes(marker)) throw new Error(`驻厂页字体布局缺少：${marker}`);
}

console.log('miniprogram-custom-tabbar-tests-ok');
