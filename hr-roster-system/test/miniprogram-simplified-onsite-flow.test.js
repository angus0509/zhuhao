const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const listJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const listWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');

for (const stage of ['全部人员', '待到岗', '在职员工', '已离职']) {
  assert.match(listWxml, new RegExp(stage), `驻厂状态栏缺少：${stage}`);
}
assert.doesNotMatch(listWxml, /data-stage="unjoined"|data-stage="offboarding"/, '驻厂状态栏仍显示未入职或离职办理');
assert.doesNotMatch(listWxml, /filterByInsurance|雇主险状态/, '驻厂主页面仍保留独立雇主险筛选入口');

assert.match(listWxml, /isPending[\s\S]*确认入职[\s\S]*未入职/, '待到岗员工卡缺少两个明确操作');
assert.match(listWxml, /isActive[\s\S]*一键办理离职/, '在职员工卡缺少一键离职操作');
assert.doesNotMatch(listWxml, /一键确认合同和雇主险|未通过\/不做/, '驻厂页仍保留已取消的合规或面试操作');

assert.match(listJs, /handleArrivalResult[\s\S]*\/arrival-result/, '小程序未调用待到岗结果接口');
assert.match(listJs, /UNJOINED/, '小程序未处理待到岗未入职');
assert.match(listJs, /markDirty\('employees', 'home', 'tasks', 'advances'\)/, '状态操作后未同步刷新相关页面');
assert.doesNotMatch(homeJs, /ONBOARDING_COMPLIANCE|\/work-tasks/, '工作台仍加载合规待办');

console.log('miniprogram-simplified-onsite-flow-tests-ok');
