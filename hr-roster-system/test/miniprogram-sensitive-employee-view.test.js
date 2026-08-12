const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.js');
const wxml = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml');

assert.match(js, /employee:sensitive:view/, '完整证件信息必须受独立权限控制');
assert.match(js, /wx\.showModal/, '查看完整敏感信息前必须二次确认');
assert.match(js, /showSensitive=1/, '确认后应按需请求完整字段');
assert.match(js, /reason=/, '敏感字段查看请求必须带审计原因');
assert.match(js, /onHide\(\)[\s\S]*clearSensitive/, '页面隐藏时必须清除明文敏感字段');
assert.match(wxml, /身份证号码/, '详情页应展示身份证字段');
assert.match(wxml, /银行卡号/, '详情页应展示银行卡字段');

console.log('miniprogram-sensitive-employee-view-tests-ok');
