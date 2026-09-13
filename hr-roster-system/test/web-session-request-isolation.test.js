const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

let resolveOldRequest;
let fetchCount = 0;
const context = vm.createContext({
  console,
  URLSearchParams,
  FormData: class FormData {},
  Blob: class Blob {},
  document: {
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  sessionStorage: {
    setItem() {},
    getItem() { return null; },
    removeItem() {}
  },
  fetch: async () => {
    fetchCount += 1;
    if (fetchCount === 1) {
      return new Promise(resolve => {
        resolveOldRequest = resolve;
      });
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ code: 0, data: { owner: 'new-account' } })
    };
  }
});

vm.runInContext(read('public/js/core/state.js'), context);
vm.runInContext(read('public/js/core/api.js'), context);

async function run() {
  vm.runInContext(`
    state.token = 'old-token';
    state.user = { id: 1, companyId: 1, realName: '旧账号' };
  `, context);

  const oldRequest = vm.runInContext("cachedApi('/api/employees')", context);
  await Promise.resolve();

  vm.runInContext(`
    clearSessionWorkspace();
    state.token = 'new-token';
    state.user = { id: 2, companyId: 1, realName: '新账号' };
  `, context);

  resolveOldRequest({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ code: 0, data: { owner: 'old-account' } })
  });

  await assert.rejects(
    oldRequest,
    error => error?.code === 'SESSION_SUPERSEDED',
    '切换账号后，旧会话尚未完成的接口响应必须被拒绝'
  );

  const newResult = await vm.runInContext("cachedApi('/api/employees')", context);
  assert.equal(newResult.owner, 'new-account', '旧会话响应不得写入接口缓存供新账号复用');
  assert.equal(fetchCount, 2, '新账号必须重新请求自己的权限范围数据');

  const versionBeforeLogout = vm.runInContext('state.sessionVersion', context);
  vm.runInContext('clearSessionWorkspace()', context);
  const versionAfterLogout = vm.runInContext('state.sessionVersion', context);
  assert.equal(versionAfterLogout, versionBeforeLogout + 1, '每次退出或切换账号必须推进会话版本');

  console.log('web-session-request-isolation-tests-ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
