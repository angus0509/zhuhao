const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const authPath = path.join(root, 'wechat-miniprogram/miniprogram/utils/auth.js');
const loginPath = path.join(root, 'wechat-miniprogram/miniprogram/pages/login/index.js');
const loginWxml = fs.readFileSync(path.join(root, 'wechat-miniprogram/miniprogram/pages/login/index.wxml'), 'utf8');

const storage = new Map();
let authExports = null;
vm.runInNewContext(fs.readFileSync(authPath, 'utf8'), {
  module: { set exports(value) { authExports = value; }, get exports() { return authExports || {}; } },
  exports: {},
  getApp: undefined,
  wx: {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    reLaunch() {}
  }
}, { filename: authPath });

assert.equal(typeof authExports.getRememberedManagerLogin, 'function', '缺少驻厂端记住登录读取能力');
assert.equal(typeof authExports.clearRememberedManagerLogin, 'function', '缺少显式清除设备凭证能力');

authExports.saveSession({
  token: 'short-access-token',
  refreshToken: 'long-device-token',
  refreshExpiresAt: '2099-09-16 11:00:00',
  user: { id: 9, companyId: 1, username: 'onsite01', realName: '驻厂张三', accountType: 'MANAGER' }
});
assert.deepEqual(
  JSON.parse(JSON.stringify(authExports.getRememberedManagerLogin())),
  {
    refreshToken: 'long-device-token',
    refreshExpiresAt: '2099-09-16 11:00:00',
    username: 'onsite01',
    realName: '驻厂张三'
  }
);
assert.equal(JSON.stringify([...storage.entries()]).includes('password'), false, '小程序本地不得保存密码');

authExports.clearSession();
assert.equal(authExports.getSession(), null, '短期会话应能被清除');
assert.equal(authExports.getRememberedManagerLogin().refreshToken, 'long-device-token',
  '接口401清除短期会话时应保留一键登录凭证');
authExports.clearRememberedManagerLogin();
assert.equal(authExports.getRememberedManagerLogin(), null, '用户主动退出时必须清除一键登录凭证');

async function main() {
const requests = [];
let pageDefinition = null;
const remembered = {
  refreshToken: 'remembered-token',
  refreshExpiresAt: '2099-09-16 11:00:00',
  username: 'onsite01',
  realName: '驻厂张三'
};
vm.runInNewContext(fs.readFileSync(loginPath, 'utf8'), {
  Page(value) { pageDefinition = value; },
  getApp() { return { setSession() {}, globalData: {} }; },
  clearInterval() {},
  setInterval() { return 1; },
  wx: {
    login() {},
    switchTab() {},
    navigateTo() {},
    showToast() {}
  },
  require(requestPath) {
    if (requestPath.endsWith('/utils/request')) {
      return options => {
        requests.push(options);
        return Promise.resolve({
          token: 'new-access-token',
          refreshToken: 'new-refresh-token',
          refreshExpiresAt: '2026-09-17 11:00:00',
          user: { id: 9, companyId: 1, username: 'onsite01', accountType: 'MANAGER' }
        });
      };
    }
    if (requestPath.endsWith('/utils/auth')) {
      return {
        saveSession() {}, getSession: () => null, isEmployeeSession: () => false,
        consumePendingDestination: () => '', getRememberedManagerLogin: () => remembered,
        clearRememberedManagerLogin() {}
      };
    }
    if (requestPath.endsWith('/config/env')) return { COMPANY_ID: 1 };
    if (requestPath.endsWith('/utils/feedback')) return { consumeAuthMessage: () => '' };
    throw new Error(`未提供测试依赖：${requestPath}`);
  }
}, { filename: loginPath });

assert.ok(pageDefinition, '登录页未注册');
const page = {
  ...pageDefinition,
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(patch) { Object.assign(this.data, patch); }
};
page.onLoad.call(page);
assert.equal(page.data.loginMode, 'manager');
assert.equal(page.data.username, 'onsite01');
assert.equal(page.data.rememberedManagerName, '驻厂张三');
await page.submitRememberedManagerLogin.call(page);
assert.equal(requests[0].url, '/auth/refresh');
assert.equal(requests[0].data.refreshToken, 'remembered-token');
assert.equal(Object.hasOwn(requests[0].data, 'password'), false);

assert.match(loginWxml, /记住登录/);
assert.match(loginWxml, /一键登录/);
assert.doesNotMatch(loginWxml, /value="\{\{password\}\}"[^>]+hidden/, '页面不得用隐藏字段保存密码');

console.log('miniprogram-manager-one-click-login-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
