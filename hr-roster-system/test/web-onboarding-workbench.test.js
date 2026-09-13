const assert = require('node:assert/strict');

const {
  getEmployeeEntryPresentation,
  calculateEmployeeEntryCompletion
} = require('../public/js/core/onboarding-workbench');

const interview = getEmployeeEntryPresentation(6);
assert.equal(interview.mode, 'interview', '状态 6 必须使用面试简登模式');
assert.deepEqual(interview.requiredFields, ['name'], '面试简登只能强制姓名');
assert.equal(interview.primaryAction, '保存面试人员', '面试简登按钮必须说明保存去向');
assert.equal(interview.showPlacement, false, '面试简登不应铺开派驻与用工信息');

const direct = getEmployeeEntryPresentation(1);
assert.equal(direct.mode, 'direct', '状态 1 必须使用直接入职模式');
assert.deepEqual(
  direct.requiredFields,
  ['name', 'idCardNo', 'customerId', 'positionId'],
  '直接入职必须保留身份和派驻核心必填项'
);
assert.equal(direct.primaryAction, '保存并进入待到岗', '直接入职不得暗示直接变为在职');
assert.equal(direct.showPlacement, true, '直接入职必须展示派驻与用工信息');

assert.equal(
  calculateEmployeeEntryCompletion({ name: '张三' }, interview),
  100,
  '面试简登填写姓名后应显示资料已满足当前步骤'
);
assert.equal(
  calculateEmployeeEntryCompletion({ name: '张三', idCardNo: '3201' }, direct),
  50,
  '直接入职完整度应按当前模式必填项计算'
);
assert.equal(calculateEmployeeEntryCompletion({}, direct), 0, '空表单完整度必须为 0');

console.log('web-onboarding-workbench-tests-ok');
