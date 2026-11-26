const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const employeeSession = {
  token: 'employee-receipt-token',
  user: { id: 91, companyId: 7, employeeId: 1001, accountType: 'EMPLOYEE' }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshRequire(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}

function instantiatePage(config) {
  const instance = {
    data: clone(config.data || {}),
    setData(patch) { Object.assign(this.data, patch); }
  };
  for (const [name, method] of Object.entries(config)) {
    if (typeof method === 'function') instance[name] = method.bind(instance);
  }
  return instance;
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const signedPayslip = {
    id: 31,
    salaryMonth: '2026-10',
    projectName: '装配项目',
    receiptStatus: 2,
    displayStatus: '已签收',
    activeSignature: { id: 801, signedName: '张三', signedAt: '2026-11-15 09:30:00' },
    evidenceReceipt: {
      receiptNo: 'PSR-20261115-ABCDEF123456',
      receiptUrl: '/api/me/payslips/31/evidence-receipt'
    },
    openDispute: null
  };

  global.wx = {
    getStorageSync(key) {
      if (key === 'youyi_hr_token') return employeeSession.token;
      if (key === 'youyi_hr_user') return employeeSession.user;
      return '';
    },
    request(options) {
      options.success({ statusCode: 200, data: { code: 0, data: signedPayslip } });
    },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    navigateTo() {},
    setNavigationBarTitle() {}
  };

  let detailConfig = null;
  global.Page = config => { detailConfig = config; };
  freshRequire(path.join(miniRoot, 'pages/my-payslips/detail/index.js'));
  const detail = instantiatePage(detailConfig);
  detail.onLoad({ id: '31' });
  detail.onShow();
  await flushPromises();

  assert.equal(detail.data.canSign, false, '已签收工资条不得再次签收');
  assert.equal(detail.data.canDispute, false, '已签收工资条不得继续显示工资异议入口');
  assert.notEqual(detail.data.canDownloadReceipt, true, '已签收工资条不得显示电子回执下载入口');
  assert.equal(typeof detail.downloadEvidenceReceipt, 'undefined', '员工详情页不得暴露电子回执下载操作');

  console.log('miniprogram-payslip-evidence-receipt-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
