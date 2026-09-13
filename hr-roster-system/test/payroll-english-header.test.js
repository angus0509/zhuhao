const assert = require('node:assert/strict');

const parser = require('../public/js/core/payroll-import');

function main() {
  // 1. 英文标准字段映射
  const std = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Basic Salary', 'Position Salary', 'Gross Pay', 'Tax', 'Net Pay'],
    ['John Doe', '4000', '1000', '5000', '200', '4800']
  ]);
  assert.equal(std.rows[0].employeeName, 'John Doe');
  assert.equal(std.rows[0].baseSalary, 4000);
  assert.equal(std.rows[0].positionSalary, 1000);
  assert.equal(std.rows[0].grossAmount, 5000);
  assert.equal(std.rows[0].taxDeduction, 200);
  assert.equal(std.rows[0].netAmount, 4800);

  // 2. 英文加班费（带 x 的写法）
  const ot = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Overtime 1.5x', 'Net Pay'],
    ['Bob', '100', '100']
  ]);
  assert.equal(ot.rows[0].overtime15Amount, 100, 'Overtime 1.5x 应识别为 1.5 倍加班费');

  // 3. 未收录英文收入列按关键词归为 income
  const housing = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Basic Salary', 'Housing Allowance', 'Net Pay'],
    ['Jane', '3000', '500', '3500']
  ]);
  assert.equal(housing.rows[0].allowanceAmount, 500, 'Housing Allowance 应归为收入计入补贴');

  // 4. 未收录英文扣款列按关键词归为 deduction
  const loan = parser.parseFlexiblePayrollRows([
    ['Employee Name', 'Basic Salary', 'Loan Deduction', 'Net Pay'],
    ['Tim', '3000', '200', '2800']
  ]);
  assert.equal(loan.rows[0].otherDeduction, 200, 'Loan Deduction 应归为其他扣款');

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
assert.equal(commonChineseAliases.rows[0].taxDeduction, 500, '应识别代扣个税为个税扣款');
assert.equal(commonChineseAliases.rows[0].netAmount, 8500, '应识别实际发放为实发金额');

console.log('payroll-english-header-tests-ok');
}

main();
