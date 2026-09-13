const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function createElement(id, initial = {}) {
  const attributes = new Map();
  return {
    id,
    innerHTML: initial.innerHTML || '',
    textContent: initial.textContent || '',
    value: initial.value || '',
    resetCount: 0,
    closeCount: 0,
    open: Boolean(initial.open),
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    reset() {
      this.resetCount += 1;
    },
    close() {
      this.closeCount += 1;
      this.open = false;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) || null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    }
  };
}

const contentIds = [
  'employeeTableBody',
  'detailContent',
  'clientCards',
  'projectCards',
  'talentTableBody',
  'advanceTableBody',
  'payrollKpis',
  'payrollRecentBatches',
  'payrollRecordsGroups',
  'payrollDisputeTableBody',
  'payrollBatchEmployeeBody',
  'riskTableBody',
  'blacklistTableBody',
  'permissionRoleCards',
  'permissionUserTableBody',
  'channelTableBody',
  'auditTableBody',
  'mobileEmpList',
  'channelSummary',
  'riskSummaryKpis'
];

const elements = new Map(contentIds.map(id => [id, createElement(id, { innerHTML: `旧账号-${id}` })]));
const appShell = createElement('appShell');
elements.set('appShell', appShell);
for (const id of ['employeeTotal', 'activeTotal', 'unresolvedRiskTotal', 'advanceOutstanding']) {
  elements.set(id, createElement(id, { textContent: '99' }));
}
const signatureImage = createElement('payrollSignatureImage');
signatureImage.setAttribute('src', 'blob:old-signature');
elements.set('payrollSignatureImage', signatureImage);

const loginForm = createElement('loginForm');
const employeeForm = createElement('employeeForm');
const openDialog = createElement('employeeModal', { open: true });
const revokedUrls = [];
let fetchCount = 0;

const context = vm.createContext({
  console,
  URLSearchParams,
  FormData: class FormData {},
  Blob: class Blob {},
  URL: {
    revokeObjectURL(url) {
      revokedUrls.push(url);
    }
  },
  document: {
    querySelector(selector) {
      if (selector === '.app-shell') return appShell;
      return selector.startsWith('#') ? elements.get(selector.slice(1)) || null : null;
    },
    querySelectorAll(selector) {
      if (selector === 'form') return [loginForm, employeeForm];
      if (selector === 'dialog[open]') return openDialog.open ? [openDialog] : [];
      return [];
    }
  },
  sessionStorage: {
    setItem() {},
    getItem() { return null; },
    removeItem() {}
  },
  fetch: async () => {
    fetchCount += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ code: 0, data: { request: fetchCount } })
    };
  }
});

vm.runInContext(read('public/js/core/state.js'), context);
vm.runInContext(read('public/js/core/api.js'), context);

