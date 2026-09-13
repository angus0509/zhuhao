const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/layout-refine.css');

// 花名册状态必须和小程序入口一致：面试、待到岗、在职、离职/未入职。
assert.match(html, /id="statusSelect"[\s\S]*?<option value="6">面试/, '网页花名册缺少面试状态筛选');
assert.match(html, /id="statusSelect"[\s\S]*?<option value="1">待到岗/, '网页花名册缺少待到岗状态筛选');
assert.match(html, /id="statusSelect"[\s\S]*?<option value="3">离职/, '网页花名册缺少离职状态筛选');

// 同一 DOM id 只能出现一次，否则列设置按钮会出现点击错位。
assert.equal((html.match(/id="rosterColumnToggle"/g) || []).length, 1, '花名册列设置按钮存在重复 id');

// 页面标题和流程提示应明确下一步，避免“待入职/待到岗”混用。
assert.match(app, /statusNames\s*=\s*\{[^}]*1:\s*'待到岗'/s, '网页状态文案仍把待到岗显示为待入职');
assert.match(html, /待到岗 → 在职|待到岗.*确认入职/, '新增员工页面缺少待到岗到在职的流程提示');

// 布局需在宽屏收紧空白，并在窄屏保持单列可读。
assert.match(css, /\.workspace\s*\{[^}]*padding:\s*clamp\(/s, '工作区未设置响应式紧凑内边距');
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.content-grid\s*\{[^}]*grid-template-columns:\s*1fr/s, '手机 Web 花名册未切换为单列布局');

console.log('web-flow-layout-contract-tests-ok');
