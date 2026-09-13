const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = vm.createContext({
  console,
  URLSearchParams,
  FormData: class FormData {},
  Blob: class Blob {},
  document: { querySelector() { return null; }, querySelectorAll() { return []; } },
  sessionStorage: { setItem() {}, getItem() { return null; }, removeItem() {} }
});
vm.runInContext(read('public/js/core/state.js'), context);

async function run() {
  let release;
  const logoutRequest = new Promise(resolve => { release = resolve; });
  context.logoutRequest = logoutRequest;
  vm.runInContext('registerLogoutRequest(logoutRequest)', context, { filename: 'test-fixture.js' });

  vm.runInContext('globalThis.loginStarted = false', context);
  const login = vm.runInContext(`(async () => {
    await waitForLogoutRequest();
    globalThis.loginStarted = true;
  })()`, context);
  await Promise.resolve();
  assert.equal(vm.runInContext('loginStarted', context), false, '退出请求未完成前不得开始新账号登录');

  release();
  await login;
  assert.equal(vm.runInContext('loginStarted', context), true, '退出请求完成后才允许开始新账号登录');

  let rejectRelease;
  const failedLogout = new Promise((_resolve, reject) => { rejectRelease = reject; });
  context.failedLogout = failedLogout;
  vm.runInContext('registerLogoutRequest(failedLogout)', context, { filename: 'test-fixture.js' });
  rejectRelease(new Error('logout failed'));
  await vm.runInContext('waitForLogoutRequest()', context);
  assert.equal(vm.runInContext('state.sessionVersion', context), 0, '退出请求失败不应破坏会话版本管理');

  console.log('web-logout-login-barrier-tests-ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
