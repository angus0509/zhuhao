const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const servicePath = path.resolve(__dirname, '../src/services/wechat-landing.service.js');
assert.ok(fs.existsSync(servicePath), '必须提供微信小程序短信中转页服务');

const { normalizeWechatUrlScheme, renderPayslipLandingPage } = require(servicePath);
const validScheme = 'weixin://dl/business/?t=exampleToken_123';

assert.equal(normalizeWechatUrlScheme(validScheme), validScheme);
assert.equal(normalizeWechatUrlScheme('https://example.com/'), '');
assert.equal(normalizeWechatUrlScheme('weixin://dl/business/?t=x&employeeId=88'), '',
  '小程序 Scheme 不得携带员工或工资条业务参数');

const html = renderPayslipLandingPage(validScheme);
assert.match(html, /优企云/);
assert.match(html, /打开优企云小程序/);
assert.match(html, /\/wx-payslip\.js/);
assert.match(html, /data-url-scheme="weixin:\/\/dl\/business\/\?t=exampleToken_123"/);
assert.doesNotMatch(html, /employeeId|payslipId|phone|token=/i,
  '中转页不得输出员工、工资条、手机号或登录凭证');
assert.throws(() => renderPayslipLandingPage('javascript:alert(1)'), /未配置/);

const appSource = fs.readFileSync(path.resolve(__dirname, '../src/app.js'), 'utf8');
assert.match(appSource, /app\.get\('\/wx\/payslip'/, '应用必须提供固定工资条小程序中转入口');

const clientPath = path.resolve(__dirname, '../public/wx-payslip.js');
assert.ok(fs.existsSync(clientPath), '中转页必须使用同源外部脚本，符合 CSP 要求');
const clientSource = fs.readFileSync(clientPath, 'utf8');
assert.match(clientSource, /data-url-scheme/);
assert.doesNotMatch(clientSource, /employeeId|payslipId|phone/i);

console.log('wechat-sms-landing-tests-ok');
