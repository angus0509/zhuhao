const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/layout-refine.css');

assert.ok(html.includes('<h2>工资条发放管理</h2>'), '工资条页面标题仍使用运营工作台旧名称');
assert.match(html, /class="payroll-flow-strip"[\s\S]*导入表格[\s\S]*校验数据[\s\S]*创建工资条[\s\S]*发放通知[\s\S]*员工签收/, '工资条页面缺少完整发放流程');
assert.ok(html.includes('导入工资条表格'), '工资条导入入口命名不统一');
assert.ok(html.includes('确认创建工资条'), '工资条创建按钮仍使用工资批次旧名称');
assert.ok(!html.includes('<h3>最近工资批次</h3>'), '概览仍使用工资批次旧标题');
assert.match(app, /\['待处理批次', pendingPublish/, '工资条待办仍把所有处理中状态误称为待发布');
assert.match(css, /\.payroll-flow-strip\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s, '工资条流程条未使用五阶段布局');

console.log('web-payroll-flow-layout-tests-ok');
