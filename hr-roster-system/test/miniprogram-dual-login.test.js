const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const loginJs = read('wechat-miniprogram/miniprogram/pages/login/index.js');
const loginWxml = read('wechat-miniprogram/miniprogram/pages/login/index.wxml');
const requestJs = read('wechat-miniprogram/miniprogram/utils/request.js');
const appJson = JSON.parse(read('wechat-miniprogram/miniprogram/app.json'));

assert.match(loginWxml, /员工登录/);
assert.match(loginWxml, /管理端登录/);
assert.match(loginWxml, /open-type="getPhoneNumber"/);
assert.match(
  loginWxml,
  /<button(?=[^>]*bindtap="onEmployeeWechatLogin")(?![^>]*open-type="getPhoneNumber")[^>]*>/,
  '员工首次动作应先尝试微信快捷登录，已绑定员工不能重复授权手机号'
);
assert.match(
  loginWxml,
  /<button(?=[^>]*bindtap="onEmployeeBindCode")(?![^>]*open-type="getPhoneNumber")[^>]*>/,
  '一次性绑定码入口不能依赖微信手机号授权'
);
assert.match(loginJs, /wx\.login/);
assert.match(loginJs, /\/auth\/employee\/wechat-login/);
assert.match(loginJs, /async onEmployeeWechatLogin\(\)/);
assert.match(
  loginJs,
  /data:\s*\{\s*companyId:\s*COMPANY_ID,\s*loginCode\s*\}/,
  '微信快捷登录应只提交 loginCode 查询现有绑定'
);
assert.match(loginJs, /employeeStep:\s*'phone'/);
assert.match(loginJs, /error\.businessCode\s*===\s*'EMPLOYEE_PHONE_AUTH_REQUIRED'/,
  '首次绑定必须按稳定业务错误码进入手机号授权');
assert.doesNotMatch(loginJs, /message\.includes\(['"]手机号授权['"]\)/,
  '不能依赖可变的中文错误文案切换登录步骤');
assert.match(requestJs, /error\.businessCode\s*=\s*payload\.businessCode/,
  '请求层必须保留后端业务错误码');
assert.match(loginJs, /accountType === 'EMPLOYEE'/);
assert.match(loginJs, /pages\/home\/index/);
assert.match(loginJs, /employeeLoading/);
assert.match(loginJs, /if \(this\.data\.employeeLoading\) return/);
assert.match(loginJs, /submitManagerLogin/);
assert.match(loginJs, /\/auth\/login/);

assert.ok(
  appJson.pages.includes('pages/employee-bind/index'),
  'app.json 必须注册员工首次绑定页'
);

const bindJs = read('wechat-miniprogram/miniprogram/pages/employee-bind/index.js');
const bindWxml = read('wechat-miniprogram/miniprogram/pages/employee-bind/index.wxml');
assert.match(bindJs, /\/auth\/employee\/bind-phone/);
assert.match(bindJs, /\/auth\/employee\/bind-code/);
assert.match(bindJs, /bindTicket/);
assert.match(bindJs, /if \(this\.data\.loading\) return/);
assert.doesNotMatch(
  bindJs,
  /url:\s*[^\n]*\/auth\/employee\/bind-code[\s\S]{0,500}phoneCode/,
  '绑定码请求不能要求手机号动态码'
);
assert.match(bindWxml, /身份证后六位/);
assert.match(bindWxml, /一次性绑定码/);
assert.doesNotMatch(bindWxml, /\{\{\s*(?:token|phone|idCard|idCardNo)\s*\}\}/i);
assert.doesNotMatch(bindWxml, /\b1\d{10}\b|\b\d{17}[0-9X]\b/i);

const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
const payrollJs = read('wechat-miniprogram/miniprogram/pages/payroll/index.js');
const advancesJs = read('wechat-miniprogram/miniprogram/pages/advances/index.js');
const profileJs = read('wechat-miniprogram/miniprogram/pages/profile/index.js');
assert.match(homeJs, /syncTabBar\(this,\s*0\)/, '首页应保持首项菜单');
assert.match(advancesJs, /syncTabBar\(this,\s*2\)/, '管理端预支应保持第三个静态根页面');
assert.match(payrollJs, /syncTabBar\(this, employeeMode \? 1 : 3\)/, '工资根页面角色菜单索引错误');
assert.match(profileJs, /syncTabBar\(this, employeeMode \? 2 : 4\)/, '我的根页面角色菜单索引错误');

console.log('miniprogram-dual-login-tests-ok');
