const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('public/index.html');
const rosterTools = read('public/js/views/roster-table.js');
const roster = read('public/js/views/roster.js');
const app = read('public/app.js');
const css = read('public/styles.css');

assert(index.includes('id="rosterColumnToggle"'), '花名册缺少列设置入口');
assert(index.includes('data-sort-key="name"'), '姓名列缺少排序能力');
assert(index.includes('/js/views/roster-table.js'), '页面未加载花名册表格工具');
assert(rosterTools.includes("localStorage.getItem('hrRosterVisibleColumns')"), '列设置未持久化');
assert(rosterTools.includes("selected.add('name')"), '姓名列未强制保留');
assert(rosterTools.includes("selected.add('ops')"), '操作列未强制保留');
assert(rosterTools.includes("localeCompare(String(b), 'zh-CN'"), '中文字段未使用本地化排序');
assert(rosterTools.includes("event.key === 'Enter' || event.key === ' '"), '表头排序缺少键盘操作');
assert(roster.includes('getSortedRosterRows(state.employees)'), '花名册渲染未使用排序结果');
assert(roster.includes('rosterVisibleColumnCount()'), '分组行未适配可见列数');
assert(css.includes('.roster-table .column-hidden'), '缺少隐藏列样式');

console.log('roster-table-tools-tests-ok');
