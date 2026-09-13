const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const employeeSession = {
  token: 'employee-token',
  user: { id: 91, companyId: 7, employeeId: 1001, accountType: 'EMPLOYEE' }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshRequire(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}

function instantiate(config, methods = config.methods || config) {
  const instance = {
    data: clone(config.data || {}),
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  for (const [name, method] of Object.entries(methods)) {
    if (typeof method === 'function') instance[name] = method.bind(instance);
  }
  return instance;
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const requestUrls = [];
  const navigations = [];
  const listPayload = {
    page: 1,
    pageSize: 20,
    total: 2,
    list: [
      {
        id: 31,
        salaryMonth: '2026-08',
        projectName: '装配项目',
        netAmount: 9999,
        displayStatus: '待签字',
        receiptStatus: 1
      },
      {
        id: 29,
        salaryMonth: '2026-07',
        projectName: '包装项目',
        netAmount: 8650.5,
        displayStatus: '已签收',
        receiptStatus: 2
      }
    ]
  };
  const detailPayload = {
    id: 31,
    salaryMonth: '2026-08',
    batchNo: 'SAL202608001',
    projectName: '装配项目',
    baseSalary: 4000,
    positionSalary: 800,
    performanceSalary: 500,
    allowanceAmount: 300,
    pieceAmount: 1200,
    overtime15Amount: 450,
    overtime20Amount: 300,
    overtime30Amount: 600,
    grossAmount: 8150,
    socialDeduction: 680,
    taxDeduction: 70,
    advanceDeduction: 500,
    otherDeduction: 0,
    netAmount: 6900,
    displayStatus: '待签字',
    receiptStatus: 1,
    activeSignature: null,
    openDispute: null
  };

  global.wx = {
    getStorageSync(key) {
      if (key === 'youyi_hr_token') return employeeSession.token;
      if (key === 'youyi_hr_user') return employeeSession.user;
      return '';
    },
    request(options) {
      requestUrls.push(options.url);
      const data = options.url.includes('/me/payslips/31') ? detailPayload : listPayload;
      options.success({ statusCode: 200, data: { code: 0, data } });
    },
    navigateTo(options) {
      navigations.push(options.url);
    },
    setNavigationBarTitle() {},
    stopPullDownRefresh() {},
    showToast() {},
    showModal() {}
  };

  let listConfig = null;
  global.Component = config => { listConfig = config; };
  freshRequire(path.join(miniRoot, 'components/employee-payslip-list/index.js'));
  const list = instantiate(listConfig);
  listConfig.lifetimes.attached.call(list);
  await flushPromises();

  assert.equal(requestUrls.length, 1);
  assert.match(requestUrls[0], /\/me\/payslips\?year=2026&page=1&pageSize=20$/);
  assert.equal(list.data.payslips.length, 2);
  assert.equal(list.data.payslips[0].netAmountText, '¥9,999.00');
  assert.equal(list.data.hasMore, false);
  list.openDetail({ currentTarget: { dataset: { id: 31 } } });
  assert.equal(navigations.at(-1), '/pages/my-payslips/detail/index?id=31');

  const beforeMonthChange = requestUrls.length;
  list.changeMonth({ detail: { value: 8 } });
  await flushPromises();
  assert.equal(requestUrls.length, beforeMonthChange + 1);
  assert.match(requestUrls.at(-1), /year=2026&month=2026-08&page=1&pageSize=20$/);
  assert.equal(list.data.selectedMonth, '2026-08');

  const beforeYearChange = requestUrls.length;
  list.changeYear({ detail: { value: 1 } });
  await flushPromises();
  assert.equal(requestUrls.length, beforeYearChange + 1);
  assert.match(requestUrls.at(-1), /year=2025&page=1&pageSize=20$/);
  assert.equal(list.data.selectedMonth, '');
  assert.equal(list.data.monthIndex, 0);

  let detailConfig = null;
  global.Page = config => { detailConfig = config; };
  freshRequire(path.join(miniRoot, 'pages/my-payslips/detail/index.js'));
  const detail = instantiate(detailConfig);
  detail.onLoad({ id: '31' });
  detail.onShow();
  await flushPromises();

  assert.match(requestUrls.at(-1), /\/me\/payslips\/31$/);
  assert.equal(detail.data.payslip.netAmountText, '¥6,900.00');
  assert.equal(detail.data.incomeItems.length, 8);
  assert.equal(detail.data.deductionItems.length, 3, '金额为0的其他扣款应隐藏');
  assert.equal(detail.data.canSign, true);
  assert.equal(detail.data.canDispute, true);
  detail.goSign();
  assert.equal(navigations.at(-1), '/pages/my-payslips/sign/index?id=31');

  const listWxml = fs.readFileSync(
    path.join(miniRoot, 'components/employee-payslip-list/index.wxml'),
    'utf8'
  );
  assert.match(listWxml, /年份筛选/);
  assert.match(listWxml, /月份筛选/);
  assert.match(listWxml, /bindchange="changeMonth"/);
  assert.match(listWxml, /displayStatus/);
  assert.match(listWxml, /netAmountText/);
  assert.match(listWxml, /bindtap="openDetail"/);
  assert.match(listWxml, /点击重试/);

  const detailWxml = fs.readFileSync(
    path.join(miniRoot, 'pages/my-payslips/detail/index.wxml'),
    'utf8'
  );
  const detailJs = fs.readFileSync(
    path.join(miniRoot, 'pages/my-payslips/detail/index.js'),
    'utf8'
  );
  for (const label of [
    '基本工资', '岗位工资', '绩效工资', '补贴', '计件工资',
    '1.5倍加班', '2倍加班', '3倍加班', '社保扣款', '个人所得税',
    '工资预支', '其他扣款', '应发工资', '实发工资', '确认并签收', '工资有异议'
  ]) {
    assert.match(detailWxml + detailJs, new RegExp(label), `详情页缺少字段：${label}`);
  }
  assert.doesNotMatch(detailWxml, /scroll-x|white-space:\s*nowrap/, '工资详情必须保持全竖屏');

  const appJson = JSON.parse(fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8'));
  assert.ok(appJson.pages.includes('pages/my-payslips/detail/index'));
  assert.ok(appJson.pages.includes('pages/my-payslips/sign/index'));

  const payrollWxml = fs.readFileSync(path.join(miniRoot, 'pages/payroll/index.wxml'), 'utf8');
  const payrollJson = JSON.parse(fs.readFileSync(path.join(miniRoot, 'pages/payroll/index.json'), 'utf8'));
  assert.match(payrollWxml, /employee-payslip-list/);
  assert.ok(Object.values(payrollJson.usingComponents || {}).includes('/components/employee-payslip-list/index'));

  console.log('miniprogram-employee-payslips-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
