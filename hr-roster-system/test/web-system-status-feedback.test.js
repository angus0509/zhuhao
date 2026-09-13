const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const auditCopy = '员工、工资条、风险、账号权限等关键操作会自动留痕';

assert.match(html, /id="systemStatus"/, '顶部系统状态缺少稳定 DOM 标识，无法随接口结果更新');

const statusElement = {
  className: 'system-status',
  textContent: '',
  title: '',
  attributes: {},
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
};

const sessionValues = new Map();
const context = vm.createContext({
  console,
  URLSearchParams,
  FormData: class FormData {},
  Blob: class Blob {},
  document: {
    querySelector(selector) {
      return selector === '#systemStatus' ? statusElement : null;
    },
    querySelectorAll() {
      return [];
    }
  },
  sessionStorage: {
    setItem(key, value) {
      sessionValues.set(key, String(value));
    },
    getItem(key) {
      return sessionValues.get(key) || null;
    },
    removeItem(key) {
      sessionValues.delete(key);
    }
  }
});

vm.runInContext(read('public/js/core/state.js'), context);
vm.runInContext(read('public/js/core/api.js'), context);
vm.runInContext(`
  function logout() { globalThis.logoutCalled = true; }
  function setLoginError(message) { globalThis.loginError = message; }
`, context);

function currentStatus() {
  return {
    className: statusElement.className,
    textContent: statusElement.textContent,
    title: statusElement.title,
    ariaLive: statusElement.attributes['aria-live']
  };
}

async function run() {
  vm.runInContext("setSystemStatus('warning')", context);
  assert.deepEqual(currentStatus(), {
    className: 'system-status warning',
    textContent: '部分数据异常',
    title: '部分数据加载失败，请根据页面提示重试',
    ariaLive: 'polite'
  }, '部分接口失败时顶部状态没有提供明确反馈');

  context.fetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: () => 'application/json' },
    json: async () => ({ code: 1, message: '服务暂不可用' })
  });
  await assert.rejects(
    vm.runInContext("api('/api/test')", context),
    /服务暂不可用/
  );
  assert.match(statusElement.className, /\berror\b/, '服务端错误未切换为连接异常状态');
  assert.equal(statusElement.textContent, '连接异常');

  context.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(
    vm.runInContext("api('/api/test')", context),
    /网络连接失败/
  );
  assert.equal(statusElement.textContent, '连接异常', '网络异常未显示连接异常');

  context.fetch = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => 'application/json' },
    json: async () => ({ code: 401, message: '登录已过期' })
  });
  await assert.rejects(
    vm.runInContext("api('/api/test')", context),
    /登录已过期/
  );
  assert.equal(statusElement.textContent, '需要登录', '登录失效仍错误显示系统在线');
  assert.equal(context.logoutCalled, true, '401 未触发现有退出登录流程');

  context.logoutCalled = false;
  context.fetch = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => 'text/html' }
  });
  await assert.rejects(
    vm.runInContext("api('/api/test')", context),
    /登录已过期/
  );
  assert.equal(statusElement.textContent, '需要登录', '非 JSON 的 401 响应未识别为登录失效');
  assert.equal(context.logoutCalled, true, '非 JSON 的 401 响应未退出失效会话');

  vm.runInContext("setSystemStatus('warning')", context);
  context.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ code: 0, data: { ok: true } })
  });
  await vm.runInContext("api('/api/test')", context);
  assert.equal(statusElement.textContent, '部分数据异常', '并发中的单个成功请求不应覆盖已有异常状态');

  assert.match(app, /setSystemStatus\('loading'\)/, '登录或初始化开始时未显示数据同步中');
  assert.match(app, /setSystemStatus\('online'\)/, '初始化成功后未恢复系统在线');
  assert.match(app, /setSystemStatus\('warning'\)/, '部分数据加载失败时未显示部分数据异常');
  assert.match(app, /setSystemStatus\('error'\)/, '初始化完全失败时未显示连接异常');
  assert.ok(app.includes(auditCopy), '审计日志空状态仍描述已取消的合同或雇主险办理流程');

  const css = read('public/ui-polish.css');
  assert.match(css, /\.system-status\.warning\b/, '缺少部分异常状态样式');
  assert.match(css, /\.system-status\.error\b/, '缺少连接异常状态样式');
  assert.match(css, /\.system-status\.auth\b/, '缺少登录失效状态样式');

  console.log('web-system-status-feedback-tests-ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
