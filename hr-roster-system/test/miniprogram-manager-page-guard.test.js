const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function exerciseManagerPage(relativePath, lifecycle) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const employeeSession = {
    token: 'employee-token',
    user: { id: 81, companyId: 1, employeeId: 901, accountType: 'EMPLOYEE', permissions: [] }
  };
  const requests = [];
  const switches = [];
  let definition = null;
  const auth = {
    requireSession: () => employeeSession,
    requireManagerSession: () => {
      switches.push('/pages/home/index');
      return null;
    },
    hasPermission: () => false
  };
  const context = {
    console,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    Page(value) { definition = value; },
    wx: {
      switchTab(options) { switches.push(options.url); },
      navigateBack() {},
      navigateTo() {},
      setNavigationBarTitle() {},
      getStorageSync() { return ''; },
      setStorageSync() {},
      removeStorageSync() {},
      showToast() {},
      showModal() {},
      stopPullDownRefresh() {}
    },
    require(requestPath) {
      if (requestPath.endsWith('/utils/request')) return options => {
        requests.push(options.url);
        return Promise.resolve([]);
      };
      if (requestPath.endsWith('/utils/auth')) return auth;
      if (requestPath.endsWith('/utils/page-refresh')) return { markDirty() {}, shouldRefresh: () => true, markLoaded() {} };
      if (requestPath.endsWith('/utils/tab-bar')) return { syncTabBar() {} };
      if (requestPath.endsWith('/utils/feedback')) {
        return { showOperationError() {}, showPartialFailure: () => '', navigateWithFeedback() {} };
      }
      if (requestPath.endsWith('/utils/download')) return { openProtectedAttachment: async () => {} };
      throw new Error(`未提供测试依赖：${requestPath}`);
    }
  };
  vm.runInNewContext(source, context, { filename: relativePath });
  assert.ok(definition, `${relativePath} 未注册 Page`);
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
    getTabBar() { return null; }
  };
  lifecycle(page);
  return new Promise(resolve => setImmediate(() => resolve({ requests, switches })));
}

async function main() {
  const cases = [
    ['wechat-miniprogram/miniprogram/pages/employees/index.js', page => page.onShow.call(page)],
    ['wechat-miniprogram/miniprogram/pages/tasks/index.js', page => {
      page.onLoad.call(page, {});
      page.onShow.call(page);
    }],
    ['wechat-miniprogram/miniprogram/pages/channels/index.js', page => page.onShow.call(page)],
    ['wechat-miniprogram/miniprogram/pages/employees/detail/index.js', page => {
      page.onLoad.call(page, { id: '99' });
      page.onShow.call(page);
    }]
  ];

  for (const [relativePath, lifecycle] of cases) {
    const result = await exerciseManagerPage(relativePath, lifecycle);
    assert.deepEqual(result.requests, [], `${relativePath} 员工账号不得请求驻厂管理接口`);
    assert.ok(result.switches.includes('/pages/home/index'), `${relativePath} 员工账号应直接返回员工首页`);
  }

  console.log('miniprogram-manager-page-guard-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
