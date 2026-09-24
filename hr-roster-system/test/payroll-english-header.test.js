const assert = require('node:assert/strict');

const parser = require('../public/js/core/payroll-import');

function main() {
  // 1. 英文标准字段映射
  const std = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Basic Salary', 'Position Salary', 'Gross Pay', 'Tax', 'Net Pay'],
    ['John Doe', '4000', '1000', '5000', '200', '4800']
  ]);
  assert.equal(std.rows[0].employeeName, 'John Doe');
  assert.equal(std.rows[0].baseSalary, 0, '基本工资仅按原表展示，不得参与系统计算字段');
  assert.equal(std.rows[0].positionSalary, 0, '展示列不得参与内部工资重算');
  assert.equal(std.rows[0].grossAmount, 5000);
  assert.equal(std.rows[0].taxDeduction, 0, '展示列不得参与内部扣款重算');
  assert.equal(std.rows[0].netAmount, 4800);
  assert.deepEqual(std.rows[0].itemSnapshot.map(item => [item.label, item.value, item.category]), [
    ['Basic Salary', '4000', 'display'],
    ['Position Salary', '1000', 'display'],
    ['Gross Pay', '5000', 'display'],
    ['Tax', '200', 'display'],
    ['Net Pay', '4800', 'display']
  ]);

  // 2. 英文加班费（带 x 的写法）
  const ot = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Overtime 1.5x', 'Net Pay'],
    ['Bob', '100', '100']
  ]);
  assert.equal(ot.columnMapping[1].target, 'overtime15Amount', 'Overtime 1.5x 应识别为 1.5 倍加班费展示列');
  assert.equal(ot.rows[0].itemSnapshot[0].value, '100');

  // 3. 未收录英文收入列按关键词归为 income
  const housing = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Basic Salary', 'Housing Allowance', 'Net Pay'],
    ['Jane', '3000', '500', '3500']
  ]);
  assert.equal(housing.columnMapping[2].target, 'custom', 'Housing Allowance 应作为自定义展示列保留');
  assert.equal(housing.rows[0].itemSnapshot[1].value, '500');

  // 4. 未收录英文扣款列按关键词归为 deduction
  const loan = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Basic Salary', 'Loan Deduction', 'Net Pay'],
    ['Tim', '3000', '200', '2800']
  ]);
  assert.equal(loan.columnMapping[2].target, 'custom', 'Loan Deduction 应作为自定义展示列保留');
  assert.equal(loan.rows[0].itemSnapshot[1].value, '200');

  // 5. 英文敏感列应被忽略，不进工资条
const bank = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Basic Salary', 'Bank Account', 'Net Pay'],
    ['Tom', '3000', '6222021234567890', '3000']
  ]);
  assert.equal(bank.ignoredColumnCount, 1, 'Bank Account 应作为敏感列忽略');
assert.equal(bank.rows[0].itemSnapshot.some(item => item.label === 'Bank Account'), false);

const commonChineseAliases = parser.parseFlexiblePayrollRows([
  ['员工姓名', '应付工资', '代扣个税', '实际发放'],
  ['别名测试', '9000', '500', '8500']
]);
assert.equal(commonChineseAliases.rows[0].grossAmount, 9000, '应识别应付工资为应发金额');
assert.equal(commonChineseAliases.rows[0].taxDeduction, 0, '代扣个税仅作为原表展示项');
assert.equal(commonChineseAliases.rows[0].netAmount, 8500, '应识别实际发放为实发金额');

console.log('payroll-english-header-tests-ok');
}

main();
