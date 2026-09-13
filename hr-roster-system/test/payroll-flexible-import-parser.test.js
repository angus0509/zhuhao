const assert = require('node:assert/strict');

const parser = require('../public/js/core/payroll-import');

function main() {
  const rows = [
    ['某制造项目2026年8月工资表'],
    ['制表日期', '2026-08-10'],
    ['员工姓名', '实发合计', '备注信息', '身份证号码', '应发工资', '社保个人部分', '个税', '预支款'],
    ['张三', '6900', '夜班员工', '320101199001011234', '8150', '680', '70', '500'],
    ['李四', 7200, '', '320101199002022345', 8000, 600, 100, 100]
  ];
  const result = parser.parseFlexiblePayrollRows(rows);
  assert.equal(result.headerRowIndex, 2, '应自动跳过标题和制表日期说明行');
  assert.equal(result.rows.length, 2);
  assert.equal(result.ignoredColumnCount, 0, '额外备注列不应再被忽略');
  assert.deepEqual(
    result.rows[0].itemSnapshot.find(item => item.label === '备注信息'),
    { label: '备注信息', value: '夜班员工', category: 'display', sortOrder: 2 },
    '项目自定义文本列应按原名进入工资条展示项'
  );
  assert.equal(result.rows[0].employeeName, '张三');
  assert.equal(result.rows[0].idCardNo, '320101199001011234');
  assert.equal(result.rows[0].baseSalary, 8150, '仅有应发合计时应归入基本工资形成可计算结构');
  assert.equal(result.rows[0].socialDeduction, 680);
  assert.equal(result.rows[0].taxDeduction, 70);
  assert.equal(result.rows[0].advanceDeduction, 500);
  assert.equal(result.rows[0].otherDeduction, 0);
  assert.equal(result.rows[0].netAmount, 6900);
  assert.deepEqual(result.rows[0].errors, []);

  const detailed = parser.parseFlexiblePayrollRows([
    ['手机号', '绩效', '姓名', '岗位工资', '底薪', '加班1.5倍', '补助', '其他扣款'],
    ['13800138000', '300', '王五', '500', '3500', '240', '200', '40']
  ]);
  assert.equal(detailed.rows[0].phone, '13800138000');
  assert.equal(detailed.rows[0].baseSalary, 3500);
  assert.equal(detailed.rows[0].positionSalary, 500);
  assert.equal(detailed.rows[0].performanceSalary, 300);
  assert.equal(detailed.rows[0].allowanceAmount, 200);
  assert.equal(detailed.rows[0].overtime15Amount, 240);
  assert.equal(detailed.rows[0].otherDeduction, 40);

  const withEmployeeNo = parser.parseFlexiblePayrollRows([
    ['其他列', '人员编号', '计件金额', '实付工资'],
    ['可忽略', 'YG0001', '5000', '4800']
  ]);
  assert.equal(withEmployeeNo.rows[0].employeeNo, 'YG0001');
  assert.equal(withEmployeeNo.rows[0].pieceAmount, 5000);
  assert.equal(withEmployeeNo.rows[0].otherDeduction, 0,
    '提供实发金额时应保留原表扣款明细，不得自动补写');
  assert.equal(withEmployeeNo.rows[0].warnings.length, 0,
    '仅有应发和实发、未提供扣款明细时，不应误提示金额异常');

  assert.throws(
    () => parser.parseFlexiblePayrollRows([['姓名', '备注'], ['张三', '无工资字段']]),
    /未识别到工资金额列/
  );
  assert.throws(
    () => parser.parseFlexiblePayrollRows([['基本工资', '绩效'], ['3000', '500']]),
    /未识别到员工身份列/
  );
  const formula = parser.parseFlexiblePayrollRows([['姓名', '基本工资'], ['张三', '=SUM(A1:A2)']]);
  assert.match(formula.rows[0].errors.join('；'), /不能使用公式/);

  const currencyFormats = parser.parseFlexiblePayrollRows([
    ['姓名', '基本工资', '住宿扣款', '实发工资'],
    ['钱七', '¥8,000.00', '200 元', 'RMB 7,800']
  ]);
  assert.equal(currencyFormats.rows[0].baseSalary, 8000, '应识别人民币符号和千分位金额');
  assert.equal(currencyFormats.rows[0].otherDeduction, 200, '应识别带元后缀的扣款金额');
  assert.equal(currencyFormats.rows[0].netAmount, 7800, '应识别 RMB 前缀的实发金额');

  assert.equal(parser.normalizeHeader(' 1.5倍加班费（元） '), '15倍加班费');
  assert.equal(parser.normalizeHeader('身份证号/证件号码'), '身份证号证件号码');
  assert.equal(parser.normalizeHeader('\uFEFF员工姓名'), '员工姓名', 'CSV BOM 不应影响表头识别');

  const withTotalRow = parser.parseFlexiblePayrollRows([
    ['姓名', '应发工资', '实发工资'],
    ['赵六', '5000', '4700'],
    ['合计', '5000', '4700']
  ]);
  assert.equal(withTotalRow.rows.length, 1, '工资表末尾合计行不应被当成员工工资');
  assert.equal(withTotalRow.ignoredSummaryRowCount, 1);

  const multiAllowanceAndDeduction = parser.parseFlexiblePayrollRows([
    ['姓名', '底薪', '餐补', '夜班补贴', '全勤奖', '住宿费', '水电费', '实领工资'],
    ['孙七', '4000', '300', '200', '100', '150', '50', '4400']
  ]);
  assert.equal(multiAllowanceAndDeduction.rows[0].allowanceAmount, 600,
    '多个补贴、奖金列应合并为补贴金额');
  assert.equal(multiAllowanceAndDeduction.rows[0].otherDeduction, 200,
    '多个杂项扣款列应合并为其他扣款');
  assert.equal(multiAllowanceAndDeduction.rows[0].grossAmount, 4600);
  assert.equal(multiAllowanceAndDeduction.rows[0].netAmount, 4400);

  const twoLevelHeader = parser.parseFlexiblePayrollRows([
    ['工号', '姓名', '工资收入', '', '个人扣款'],
    ['', '', '基本工资', '夜班补贴', '水电费'],
    ['YG0099', '周八', '4200', '300', '100']
  ]);
  assert.equal(twoLevelHeader.headerRowIndex, 0, '应识别两层合并表头的起始行');
  assert.equal(twoLevelHeader.headerRowCount, 2, '应记录两层表头，数据从第二层表头之后开始');
  assert.equal(twoLevelHeader.rows.length, 1);
  assert.equal(twoLevelHeader.rows[0].employeeNo, 'YG0099');
  assert.equal(twoLevelHeader.rows[0].employeeName, '周八');
  assert.equal(twoLevelHeader.rows[0].baseSalary, 4200);
  assert.equal(twoLevelHeader.rows[0].allowanceAmount, 300);
  assert.equal(twoLevelHeader.rows[0].otherDeduction, 100);
  console.log('payroll-flexible-import-parser-tests-ok');
}

main();
