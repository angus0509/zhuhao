const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  const downloads = [];
  const opened = [];
  const toasts = [];
  let downloadMode = 'success';
  let openMode = 'success';
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
    downloadFile(options) {
      downloads.push(options);
      if (downloadMode === 'http') {
        options.success({ statusCode: 403, tempFilePath: '/tmp/receipt.pdf' });
        return;
      }
      if (downloadMode === 'not-pdf') {
        options.success({ statusCode: 200, tempFilePath: '/tmp/receipt.tmp' });
        return;
      }
      if (downloadMode === 'network') {
        options.fail({ errMsg: 'downloadFile:fail timeout' });
        return;
      }
      options.success({ statusCode: 200, tempFilePath: '/tmp/receipt.pdf' });
    },
    openDocument(options) {
      opened.push(options);
      if (openMode === 'failure') {
        options.fail({ errMsg: 'openDocument:fail' });
        return;
      }
      options.success({});
    },
    showToast(options) { toasts.push(options.title); },
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

  assert.equal(detail.data.canDownloadReceipt, true);
  assert.equal(detail.data.canDispute, true, '已签收工资条仍必须保留工资有异议入口');
  await detail.downloadEvidenceReceipt();
  await flushPromises();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, 'https://lczpt.com/api/me/payslips/31/evidence-receipt');
  assert.equal(downloads[0].header.authorization, `Bearer ${employeeSession.token}`);
  assert.doesNotMatch(downloads[0].url, /employee-receipt-token/);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].filePath, '/tmp/receipt.pdf');
  assert.equal(opened[0].fileType, 'pdf');
  assert.equal(opened[0].showMenu, true);

  openMode = 'failure';
  await detail.downloadEvidenceReceipt();
  await flushPromises();
  assert.match(toasts.at(-1), /打开|分享/);
  openMode = 'success';

  downloadMode = 'not-pdf';
  const openedBeforeInvalidPdf = opened.length;
  await detail.downloadEvidenceReceipt();
  await flushPromises();
  assert.equal(opened.length, openedBeforeInvalidPdf, '非PDF临时文件不得打开');
  assert.match(toasts.at(-1), /PDF|回执/);

  downloadMode = 'http';
  await detail.downloadEvidenceReceipt();
  await flushPromises();
  assert.match(toasts.at(-1), /下载失败|403/);

  downloadMode = 'success';
  detail.setData({
    payslip: {
      ...detail.data.payslip,
      evidenceReceipt: {
        receiptNo: 'PSR-20261115-ABCDEF123456',
        receiptUrl: 'https://evil.example/steal'
      }
    }
  });
  const downloadsBeforeUnsafeUrl = downloads.length;
  await detail.downloadEvidenceReceipt();
  assert.equal(downloads.length, downloadsBeforeUnsafeUrl, '不可信回执URL不得携带登录凭证下载');
  assert.match(toasts.at(-1), /地址异常|回执/);

  const detailJs = fs.readFileSync(path.join(miniRoot, 'pages/my-payslips/detail/index.js'), 'utf8');
  const detailWxml = fs.readFileSync(path.join(miniRoot, 'pages/my-payslips/detail/index.wxml'), 'utf8');
  const signJs = fs.readFileSync(path.join(miniRoot, 'pages/my-payslips/sign/index.js'), 'utf8');
  assert.match(detailWxml, /下载电子签收回执/);
  assert.match(detailWxml, /工资有异议/);
  assert.match(detailJs, /wx\.downloadFile/);
  assert.match(detailJs, /wx\.openDocument/);
  assert.match(detailJs, /fileType:\s*'pdf'/);
  assert.doesNotMatch(detailJs + signJs, /setStorageSync\([^)]*challenge|console\.(?:log|info|debug)[^\n]*challenge/i);

  console.log('miniprogram-payslip-evidence-receipt-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
