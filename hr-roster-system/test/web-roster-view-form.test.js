const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/app.js');
const roster = read('public/js/views/roster.js');

assert.match(roster, /data-action="detail"/, '花名册应保留查看操作');
assert.match(app, /openEmployeeModal\(Number\(id\),\s*\{\s*readOnly:\s*true\s*\}\)/, '查看应打开与编辑一致的员工前端表单');
assert.match(app, /readOnly/, '员工表单需要支持只读模式');
assert.match(app, /employeeModalTitle.*查看员工|查看员工.*employeeModalTitle/, '只读表单应显示查看员工标题');
assert.match(app, /const submit = \$\('#employeeEntrySubmit'\)[\s\S]*?classList\.toggle\('hidden', Boolean\(readOnly\)\)/, '只读表单应隐藏保存按钮');
assert.match(app, /if \(form\.dataset\.readOnly === '1'\)[\s\S]*?return;/, '只读表单必须阻止提交');

console.log('web-roster-view-form-tests-ok');
