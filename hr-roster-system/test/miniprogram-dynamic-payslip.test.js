const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const miniRoot = path.join(root, 'wechat-miniprogram/miniprogram');
const detailPath = path.join(miniRoot, 'pages/my-payslips/detail/index.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function instantiate(config) {
  const instance = {
    data: clone(config.data || {}),
    setData(patch) { Object.assign(this.data, patch); }
  };
  Object.entries(config).forEach(([name, method]) => {
    if (typeof method === 'function') instance[name] = method.bind(instance);
  });
  return instance;
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  let payload = {
    id: 31,
    salaryMonth: '2026-08',
    grossAmount: 5110,
    netAmount: 4960,
    receiptStatus: 1,
    items: [
      { label: '全勤奖', value: 0, category: 'income', sortOrder: 1 },
      { label: '夜班奖', value: 380, category: 'income', sortOrder: 2 },
      { label: '住宿扣款', value: 150, category: 'deduction', sortOrder: 3 },
      { label: '实发工资', value: 4960, category: 'summary', sortOrder: 4 },
      { label: '班组', value: 'A组', category: 'display', sortOrder: 5 }
    ]
  };
  global.wx = {
    getStorageSync(key) {
      if (key === 'youyi_hr_token') return 'employee-token';
      if (key === 'youyi_hr_user') return { id: 91, companyId: 7, employeeId: 1001, accountType: 'EMPLOYEE' };
      return '';
    },
    request(options) {
      options.success({ statusCode: 200, data: { code: 0, data: payload } });
    },
    showToast() {},
    navigateTo() {}
  };
  let config = null;
  global.Page = value => { config = value; };
  delete require.cache[require.resolve(detailPath)];
  require(detailPath);

  const dynamicPage = instantiate(config);
  dynamicPage.onLoad({ id: '31' });
  dynamicPage.onShow();
  await flushPromises();
  assert.equal(dynamicPage.data.usesDynamicItems, true);
  assert.deepEqual(dynamicPage.data.incomeItems.map(item => item.label), ['全勤奖', '夜班奖'], '动态工资条应保留原表全部收入列');
  assert.equal(dynamicPage.data.incomeItems[0].value, 0, '原表为0的收入列也必须展示');
  assert.equal(dynamicPage.data.incomeItems[0].valueText, '¥0.00');
  assert.equal(dynamicPage.data.deductionItems[0].value, 150, '扣款显示负号不能修改接口原值');
  assert.equal(dynamicPage.data.deductionItems[0].valueText, '¥150.00');
  assert.equal(dynamicPage.data.summaryItems[0].valueText, '¥4,960.00');
  assert.equal(dynamicPage.data.displayItems[0].valueText, 'A组');

  payload = {
    id: 30,
    salaryMonth: '2026-07',
    baseSalary: 4000,
    grossAmount: 4000,
    socialDeduction: 300,
    netAmount: 3700,
    receiptStatus: 1,
    items: []
  };
  const historicalPage = instantiate(config);
  historicalPage.onLoad({ id: '30' });
  historicalPage.onShow();
  await flushPromises();
  assert.equal(historicalPage.data.usesDynamicItems, false);
  assert.equal(historicalPage.data.incomeItems.length, 1, '静态回退分支金额为0的收入项应隐藏');
  assert.equal(historicalPage.data.deductionItems.length, 1, '静态回退分支金额为0的扣款应隐藏');

  const wxml = fs.readFileSync(path.join(miniRoot, 'pages/my-payslips/detail/index.wxml'), 'utf8');
  assert.match(wxml, /summaryItems/);
  assert.match(wxml, /displayItems/);
  assert.match(wxml, /- \{\{item\.valueText\}\}/);
  assert.doesNotMatch(wxml, /scroll-x|white-space:\s*nowrap/);

  console.log('miniprogram-dynamic-payslip-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
