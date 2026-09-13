const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('wechat-miniprogram/miniprogram/pages/login/index.js', 'utf8');
const wxml = fs.readFileSync('wechat-miniprogram/miniprogram/pages/login/index.wxml', 'utf8');
const wxss = fs.readFileSync('wechat-miniprogram/miniprogram/pages/login/index.wxss', 'utf8');

assert.match(wxml, /手机号验证码登录/);
assert.match(wxml, /bindinput="onSmsPhone"/);
assert.match(wxml, /bindinput="onSmsCode"/);
assert.match(wxml, /bindtap="requestSmsCode"/);
assert.match(wxml, /bindtap="submitSmsLogin"/);
assert.match(js, /\/auth\/employee\/sms-code/);
assert.match(js, /\/auth\/employee\/sms-login/);
assert.match(js, /\^1\\d\{10\}\$/);
assert.match(js, /\^\\d\{6\}\$/);
assert.match(js, /smsCountdown/);
assert.match(js, /if \(this\.data\.smsSending\) return/);
assert.match(js, /if \(this\.data\.smsLoggingIn\) return/);
assert.match(js, /clearInterval\(this\._smsTimer\)/);
assert.match(js, /登记号码错误，请联系驻厂！/);
assert.match(js, /EMPLOYEE_PHONE_NOT_REGISTERED/);
assert.doesNotMatch(wxml, /手机号不存在|未找到员工/);
assert.match(wxss, /\.sms-login-box/);

console.log('miniprogram-employee-sms-login-tests-ok');