async function run() {
  const cleanupCalls = [];
  context.cleanupCalls = cleanupCalls;
  vm.runInContext('registerSessionCleanupHook(() => cleanupCalls.push("module-cache"))', context);
  await vm.runInContext("cachedApi('/api/old-account')", context);
  await vm.runInContext("cachedApi('/api/old-account')", context);
  assert.equal(fetchCount, 1, '测试前置条件：接口缓存应已保存旧账号响应');

  vm.runInContext(`
    Object.assign(state, {
      bootstrap: { customers: [{ id: 1 }] },
      employees: [{ id: 1, name: '旧员工' }],
      token: 'old-token',
      user: { id: 1, realName: '旧账号' },
      selectedEmployeeId: 1,
      selectedDetail: { basicInfo: { name: '旧员工' } },
      editingEmployeeId: 1,
      editingMobileEmployeeId: 1,
      transferEmployeeId: 1,
      resignEmployeeId: 1,
      clients: [{ id: 1 }],
      projects: [{ id: 1 }],
      talents: [{ id: 1 }],
      advances: [{ id: 1 }],
      payrollDisputes: [{ id: 1 }],
      payrollOverviewData: { total: 1 },
      payrollWorkspace: 'records',
      payrollRecordFilter: 'published',
      payrollRecordMonth: '2026-08',
      payrollBatchDetail: { id: 1 },
      payrollDetailFilter: 'signed',
      payrollDetailKeyword: '旧员工',
      payrollSmsBusy: true,
      payrollSignatureObjectUrl: 'blob:old-signature',
      payrollImport: {
        sourceRows: [['旧工资']], headers: ['姓名'], header: ['姓名'],
        headerSignature: 'old', suggestedMapping: [{}], mapping: [{}],
        mappingRequired: true, parsedRows: [{}], preview: {}, fileName: 'old.xlsx',
        sheetName: '工资', templates: [{}], activeTemplateId: 1
      },
      recruitmentChannels: [{ id: 1 }],
      risks: [{ id: 1 }],
      selectedRiskId: 1,
      selectedRiskProjectId: 1,
      rosterViewMode: 'flat',
      activeView: 'payroll'
    });
    clearSessionWorkspace();
  `, context);

  const cleared = JSON.parse(vm.runInContext(`JSON.stringify(state)`, context));
  assert.equal(cleared.token, '', '退出后必须清空旧账号 Token');
  assert.equal(cleared.user, null, '退出后必须清空旧账号身份');
  for (const key of ['employees', 'clients', 'projects', 'talents', 'advances', 'payrollDisputes', 'recruitmentChannels', 'risks']) {
    assert.deepEqual(cleared[key], [], `退出后必须清空 ${key} 业务数据`);
  }
  assert.equal(cleared.bootstrap, null, '退出后不得保留旧账号客户和岗位下拉数据');
  assert.equal(cleared.selectedEmployeeId, null, '退出后不得保留已选员工');
  assert.equal(cleared.selectedDetail, null, '退出后不得保留员工敏感详情');
  assert.equal(cleared.payrollOverviewData, null, '退出后不得保留工资概览');
  assert.equal(cleared.payrollBatchDetail, null, '退出后不得保留工资批次详情');
  assert.deepEqual(cleared.payrollImport.sourceRows, [], '退出后不得保留工资表原始数据');
  assert.equal(cleared.payrollImport.fileName, '', '退出后不得保留工资表文件名');
  assert.equal(cleared.activeView, 'office', '新账号应从办公中心重新进入');

  for (const id of contentIds) {
    assert.equal(elements.get(id).innerHTML, '', `退出后页面区域 #${id} 必须清空`);
  }
  assert.equal(elements.get('employeeTotal').textContent, '0', '退出后员工指标必须归零');
  assert.equal(elements.get('advanceOutstanding').textContent, '¥0', '退出后预支金额必须归零');
  assert.equal(signatureImage.getAttribute('src'), null, '退出后签名图片必须移除');
  assert.deepEqual(revokedUrls, ['blob:old-signature'], '退出后必须释放工资签名临时链接');
  assert.equal(employeeForm.resetCount, 1, '退出后业务表单必须重置');
  assert.equal(loginForm.resetCount, 0, '会话清理不应清空正在填写的登录表单');
  assert.equal(openDialog.closeCount, 1, '退出后必须关闭已打开的业务弹窗');
  assert.deepEqual(cleanupCalls, ['module-cache'], '退出后必须清理会话外部模块缓存');
  assert.equal(appShell.inert, true, '退出后旧工作区必须锁定，不能被键盘或辅助技术访问');
  assert.equal(appShell.getAttribute('aria-hidden'), 'true', '退出后旧工作区必须标记为不可访问');

  await vm.runInContext("cachedApi('/api/old-account')", context);
  assert.equal(fetchCount, 2, '退出后旧账号接口缓存必须失效');

  let releaseBoot;
  const order = [];
  context.nextUser = { id: 2, realName: '新账号' };
  context.bootNewSession = () => new Promise(resolve => {
    releaseBoot = () => {
      order.push('boot');
      resolve();
    };
  });
  context.revealNewSession = () => {
    order.push('show');
    context.setWorkspaceLocked(false);
  };
  const activation = vm.runInContext(
    "activateAuthenticatedSession(nextUser, 'new-token', { boot: bootNewSession, reveal: revealNewSession })",
    context
  );
  await Promise.resolve();
  assert.deepEqual(order, [], '新账号数据加载完成前不得显示工作区');
  releaseBoot();
  await activation;
  assert.deepEqual(order, ['boot', 'show'], '必须先加载新账号数据，再显示工作区');
  assert.equal(appShell.inert, false, '新账号工作区加载完成后应解除锁定');
  assert.equal(appShell.getAttribute('aria-hidden'), null, '新账号工作区加载完成后应恢复可访问');
  assert.equal(vm.runInContext('state.user.id', context), 2, '加载完成后应启用新账号身份');

  context.failedUser = { id: 3, realName: '失败账号' };
  await assert.rejects(
    vm.runInContext(`activateAuthenticatedSession(failedUser, 'failed-token', {
      boot: async () => { throw new Error('业务数据加载失败'); },
      reveal: () => { throw new Error('加载失败时不应显示工作区'); }
    })`, context),
    /业务数据加载失败/
  );
  assert.equal(vm.runInContext('state.user', context), null, '新账号加载失败后必须清除不完整会话');
  assert.equal(vm.runInContext('state.token', context), '', '新账号加载失败后必须清除 Token');

  console.log('web-session-data-clear-tests-ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
