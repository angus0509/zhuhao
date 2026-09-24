const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/layout-refine.css');

assert.ok(html.includes('<h2>工资条发放管理</h2>'), '工资条页面标题仍使用运营工作台旧名称');
assert.match(html, /class="payroll-flow-strip"[\s\S]*上传工资条[\s\S]*复核并发放/, '工资条页面应只显示上传、复核发放两个步骤');
assert.doesNotMatch(html, /class="payroll-flow-strip"[\s\S]*校验数据[\s\S]*创建工资条/, '工资条页面仍显示旧的多步骤流程');
assert.ok(html.includes('导入工资条表格'), '工资条导入入口命名不统一');
assert.ok(html.includes('上传并提交复核'), '工资条上传按钮未体现直接进入复核');
assert.match(app, /复核并发放/, '复核按钮未合并发放动作');
assert.match(app, /重新提交工资复核/, '历史退回批次未明确提示重新提交复核');
assert.match(app, /title:\s*'复核并发放工资条'[\s\S]*confirmText:\s*'确认发放'/,
  '复核发放前必须显示明确的二次确认');
assert.match(app, /复核通过，工资条已发放/, '复核成功提示仍停留在待发放状态');
assert.match(app, /withSubmitLock\(button,[\s\S]*上传中…/,
  '上传和预览全过程必须共用防重复提交锁');
assert.ok(!html.includes('<h3>最近工资批次</h3>'), '概览仍使用工资批次旧标题');
assert.match(app, /\['待处理批次', pendingPublish/, '工资条待办仍把所有处理中状态误称为待发布');
assert.match(css, /\.payroll-flow-strip\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s, '工资条流程条未使用两阶段布局');

console.log('web-payroll-flow-layout-tests-ok');
