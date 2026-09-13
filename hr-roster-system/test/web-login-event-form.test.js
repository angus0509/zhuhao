const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(root, 'public/js/core/utils.js'), 'utf8');
const loginSource = appSource.slice(
  appSource.indexOf('async function login(event)'),
  appSource.indexOf('\nfunction setLoginError', appSource.indexOf('async function login(event)'))
);

async function run() {
  const form = { nodeName: 'FORM' };
  const submitButton = { disabled: false, textContent: '登录系统' };
  const context = vm.createContext({
    console,
    Object,
    loginSubmitting: false,
    state: { user: null },
    window: {
      clearTimeout() {},
      setTimeout() {},
      matchMedia() { return { matches: true }; }
    },
    FormData: class FormData {
      constructor(target) {
        if (target !== form) {
          throw new TypeError("Failed to construct 'FormData': parameter 1 is not of type 'HTMLFormElement'.");
        }
      }

      entries() {
        return [['username', 'admin'], ['password', 'Admin@123456']];
      }
    },
    $: selector => selector === '#loginSubmitButton' ? submitButton : null,
    waitForLogoutRequest: async () => {},
    setSystemStatus() {},
    setLoginError() {},
    api: async () => ({ user: { id: 1 }, token: 'token' }),
    activateAuthenticatedSession: async () => {},
    toast() {}
  });

  vm.runInContext(utilsSource, context, { filename: 'public/js/core/utils.js' });
  vm.runInContext(loginSource, context, { filename: 'public/app.js' });

  const event = {
    currentTarget: form,
    preventDefault() {
      // 浏览器事件处理函数返回后，currentTarget 会在异步续体执行前失效。
      queueMicrotask(() => { this.currentTarget = null; });
    }
  };

  await vm.runInContext('login', context)(event);
  assert.equal(submitButton.disabled, false, '登录完成后应恢复提交按钮');
  assert.equal(submitButton.textContent, '登录系统', '登录完成后应恢复按钮文案');
  console.log('web-login-event-form-tests-ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
