const assert = require('node:assert/strict');
const parser = require('../public/js/core/payroll-import');

const parsed = parser.parseFlexiblePayrollRows([
  ['姓名', '底薪', '夜班奖', '住宿扣款', '实发工资', '班组'],
  ['张三', '4500', '380', '150', '4730', 'A组']
]);

assert.deepStrictEqual(parser.parseDelimitedRows(
  '姓名,实发工资,备注\n张三,5000,"夜班,A组"\n李四,5200,"包含""引号"""\n'
), [
  ['姓名', '实发工资', '备注'],
  ['张三', '5000', '夜班,A组'],
  ['李四', '5200', '包含"引号"']
], 'CSV 引号内的逗号和双引号不得造成工资列错位');

assert.deepStrictEqual(parser.parseDelimitedRows(
  '姓名;实发工资;备注\n张三;5000;"夜班;A组"\n'
), [
  ['姓名', '实发工资', '备注'],
  ['张三', '5000', '夜班;A组']
], '分号分隔的工资 CSV 应自动识别且不拆分引号内容');

assert.deepStrictEqual(parsed.rows[0].itemSnapshot, [
  { label: '底薪', value: '4500', category: 'display', sortOrder: 1 },
  { label: '夜班奖', value: '380', category: 'display', sortOrder: 2 },
  { label: '住宿扣款', value: '150', category: 'display', sortOrder: 3 },
  { label: '实发工资', value: '4730', category: 'display', sortOrder: 4 },
  { label: '班组', value: 'A组', category: 'display', sortOrder: 5 }
]);
assert.equal(parsed.rows[0].grossAmount, 0, '未上传应发工资时不得用实发工资自动补写');
assert.equal(parsed.rows[0].otherDeduction, 0, '展示项不得参与系统扣款汇总');
assert.equal(parsed.rows[0].netAmount, 4730);
assert.deepStrictEqual(parsed.rows[0].errors, []);
assert.ok(!parsed.rows[0].itemSnapshot.some(item => item.label === '姓名'), '身份字段不得进入工资条快照');
assert.ok(parsed.rows[0].itemSnapshot.every(item => item.category === 'display'),
  '上传的所有非身份字段都必须作为展示项保存');
assert.deepStrictEqual(parsed.rows[0].warnings, [], '上传工资条不得提示金额关系异常');

const realProjectSheet = parser.parseFlexiblePayrollRows([
  ['姓名', '部门', '岗位', '出勤天数', '上班工时', '基本工资', '岗位工资', '加班工资', '绩效工资', '全勤奖', '交通补贴', '养老补贴', '应发合计', '考勤扣款', '个税代扣', '其他扣款', '实发'],
  ['赵聚相', '生产部', '橡胶主管', 29, 319, 2180, 1000, 2200, 820, 300, 500, 1000, 8000, 0, 90, 0, 7910]
]);
assert.equal(realProjectSheet.rows[0].grossAmount, 8000, '明确提供应发合计时必须保留原表金额');
assert.equal(realProjectSheet.rows[0].netAmount, 7910, '明确提供实发金额时必须保留原表金额');
assert.equal(realProjectSheet.rows[0].otherDeduction, 0, '展示项不得参与系统扣款汇总');
assert.deepStrictEqual(realProjectSheet.rows[0].errors, []);
assert.equal(realProjectSheet.columnMapping.find(item => item.sourceHeader === '出勤天数').category, 'display',
  '出勤天数不得自动识别为收入');
assert.equal(realProjectSheet.columnMapping.find(item => item.sourceHeader === '上班工时').category, 'display',
  '上班工时不得自动识别为收入');
assert.ok(!realProjectSheet.rows[0].warnings.some(message => /按收入明细计算/.test(message)),
  '明确提供应发合计时不得再用明细覆盖');

const mapping = parser.buildSuggestedMapping(
  ['员工姓名', '自定义奖励', '实领工资'],
  [['李四', '200', '5200']]
);
assert.deepStrictEqual(mapping.map(item => [item.target, item.category, item.includeInPayslip]), [
  ['employeeName', '', false],
  ['custom', 'display', true],
  ['netAmount', 'display', true]
]);
assert.doesNotThrow(() => parser.validateColumnMapping(mapping));

