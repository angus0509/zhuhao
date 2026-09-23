const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const state = fs.readFileSync(path.join(root, 'public/js/core/state.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'public/js/core/api.js'), 'utf8');

assert.match(html, /id="loginError"[^>]*role="alert"/);
assert.match(html, /id="loginSubmitButton"/);
assert.match(css, /\.toast\s*\{[^}]*z-index:\s*10001/s);
assert.match(css, /\.login-error-message\s*\{/);
assert.match(state, /let loginSubmitting = false/);
assert.match(app, /if \(loginSubmitting\) return/);
assert.match(app, /submitButton\.disabled = true/);
assert.match(app, /setLoginError\(error\.message/);
assert.match(app, /addEventListener\('input', \(\) => setLoginError\(''\)\)/);

const setLoginErrorSource = app.slice(
  app.indexOf('function setLoginError(message)'),
  app.indexOf('\nfunction logout', app.indexOf('function setLoginError(message)'))
);
const initSource = app.slice(
  app.indexOf('async function init()'),
  app.indexOf('\n/* ==================== 回到顶部', app.indexOf('async function init()'))
);

function createAuthContext(rememberedMessage = '') {
  const storage = new Map();
  if (rememberedMessage) storage.set('hrRosterAuthMessage', rememberedMessage);
  const loginError = {
    textContent: '',
    hidden: true,
    classList: {
      toggle(name, force) {
        if (name === 'hidden') loginError.hidden = Boolean(force);
      }
    }
  };
  const context = vm.createContext({
    console,
    URLSearchParams,
    FormData: class FormData {},
    Blob: class Blob {},
    document: {
      querySelector(selector) { return selector === '#loginError' ? loginError : null; },
      querySelectorAll() { return []; }
    },
    localStorage: { removeItem() {} },
    sessionStorage: {
      setItem(key, value) { storage.set(key, value); },
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); }
    },
    fetch: async () => ({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ code: 401, message: '未登录或登录已过期' })
    }),
    initializeRosterTableTools() {},
    bindEvents() {},
    initBackToTop() {},
    logout() {},
    activateAuthenticatedSession() {
      throw new Error('未登录时不应进入已登录工作区');
    }
  });
  vm.runInContext(state, context, { filename: 'public/js/core/state.js' });
  vm.runInContext(api, context, { filename: 'public/js/core/api.js' });
  vm.runInContext(setLoginErrorSource, context, { filename: 'public/app.js' });
  vm.runInContext(initSource, context, { filename: 'public/app.js' });
  return { context, loginError };
}

async function run() {
  const freshVisit = createAuthContext();
  await vm.runInContext('init()', freshVisit.context);
  assert.equal(freshVisit.loginError.textContent, '', '首次未登录访问不应误报登录已过期');
  assert.equal(freshVisit.loginError.hidden, true, '首次未登录访问应隐藏错误提示');

  const expiredSession = createAuthContext('登录已过期，请重新登录');
  await vm.runInContext('init()', expiredSession.context);
  assert.equal(expiredSession.loginError.textContent, '登录已过期，请重新登录', '真实会话过期提示必须保留');
  assert.equal(expiredSession.loginError.hidden, false, '真实会话过期提示必须可见');

  const protectedRequest = createAuthContext();
  await assert.rejects(vm.runInContext("api('/api/employees')", protectedRequest.context), /未登录或登录已过期/);
  assert.equal(protectedRequest.loginError.textContent, '未登录或登录已过期', '登录后的接口 401 仍应提示会话失效');
  assert.equal(protectedRequest.loginError.hidden, false, '登录后的接口 401 提示必须可见');

  console.log('login-feedback-tests-ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
