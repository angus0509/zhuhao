const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const view = read('public/js/views/roster.js');
const service = read('src/services/employee.service.js');

assert.match(view, /const view = !status \|\| status === '2' \? 'activeRoster' : ''/, '网页花名册必须默认使用在职视图，并允许按明确状态查看其他生命周期');
assert.match(view, /view \? `view=\$\{view\}` : ''/, '网页花名册查询和导出必须同步应用生命周期视图');
assert.match(service, /query\.view\s*===\s*'activeRoster'/, '后端必须识别在职花名册视图');
assert.match(service, /e\.employee_status\s*=\s*2/, '在职花名册必须限制员工状态为在职');
assert.match(service, /OFFBOARDING/, '在职花名册必须排除离职办理中员工');
assert.match(service, /j\.job_status\s*=\s*1/, '在职花名册必须要求有效任职记录');

console.log('web-active-roster-only-tests-ok');
