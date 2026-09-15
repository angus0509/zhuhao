const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const employeeSession = {
  token: 'employee-secret-token',
  user: {
    id: 91,
    companyId: 7,
    employeeId: 1001,
    accountType: 'EMPLOYEE',
    realName: '张三'
  }
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
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  for (const [name, method] of Object.entries(config)) {
    if (typeof method === 'function') instance[name] = method.bind(instance);
  }
  return instance;
}

function drawValidSignature(page) {
  const strokes = [
    [[20, 30], [55, 65], [90, 25], [120, 70]],
    [[45, 18], [45, 95], [80, 120]],
    [[145, 25], [185, 70], [225, 30], [245, 105]],
    [[150, 95], [195, 55], [240, 115]]
  ];
  for (const stroke of strokes) {
    page.onTouchStart({ touches: [{ x: stroke[0][0], y: stroke[0][1] }] });
    for (const [x, y] of stroke.slice(1)) page.onTouchMove({ touches: [{ x, y }] });
    page.onTouchEnd();
  }
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const requests = [];
  const uploads = [];
  const downloads = [];
  const toasts = [];
  const navigations = [];
  const canvasCalls = [];
  let uploadMode = 'success';
  let receiptMode = 'success';
  const detailPayload = {
    id: 31,
    salaryMonth: '2026-08',
    projectName: '装配项目',
    grossAmount: 8150,
    netAmount: 6900,
    receiptStatus: 1,
    displayStatus: '待签字',
    activeSignature: null,
    openDispute: null
  };

  const canvasContext = {
    setStrokeStyle(value) { canvasCalls.push(['stroke', value]); },
    setLineWidth(value) { canvasCalls.push(['width', value]); },
    setLineCap(value) { canvasCalls.push(['cap', value]); },
    setLineJoin(value) { canvasCalls.push(['join', value]); },
    beginPath() { canvasCalls.push(['begin']); },
    moveTo(x, y) { canvasCalls.push(['move', x, y]); },
    lineTo(x, y) { canvasCalls.push(['line', x, y]); },
    stroke() { canvasCalls.push(['draw-line']); },
    clearRect(x, y, width, height) { canvasCalls.push(['clear', x, y, width, height]); },
    draw(reserve) { canvasCalls.push(['draw', reserve]); }
  };

  global.wx = {
    getStorageSync(key) {
      if (key === 'youyi_hr_token') return employeeSession.token;
      if (key === 'youyi_hr_user') return employeeSession.user;
      return '';
    },
    request(options) {
      requests.push(options);
      if (options.url.endsWith('/receipt') && receiptMode === 'failure') {
        options.success({ statusCode: 409, data: { code: 409, message: '签收状态更新失败' } });
        return;
      }
      const data = options.url.endsWith('/dispute')
        ? { disputeId: 88, handleStatus: 0, handleStatusName: '待处理' }
        : options.url.endsWith('/receipt')
          ? { payslipId: 31, receiptStatus: 2, receiptStatusName: '已签收' }
          : detailPayload;
      options.success({ statusCode: 200, data: { code: 0, data } });
    },
    uploadFile(options) {
      uploads.push(options);
      if (uploadMode === 'domain') {
        options.fail({ errMsg: 'uploadFile:fail url not in domain list' });
        return;
      }
      if (uploadMode === 'file-missing') {
        options.fail({ errMsg: 'uploadFile:fail file not found' });
        return;
      }
      if (uploadMode === 'failure') {
        options.fail({ errMsg: 'uploadFile:fail timeout' });
        return;
      }
      options.success({
        statusCode: 200,
        data: JSON.stringify({
          code: 0,
          data: { signatureId: 801, signedName: '张三', signedAt: '2026-08-14T10:00:00.000Z' }
        })
      });
    },
    downloadFile(options) {
      downloads.push(options);
      options.success({ statusCode: 200, tempFilePath: '/tmp/saved-signature.png' });
    },
    createCanvasContext() {
      return canvasContext;
    },
    canvasToTempFilePath(options) {
      options.success({ tempFilePath: '/tmp/signature.png' });
    },
    showToast(options) {
      toasts.push(options.title);
    },
    showModal(options) {
      options.success?.({ confirm: true });
    },
    navigateBack() {
      navigations.push('back');
    },
    reLaunch() {},
    setNavigationBarTitle() {}
  };

  let signConfig = null;
  global.Page = config => { signConfig = config; };
  freshRequire(path.join(miniRoot, 'pages/my-payslips/sign/index.js'));

  const blank = instantiatePage(signConfig);
  blank.onLoad({ id: '31' });
  await flushPromises();
  blank.toggleConfirmed();
  await blank.submitSignature();
  assert.equal(uploads.length, 0, '空白签名不能上传');
  assert.match(toasts.at(-1), /签名/);

  const activeSignaturePage = instantiatePage(signConfig);
  detailPayload.activeSignature = { id: 801, signedName: '张三', signedAt: '2026-08-14T10:00:00.000Z' };
  activeSignaturePage.onLoad({ id: '31' });
  await flushPromises();
  assert.equal(downloads.length, 1, '二次进入签字页必须下载原始手写签名');
  assert.equal(downloads[0].url.endsWith('/me/payslips/31/signature'), true);
  assert.equal(downloads[0].header.authorization, `Bearer ${employeeSession.token}`);
  assert.equal(activeSignaturePage.data.signaturePreviewPath, '/tmp/saved-signature.png');
  detailPayload.activeSignature = null;

  blank.onTouchStart({ touches: [{ x: 20, y: 30 }] });
  blank.onTouchMove({ touches: [{ x: 80, y: 90 }] });
  blank.onTouchEnd();
  assert.equal(blank.data.hasInk, true);
  assert.ok(canvasCalls.some(call => call[0] === 'line'), '手写移动必须绘制线段');
  blank.clearSignature();
  assert.equal(blank.data.hasInk, false);
  assert.ok(canvasCalls.some(call => call[0] === 'clear'), '清除签名必须清空 Canvas');

  const unconfirmed = instantiatePage(signConfig);
  unconfirmed.onLoad({ id: '31' });
  await flushPromises();
  unconfirmed.onTouchStart({ touches: [{ x: 10, y: 10 }] });
  unconfirmed.onTouchMove({ touches: [{ x: 30, y: 30 }] });
  await unconfirmed.submitSignature();
  assert.match(toasts.at(-1), /核对/);

  const casual = instantiatePage(signConfig);
  casual.onLoad({ id: '31' });
  await flushPromises();
  casual.onTouchStart({ touches: [{ x: 10, y: 10 }] });
  casual.onTouchMove({ touches: [{ x: 220, y: 12 }] });
  casual.onTouchEnd();
  casual.toggleConfirmed();
  const uploadsBeforeCasual = uploads.length;
  await casual.submitSignature();
  assert.equal(uploads.length, uploadsBeforeCasual, '单线随意划写不得上传');
  assert.match(toasts.at(-1), /规范手写|重新签字/);

  const success = instantiatePage(signConfig);
  success.onLoad({ id: '31' });
  await flushPromises();
  drawValidSignature(success);
  success.toggleConfirmed();
  await Promise.all([success.submitSignature(), success.submitSignature()]);
  await flushPromises();
  assert.equal(uploads.length, 1, '重复点击只能上传一次');
  assert.equal(uploads[0].name, 'signature');
  assert.equal(uploads[0].formData.signedName, '张三');
  assert.equal(uploads[0].header.authorization, `Bearer ${employeeSession.token}`);
  assert.doesNotMatch(uploads[0].url, new RegExp(employeeSession.token));
  const receiptRequest = requests.find(item => item.url.endsWith('/me/payslips/31/receipt'));
  assert.ok(receiptRequest, '签名上传后必须确认签收');
  assert.deepEqual(receiptRequest.data, { action: 'accept', confirmed: true, signatureId: 801 });
  assert.equal(navigations.at(-1), 'back');

  uploadMode = 'failure';
  const uploadFailure = instantiatePage(signConfig);
  uploadFailure.onLoad({ id: '31' });
  await flushPromises();
  drawValidSignature(uploadFailure);
  uploadFailure.toggleConfirmed();
  const beforeFailedReceipt = requests.filter(item => item.url.endsWith('/receipt')).length;
  await uploadFailure.submitSignature();
  await flushPromises();
  assert.equal(requests.filter(item => item.url.endsWith('/receipt')).length, beforeFailedReceipt);
  assert.equal(uploadFailure.data.submitting, false);
  assert.match(toasts.at(-1), /上传|网络/);

  uploadMode = 'domain';
  const domainFailure = instantiatePage(signConfig);
  domainFailure.onLoad({ id: '31' });
  await flushPromises();
  drawValidSignature(domainFailure);
  domainFailure.toggleConfirmed();
  await domainFailure.submitSignature();
  await flushPromises();
  assert.match(toasts.at(-1), /上传合法域名/);

  uploadMode = 'file-missing';
  const fileMissingFailure = instantiatePage(signConfig);
  fileMissingFailure.onLoad({ id: '31' });
  await flushPromises();
  drawValidSignature(fileMissingFailure);
  fileMissingFailure.toggleConfirmed();
  await fileMissingFailure.submitSignature();
  await flushPromises();
  assert.match(toasts.at(-1), /签名图片生成失败/);

  uploadMode = 'success';
  receiptMode = 'failure';
  const receiptFailure = instantiatePage(signConfig);
  receiptFailure.onLoad({ id: '31' });
  await flushPromises();
  drawValidSignature(receiptFailure);
  receiptFailure.toggleConfirmed();
  await receiptFailure.submitSignature();
  await flushPromises();
  assert.equal(receiptFailure.data.submitting, false);
  assert.equal(receiptFailure.data.signatureId, 801, '签收失败时应保留已上传签名供重试');
  assert.match(toasts.at(-1), /签收状态更新失败/);

  receiptMode = 'success';
  let detailConfig = null;
  global.Page = config => { detailConfig = config; };
  freshRequire(path.join(miniRoot, 'pages/my-payslips/detail/index.js'));
  const detail = instantiatePage(detailConfig);
  detail.onLoad({ id: '31' });
  detail.onShow();
  await flushPromises();

  detail.setData({ disputeReason: '太短', disputeCount: 2 });
  const disputeBefore = requests.filter(item => item.url.endsWith('/dispute')).length;
  await detail.submitDispute();
  assert.equal(requests.filter(item => item.url.endsWith('/dispute')).length, disputeBefore);
  assert.match(toasts.at(-1), /10至500字/);

  detail.setData({ disputeReason: '本月加班工时与实际记录不一致，请核对。', disputeCount: 19 });
  await detail.submitDispute();
  await flushPromises();
  const disputeRequest = requests.find(item => item.url.endsWith('/me/payslips/31/dispute'));
  assert.ok(disputeRequest);
  assert.equal(disputeRequest.method, 'POST');
  assert.equal(disputeRequest.data.reason, '本月加班工时与实际记录不一致，请核对。');

  const signJs = fs.readFileSync(path.join(miniRoot, 'pages/my-payslips/sign/index.js'), 'utf8');
  const signWxml = fs.readFileSync(path.join(miniRoot, 'pages/my-payslips/sign/index.wxml'), 'utf8');
  const signWxss = fs.readFileSync(path.join(miniRoot, 'pages/my-payslips/sign/index.wxss'), 'utf8');
  assert.match(signWxml, /canvas-id="signatureCanvas"/);
  assert.match(signWxml, /signaturePreviewPath/, '已保存状态必须展示原始手写签名图片');
  assert.doesNotMatch(signWxml, /已保存的手写签名[\s\S]{0,120}\{\{signedName\}\}/,
    '已保存状态不能用系统字体姓名冒充手写签名');
  assert.match(signWxml, /规范手写.*signedName/, '签字区必须按档案姓名提示规范签写');
  assert.match(signWxml, /本人已核对工资条内容/);
  assert.match(signWxml, /清除重签/);
  assert.match(signJs, /wx\.canvasToTempFilePath/);
  assert.match(signJs, /wx\.uploadFile/);
  assert.match(signJs, /fileType:\s*'png'/);
  assert.doesNotMatch(signJs + signWxml, /employeeId=.*\{|token=.*\{|console\.(?:log|info|debug)/i);
  assert.match(signWxss, /min-height:\s*96rpx/);

  console.log('miniprogram-payslip-signature-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
