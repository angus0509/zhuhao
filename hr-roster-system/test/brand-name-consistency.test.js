const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const webHtml = read('public/index.html');
const webInteraction = read('public/interaction-polish.js');
const employeeService = read('src/services/employee.service.js');
const miniApp = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));
const miniEnv = read('wechat-miniprogram/miniprogram/config/env.js');
const miniLogin = read('wechat-miniprogram/miniprogram/pages/login/index.wxml');

assert.match(webHtml, /<title>优企云数字化管理系统<\/title>/, '网页标题未使用正式品牌名称');
assert.equal((webHtml.match(/优企云数字化管理系统/g) || []).length >= 4, true, '网页核心品牌位置未统一');
assert.doesNotMatch(webHtml, /优益数字化管理系统|优益企服云|劳务运营全生命周期/, '网页仍显示旧品牌或旧副标题');
assert.match(webInteraction, /优企云数字化管理系统/, '网页动态页面上下文未使用新品牌');
assert.doesNotMatch(webInteraction, /优益数字化管理系统|劳务运营全生命周期/, '网页动态文案仍使用旧品牌');
assert.match(employeeService, /workbook\.creator = '优企云数字化管理系统'/, 'Excel 导出元数据未同步品牌');

assert.equal(miniApp.window.navigationBarTitleText, '优企云', '小程序导航标题未使用短品牌名称');
assert.match(miniEnv, /APP_NAME: '优企云'/, '小程序运行配置未使用短品牌名称');
assert.match(miniLogin, /class="brand-name">优企云<\/text>/, '小程序登录页未使用短品牌名称');
assert.doesNotMatch(miniLogin, /优益数字化管理系统|优益企服云/, '小程序登录页仍显示旧品牌');

console.log('brand-name-consistency-tests-ok');
