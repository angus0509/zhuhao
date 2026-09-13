const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadPage(relativePath, session) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const requests = [];
  let definition = null;
  const context = {
    console,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    Page(value) { definition = value; },
    getApp() { return { globalData: {}, captureRuntimeVersion() {} }; },
    wx: {
      setNavigationBarTitle() {},
      getStorageSync() { return ''; },
      setStorageSync() {},
      stopPullDownRefresh() {},
      switchTab() {},
      navigateTo() {},
      showModal() {},
      showToast() {}
    },
    require(requestPath) {
      if (requestPath.endsWith('/utils/request')) {
        return options => {
          requests.push(options.url);
          return Promise.resolve({ overall: {}, customerStats: [], batches: [], list: [], total: 0 });
        };
      }
      if (requestPath.endsWith('/utils/auth')) {
        return {
          getSession: () => session,
          requireSession: () => session,
          clearSessionAndRedirectToLogin() {},
          setPendingDestination() {},
          clearSession() {},
          isEmployeeSession: value => value?.user?.accountType === 'EMPLOYEE' && Number(value?.user?.employeeId) > 0,
          hasPermission: () => true
        };
      }
      if (requestPath.endsWith('/utils/page-refresh')) {
        return { shouldRefresh: () => true, markLoaded() {}, markDirty() {} };
      }
      if (requestPath.endsWith('/utils/tab-bar')) return { syncTabBar() {} };
      if (requestPath.endsWith('/utils/format')) return { money: value => String(value || 0), roleNames: () => '' };
      if (requestPath.endsWith('/utils/feedback')) return { showPartialFailure: () => '' };
      throw new Error(`未提供测试依赖：${requestPath}`);
    }
  };
  vm.runInNewContext(source, context, { filename: relativePath });
  assert.ok(definition, `${relativePath} 未注册 Page`);
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch) { Object.assign(this.data, patch); },
    selectComponent() { return null; },
    getTabBar() { return null; }
  };
  return { page, requests };
}

function runEmployeeRootPage(relativePath) {
  const session = {
    token: 'employee-token',
    user: { id: 81, companyId: 1, employeeId: 901, accountType: 'EMPLOYEE', permissions: [] }
  };
  const { page, requests } = loadPage(relativePath, session);
  assert.equal(page.data.identityReady, false, `${relativePath} 初始状态必须隐藏共享页面内容`);
  page.onShow.call(page);
  assert.equal(page.data.identityReady, true, `${relativePath} 必须在确认账号身份后再显示页面`);
  assert.equal(page.data.employeeMode, true, `${relativePath} 员工账号必须进入员工视图`);
  assert.deepEqual(requests, [], `${relativePath} 员工账号不能调用驻厂或管理接口`);
}

for (const relativePath of [
  'wechat-miniprogram/miniprogram/pages/home/index.js',
  'wechat-miniprogram/miniprogram/pages/payroll/index.js',
  'wechat-miniprogram/miniprogram/pages/advances/index.js',
  'wechat-miniprogram/miniprogram/pages/profile/index.js'
]) {
  runEmployeeRootPage(relativePath);
}

for (const relativePath of [
  'wechat-miniprogram/miniprogram/pages/home/index.wxml',
  'wechat-miniprogram/miniprogram/pages/payroll/index.wxml',
  'wechat-miniprogram/miniprogram/pages/advances/index.wxml',
  'wechat-miniprogram/miniprogram/pages/profile/index.wxml'
]) {
  const markup = fs.readFileSync(path.join(root, relativePath), 'utf8');
  assert.match(markup, /wx:if="\{\{!identityReady\}\}"/, `${relativePath} 缺少身份确认中的遮挡状态`);
  assert.match(markup, /wx:elif="\{\{employeeMode\}\}"/, `${relativePath} 员工视图必须在身份确认后渲染`);
  assert.match(markup, /wx:else/, `${relativePath} 驻厂视图必须与员工视图互斥`);
}

// 账号类型切换时必须清除只属于驻厂端的客户与人员阶段缓存。
const authSource = fs.readFileSync(path.join(root, 'wechat-miniprogram/miniprogram/utils/auth.js'), 'utf8');
const storage = new Map([
  ['youyi_hr_token', 'manager-token'],
  ['youyi_hr_user', { id: 1, accountType: 'MANAGER' }],
  ['onsite_customer_id', '77'],
  ['onsite_employee_stage', 'active']
]);
let authExports = null;
vm.runInNewContext(authSource, {
  module: { set exports(value) { authExports = value; }, get exports() { return authExports || {}; } },
  exports: {},
  getApp: undefined,
  wx: {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    reLaunch() {}
  }
}, { filename: 'utils/auth.js' });
authExports.saveSession({
  token: 'employee-token',
  user: { id: 81, employeeId: 901, accountType: 'EMPLOYEE' }
});
assert.equal(storage.has('onsite_customer_id'), false, '切换到员工账号后必须清除驻厂客户筛选');
assert.equal(storage.has('onsite_employee_stage'), false, '切换到员工账号后必须清除驻厂人员阶段筛选');

console.log('miniprogram-role-isolation-runtime-tests-ok');
