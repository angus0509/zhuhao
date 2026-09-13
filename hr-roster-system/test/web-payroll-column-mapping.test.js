const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mappingService = require('../public/js/core/payroll-column-mapping');

const headers = ['姓名', '夜班奖', '住宿扣款', '实发工资'];
const suggested = [
  { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
  { columnIndex: 1, sourceHeader: '夜班奖', target: 'custom', category: 'income', includeInPayslip: true },
  { columnIndex: 2, sourceHeader: '住宿扣款', target: 'custom', category: 'deduction', includeInPayslip: true },
  { columnIndex: 3, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true }
];
const signature = 'c'.repeat(64);

const exactProfile = {
  headerSignature: signature,
  sourceHeaders: headers,
  mapping: suggested.map(item => ({ ...item }))
};
assert.deepEqual(
  mappingService.selectReusableMapping({ headers, headerSignature: signature, profile: exactProfile, suggestedMapping: [] }),
  exactProfile.mapping,
  '同项目、同表头签名和列数应复用历史映射'
);
assert.deepEqual(
  mappingService.selectReusableMapping({ headers, headerSignature: 'd'.repeat(64), profile: exactProfile, suggestedMapping: suggested }),
  suggested,
  '表头签名变化时不得复用旧映射'
);
assert.deepEqual(
  mappingService.selectReusableMapping({ headers: headers.slice(0, 3), headerSignature: signature, profile: exactProfile, suggestedMapping: suggested.slice(0, 3) }),
  suggested.slice(0, 3),
  '列数变化时不得复用旧映射'
);
assert.equal(mappingService.mappingRequiresReview(suggested), false);
assert.equal(mappingService.mappingRequiresReview(suggested.filter(item => item.target !== 'netAmount')), true);
assert.equal(mappingService.mappingRequiresReview(suggested.filter(item => item.target !== 'employeeName')), true);
assert.equal(mappingService.shouldKeepPanelOpen(true, false), true, '人工展开后修改列用途不得自动收起');
assert.equal(mappingService.shouldKeepPanelOpen(false, true), true, '关键字段未解决时必须自动展开');
assert.equal(mappingService.shouldKeepPanelOpen(false, false), false);
assert.deepEqual(mappingService.applyMappingChoice(suggested[1], 'custom:display'), {
  columnIndex: 1,
  sourceHeader: '夜班奖',
  target: 'custom',
  category: 'display',
  includeInPayslip: true
});

const template = {
  mapping: [
    { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
    { columnIndex: 1, sourceHeader: '基本工资', target: 'baseSalary', category: 'income', includeInPayslip: true },
    { columnIndex: 2, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true }
  ]
};
const shuffledHeaders = ['实发工资', '姓名', '加班补贴', '基本工资'];
const shuffledSuggested = [
  { columnIndex: 0, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true },
  { columnIndex: 1, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
  { columnIndex: 2, sourceHeader: '加班补贴', target: 'custom', category: 'income', includeInPayslip: true },
  { columnIndex: 3, sourceHeader: '基本工资', target: 'baseSalary', category: 'income', includeInPayslip: true }
];
const applied = mappingService.applyTemplateMapping(template, shuffledHeaders, shuffledSuggested);
assert.deepEqual(applied.map(item => item.target), ['netAmount', 'employeeName', 'custom', 'baseSalary'], '模板应按表头名匹配而非列号');
assert.deepEqual(applied.map(item => item.sourceHeader), ['实发工资', '姓名', '加班补贴', '基本工资']);
assert.equal(applied[0].target, 'netAmount');
assert.equal(applied[1].target, 'employeeName');
assert.equal(applied[2].target, 'custom', '模板未覆盖的列应回退自动建议');
assert.equal(applied[2].category, 'income');
assert.equal(applied[3].target, 'baseSalary');
assert.deepEqual(mappingService.applyTemplateMapping({ mapping: [] }, [], []), []);

const html = read('public/index.html');
const app = read('public/app.js');
const styles = read('public/styles.css');
assert.match(html, /src="\/js\/core\/payroll-column-mapping\.js"[^>]*defer/);
assert.match(html, /id="payrollMappingPanel"/);
assert.match(html, /id="payrollMappingRows"/);
assert.match(html, /id="payrollCsvExampleButton"/);
assert.match(html, /id="payrollXlsxExampleButton"/);
assert.match(app, /crypto\.subtle\.digest\(['"]SHA-256['"]/);
assert.match(app, /\/api\/payroll\/import-profiles\?projectId=/);
assert.match(app, /PayrollColumnMapping\.selectReusableMapping/);
assert.match(app, /PayrollImport\.parseMappedPayrollRows/);
assert.match(app, /data-payroll-mapping-choice/);
assert.match(app, /columnMapping:\s*state\.payrollImport\.suggestedMapping/, '切换项目时必须回到原始自动建议，不能沿用上一项目映射');
assert.match(styles, /\.payroll-mapping-panel/);

console.log('web-payroll-column-mapping-tests-ok');
