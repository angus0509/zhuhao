const assert = require('assert');
const fs = require('fs');

const root = '/Users/zhuhao/Documents/moluo/hr-roster-system';
const appConfig = JSON.parse(fs.readFileSync(`${root}/wechat-miniprogram/miniprogram/app.json`, 'utf8'));
const detailWxml = fs.readFileSync(`${root}/wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml`, 'utf8');
const operations = fs.readFileSync(`${root}/src/services/operations.service.js`, 'utf8');
const workTask = fs.readFileSync(`${root}/src/services/work-task.service.js`, 'utf8');

for (const page of [
  'pages/employees/compliance/index',
  'pages/employees/contract/index',
  'pages/employees/insurance/index'
]) {
  assert(!appConfig.pages.includes(page), `已取消的页面仍注册：${page}`);
}

assert(!detailWxml.includes('劳动合同'), '员工详情仍显示劳动合同模块');
assert(!detailWxml.includes('雇主责任险'), '员工详情仍显示雇主险模块');
assert(!operations.includes("title: '劳动合同待签订'"), '工作台仍配置劳动合同待办');
assert(!operations.includes("title: '雇主险待增保'"), '工作台仍配置雇主险待办');
assert(!workTask.includes("t.task_type IN ('CONTRACT','INSURANCE','ONBOARDING_COMPLIANCE')"), '任务查询仍返回已取消的合规任务');

console.log('removed-compliance-flow-tests-ok');
