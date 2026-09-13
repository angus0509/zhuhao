const assert = require('node:assert/strict');

const parser = require('../public/js/core/payroll-import');

function main() {
  // 1. 双层表头：上层「应发合计」是 grossAmount 别名，叶子「基本工资」不应被污染
  const composite = parser.parseFlexiblePayrollRows([
    ['工号', '姓名', '应发合计', '', '个人扣款', '实发'],
    ['', '', '基本工资', '岗位工资', '社保', ''],
    ['YG001', '张三', '2180', '1000', '500', '2680']
  ]);
  assert.equal(composite.headerRowCount, 2, '应识别双层表头');
  assert.equal(composite.rows[0].employeeNo, 'YG001');
  assert.equal(composite.rows[0].employeeName, '张三');
  assert.equal(composite.rows[0].baseSalary, 2180, '基本工资应识别为基本工资而非应发合计');
  assert.equal(composite.rows[0].positionSalary, 1000);
  assert.equal(composite.rows[0].socialDeduction, 500);
  assert.equal(composite.rows[0].grossAmount, 3180, '应发合计由收入明细汇总');
  assert.equal(composite.rows[0].netAmount, 2680);

  // 2. 三层表头：叶子行是完整别名，上层分组名不干扰字段识别
  const three = parser.parseFlexiblePayrollRows([
    ['', '', '工资合计', '', '', '', '代扣', '', ''],
    ['', '', '应发合计', '', '', '', '个人扣款', '', ''],
    ['工号', '姓名', '基本工资', '岗位工资', '绩效工资', '补贴', '社保', '个税', '预支'],
    ['YG002', '李四', '2180', '1000', '820', '300', '500', '90', '100']
  ]);
  assert.equal(three.rows[0].employeeNo, 'YG002');
  assert.equal(three.rows[0].employeeName, '李四');
  assert.equal(three.rows[0].baseSalary, 2180);
  assert.equal(three.rows[0].positionSalary, 1000);
  assert.equal(three.rows[0].performanceSalary, 820);
  assert.equal(three.rows[0].allowanceAmount, 300);
  assert.equal(three.rows[0].socialDeduction, 500);
  assert.equal(three.rows[0].taxDeduction, 90);

  // 3. 底行单位行「元」应被跳过，不进入字段识别
  const unit = parser.parseFlexiblePayrollRows([
    ['姓名', '基本工资', '实发工资'],
    ['', '元', '元'],
    ['张三', '4000', '3700']
  ]);
  assert.equal(unit.rows[0].employeeName, '张三');
  assert.equal(unit.rows[0].baseSalary, 4000);

  console.log('payroll-composite-header-tests-ok');
}

main();
