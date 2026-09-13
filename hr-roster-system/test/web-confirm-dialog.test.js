const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('public/index.html');
const app = read('public/app.js');
const dialog = read('public/js/core/confirm-dialog.js');

assert.match(index, /id="appConfirmDialog"/, '页面缺少统一确认弹窗');
assert.match(index, /src="\/js\/core\/confirm-dialog\.js"/, '页面未加载确认弹窗组件');
assert.match(dialog, /function confirmDialog\(/, '确认弹窗组件未暴露 confirmDialog');
assert.doesNotMatch(app, /window\.confirm\s*\(/, '关键业务仍在调用原生 window.confirm');
assert.match(app, /confirmDialog\([\s\S]*?danger:\s*true/, '危险操作未使用危险确认按钮');

console.log('web-confirm-dialog-tests-ok');