const customCategories = parser.buildSuggestedMapping(
  ['姓名', '收入项目', '扣除项目', '实际到账'],
  [['赵七', '1000', '100', '900']]
);
assert.equal(customCategories[1].category, 'display', '自定义收入项目应按原表内容展示');
assert.equal(customCategories[2].category, 'display', '自定义扣除项目应按原表内容展示');
assert.equal(customCategories[3].target, 'netAmount', '实际到账应自动识别为实发工资');

const duplicateNetHeaders = parser.parseFlexiblePayrollRows([
  ['名字', '手机号', '工时', '餐费扣款', '生产扣款', '基本工资', '加班', '考勤扣款',
    '社保补贴', '实发工资', '商保', '税前工资', '税点', '税后工资', '住宿费', '实发工资', '备注'],
  ['赵八', '13800138000', '176', '100', '50', '4000', '600', '0',
    '300', '4750', '80', '4670', '10', '4660', '200', '4460', '正常']
]);
assert.equal(duplicateNetHeaders.rows.length, 1, '重复实发工资表头不应导致整张工作表无法解析');
assert.equal(duplicateNetHeaders.rows[0].netAmount, 4460, '最右侧实发工资应作为最终发放金额');
assert.deepEqual(
  duplicateNetHeaders.columnMapping.filter(item => item.sourceHeader === '实发工资').map(item => [item.target, item.category]),
  [['custom', 'display'], ['netAmount', 'display']],
  '前面的同名实发工资应保留为展示项，最右侧作为最终实发金额'
);
assert.deepEqual(
  duplicateNetHeaders.rows[0].itemSnapshot.filter(item => item.label === '实发工资').map(item => item.value),
  ['4750', '4460'],
  '两个原始实发工资值都应保留在工资条明细中'
);

const duplicateGrossHeaders = parser.parseFlexiblePayrollRows([
  ['名字', '手机号', '工时', '餐费扣款', '生产扣款', '基本工资', '加班', '考勤扣款',
    '社保补贴', '应发工资', '商保', '税前工资', '税点', '税后工资', '住宿费', '实发工资', '备注'],
  ['赵九', '13800138001', '176', '100', '50', '4000', '600', '0',
    '300', '4750', '80', '4670', '10', '4660', '200', '4460', '正常']
]);
assert.equal(duplicateGrossHeaders.rows[0].grossAmount, 4750, '最左侧明确的应发工资应作为应发金额');
assert.deepEqual(
  duplicateGrossHeaders.columnMapping.filter(item => ['应发工资', '税前工资'].includes(item.sourceHeader))
    .map(item => [item.sourceHeader, item.target, item.category]),
  [['应发工资', 'grossAmount', 'display'], ['税前工资', 'custom', 'display']],
  '税前工资与应发工资冲突时应保留为展示项，不能阻止工资表解析'
);
assert.deepEqual(
  duplicateGrossHeaders.rows[0].itemSnapshot.filter(item => ['应发工资', '税前工资'].includes(item.label))
    .map(item => [item.label, item.value]),
  [['应发工资', '4750'], ['税前工资', '4670']],
  '应发工资和税前工资原始值都应保留在工资条明细中'
);

assert.throws(
  () => parser.validateColumnMapping(mapping.filter(item => item.target !== 'netAmount')),
  /必须且只能指定一列实发工资/
);
assert.throws(
  () => parser.validateColumnMapping([
    ...mapping,
    { columnIndex: 3, sourceHeader: '备用姓名', target: 'employeeName', category: '', includeInPayslip: false }
  ]),
  /关键字段.*重复/
);

const formula = parser.parseFlexiblePayrollRows([
  ['姓名', '自定义奖金', '实发工资'],
  ['王五', '=SUM(A1:A2)', '5000']
]);
assert.match(formula.rows[0].errors.join('；'), /不能使用公式/);

assert.throws(
  () => parser.buildSuggestedMapping(['姓名', '超'.repeat(51), '实发工资'], [['赵六', '100', '5100']]),
  /工资项目名称最多50个字符/
);

const tooManyItems = [
  { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
  { columnIndex: 1, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true },
  ...Array.from({ length: 80 }, (_, index) => ({
    columnIndex: index + 2,
    sourceHeader: `项目${index + 1}`,
    target: 'custom',
    category: 'income',
    includeInPayslip: true
  }))
];
assert.throws(() => parser.validateColumnMapping(tooManyItems), /单人工资项目最多80项/);

console.log('payroll-dynamic-import-parser-tests-ok');
