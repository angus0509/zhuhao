const assert = require('node:assert/strict');

const workbench = require('../public/js/core/payroll-workbench');

const rows = [
  { employeeName: '张三', phoneMasked: '138****8000', deliveryStatus: '发放成功', displayStatus: '待查看', smsStatusName: '发送成功' },
  { employeeName: '李四', phoneMasked: '139****9001', deliveryStatus: '发放成功', displayStatus: '待签字', smsStatusName: '发送成功' },
  { employeeName: '王五', phoneMasked: '136****2002', deliveryStatus: '发放成功', displayStatus: '已签收', smsStatusName: '发送成功' },
  { employeeName: '赵六', phoneMasked: '137****3003', deliveryStatus: '发放成功', displayStatus: '有异议', smsStatusName: '发送成功' },
  { employeeName: '钱七', phoneMasked: '135****4004', deliveryStatus: '发放失败', displayStatus: '未发布', smsStatusName: '发送失败' },
  { employeeName: '孙八', phoneMasked: '134****5005', deliveryStatus: '未发放', displayStatus: '未发布', smsStatusName: '已取消', smsErrorSummary: '工资条已撤回；原状态：SENT' }
];

assert.equal(workbench.statusKey(rows[0]), 'unviewed');
assert.equal(workbench.statusKey(rows[1]), 'viewed_unsigned');
assert.equal(workbench.statusKey(rows[2]), 'signed');
assert.equal(workbench.statusKey(rows[3]), 'dispute');
assert.equal(workbench.statusKey(rows[4]), 'failed');
assert.equal(workbench.statusKey(rows[5]), 'withdrawn');

assert.deepEqual(
  workbench.filterRows(rows, { status: 'signed', keyword: '' }).map(item => item.employeeName),
  ['王五'],
  '已签收页签只能显示已签收员工'
);
assert.deepEqual(
  workbench.filterRows(rows, { status: 'all', keyword: '9001' }).map(item => item.employeeName),
  ['李四'],
  '员工搜索应支持脱敏手机号尾号'
);
assert.deepEqual(
  workbench.countStatuses(rows),
  { all: 6, pending: 0, unviewed: 1, viewed_unsigned: 1, signed: 1, dispute: 1, failed: 1, withdrawn: 1 }
);

console.log('payroll-workbench-filter-tests-ok');
