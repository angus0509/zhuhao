const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const listJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const listWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const appJson = read('wechat-miniprogram/miniprogram/app.json');
const complianceJs = read('wechat-miniprogram/miniprogram/pages/employees/compliance/index.js');
const complianceWxml = read('wechat-miniprogram/miniprogram/pages/employees/compliance/index.wxml');
const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
const tasksJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');

for (const stage of ['全部人员', '面试', '待到岗', '正常在职', '已离职']) {
  assert.match(listWxml, new RegExp(stage), `驻厂状态栏缺少：${stage}`);
}
assert.doesNotMatch(listWxml, /data-stage="unjoined"|data-stage="offboarding"/, '驻厂状态栏仍显示未入职或离职办理');
assert.doesNotMatch(listWxml, /filterByInsurance|雇主险状态/, '驻厂主页面仍保留独立雇主险筛选入口');

assert.match(listWxml, /isInterview[\s\S]*待到岗[\s\S]*未通过\/不做/, '面试员工卡缺少两个明确操作');
assert.match(listWxml, /isPending[\s\S]*确认入职[\s\S]*未入职/, '待到岗员工卡缺少两个明确操作');
assert.match(listWxml, /isActive[\s\S]*一键确认合同和雇主险[\s\S]*一键办理离职/, '在职员工卡缺少合规与离职操作');

assert.match(listJs, /handleInterviewResult[\s\S]*\/interview-result/, '小程序未调用面试结果接口');
assert.match(listWxml, /data-result="PENDING_ARRIVAL"/, '小程序未处理面试转待到岗');
assert.match(listJs, /handleInterviewResult[\s\S]*REJECTED/, '小程序未处理面试未通过');
assert.match(listJs, /handleArrivalResult[\s\S]*\/arrival-result/, '小程序未调用待到岗结果接口');
assert.match(listJs, /UNJOINED/, '小程序未处理待到岗未入职');
assert.match(listJs, /markDirty\('employees', 'home', 'tasks', 'advances'\)/, '状态操作后未同步刷新相关页面');

assert.match(appJson, /pages\/employees\/compliance\/index/, '小程序未注册合并合规页面');
assert.match(complianceJs, /\/onboarding-compliance\/confirm/, '合规页面未调用合并接口');
assert.match(complianceWxml, /合同签订日期[\s\S]*雇主险生效日期/, '合规页面字段不完整');
assert.match(tasksJs, /ONBOARDING_COMPLIANCE/, '待办页未识别合并合规待办');
assert.match(homeJs, /ONBOARDING_COMPLIANCE/, '工作台未识别合并合规待办');

console.log('miniprogram-simplified-onsite-flow-tests-ok');
