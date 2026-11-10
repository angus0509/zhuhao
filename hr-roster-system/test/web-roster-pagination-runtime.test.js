const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/views/roster.js'), 'utf8');

function classList() {
  return { add() {}, remove() {}, toggle() {} };
}

function element(value = '') {
  return {
    value,
    href: '',
    innerHTML: '',
    classList: classList(),
    addEventListener() {},
    querySelector() { return null; }
  };
}

const elements = {
  '#statusSelect': element('2'),
  '#exportLink': element(),
  '#exportXlsxLink': element(),
  '.main-panel .table-wrap': element(),
  '#employeeTableBody': element(),
  '#rosterView': element(),
  '#detailContent': element(),
  '#emptyDetail': element(),
  '#customerRosterRail': element(),
  '#rosterPagination': element()
};

const requests = [];
const employees = Array.from({ length: 50 }, (_, index) => ({
  id: index + 1,
  name: `员工${index + 1}`,
  genderName: '男',
  education: '高中',
  idCardNo: '320***********0000',
  phone: '138****0000',
  customerId: 10,
  customerName: '客户A',
  positionName: '操作工',
  workTypeName: '小时工',
  hireDate: '2026-01-01',
  contractPeriod: '-',
  employmentTypeName: '劳务派遣',
  feeModeName: '-',
  employeeStatus: 2,
  employeeStatusName: '在职',
  lifecycleStatus: 'ACTIVE',
  riskCount: 0,
  remark: ''
}));

const context = vm.createContext({
  console,
  URLSearchParams,
  state: {
    employees: [],
    employeePage: 1,
    employeePageSize: 50,
    employeeTotal: 0,
    employeeCustomerStats: [],
    selectedEmployeeId: null,
    selectedDetail: null,
    rosterViewMode: 'list',
    user: { permissions: [] }
  },
  $: selector => elements[selector] || null,
  $$: () => [],
  getQueryString: () => 'employeeStatus=2',
  api: async url => {
    requests.push(url);
    return {
      page: Number(new URL(`https://example.test${url}`).searchParams.get('page')),
      pageSize: 50,
      total: 1080,
      list: employees,
      customerStats: [
        { customerId: 10, customerName: '客户A', activeCount: 800, riskCount: 2 },
        { customerId: 20, customerName: '客户B', activeCount: 280, riskCount: 0 }
      ]
    };
  },
  apiAllPages: async () => {
    throw new Error('花名册不得再调用全量分页读取');
  },
  escapeHtml: value => String(value ?? ''),
  badge: value => value,
  statusTone: () => 'green',
  rosterVisibleColumnCount: () => 17,
  getSortedRosterRows: rows => rows,
  finalizeRosterTableRender() {},
  toast() {}
});

vm.runInContext(source, context, { filename: 'public/js/views/roster.js' });

async function main() {
  await vm.runInContext('loadEmployees()', context);

  assert.equal(requests.length, 1, '首屏只能请求当前一页');
  assert.match(requests[0], /\/api\/employees\?.*page=1/);
  assert.match(requests[0], /pageSize=50/);
  assert.equal(context.state.employees.length, 50, '1080 人规模时首屏最多渲染 50 人');
  assert.equal(context.state.employeeTotal, 1080, '总人数必须保留用于分页');
  assert.equal((elements['#employeeTableBody'].innerHTML.match(/data-employee-row=/g) || []).length, 50);
  assert.match(elements['#customerRosterRail'].innerHTML, /800<small>人在职<\/small>/, '客户统计必须来自全量汇总而非当前页');
  assert.match(elements['#customerRosterRail'].innerHTML, /风险 2/, '客户卡必须保留风险数');
  assert.doesNotMatch(elements['#customerRosterRail'].innerHTML, /雇主险|保险/, '客户卡仍展示已下线的保险指标');
  assert.match(elements['#rosterPagination'].innerHTML, /共 1080 人/);

  await vm.runInContext('goToRosterPage(2)', context);
  assert.equal(requests.length, 2, '翻页只新增一次当前页请求');
  assert.match(requests[1], /\/api\/employees\?.*page=2/);

  console.log('web-roster-pagination-runtime-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
