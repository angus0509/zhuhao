const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('public/index.html', 'utf8');
const js = fs.readFileSync('public/js/views/attendance.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const { createRequestGate } = require('../public/js/core/request-gate');

const gate = createRequestGate();
const monthlyRequest = gate.begin('monthly');
const calendarRequest = gate.begin('calendar');
assert.equal(gate.isCurrent(monthlyRequest), true, '并行日历请求不应使月报请求过期');
assert.equal(gate.isCurrent(calendarRequest), true, '并行月报请求不应使日历请求过期');
const oldDailyRequest = gate.begin('daily');
gate.invalidateAll();
assert.equal(gate.isCurrent(oldDailyRequest), false, '切换项目后旧项目请求必须过期');
assert.equal(gate.isCurrent(gate.begin('daily')), true, '新项目请求应保持有效');

for (const id of [
  'attendanceCustomerFilter', 'attendanceProjectFilter', 'attendanceDate', 'attendanceMonth',
  'attendanceProjectSettingsForm', 'attendanceCalendarForm', 'attendanceGeofenceForm',
  'attendanceProjectContext', 'attendanceDailyBody', 'attendanceMonthlyBody',
  'attendanceCalendarBody', 'attendanceGeofenceBody', 'attendanceProjectGeofenceOptions'
]) assert.match(html, new RegExp(`id="${id}"`), `${id} missing`);

for (const tab of ['daily', 'monthly', 'settings', 'geofences']) {
  assert.match(html, new RegExp(`data-attendance-tab="${tab}"`));
  assert.match(html, new RegExp(`data-attendance-panel="${tab}"`));
}

for (const name of [
  'loadAttendanceProjects', 'selectAttendanceProject', 'loadAttendanceDaily',
  'loadAttendanceMonthly', 'loadAttendanceProjectSettings',
  'saveAttendanceProjectSettings', 'loadAttendanceCustomerGeofences'
]) assert.match(js, new RegExp(`(?:async )?function ${name}\\(`), `${name} missing`);

assert.match(js, /\/api\/attendance\/projects/);
assert.match(js, /projectId=.*date=/);
assert.match(js, /projectId=.*month=/);
assert.match(js, /\/api\/attendance\/projects\/\$\{projectId\}\/settings/);
assert.match(js, /\/api\/attendance\/projects\/\$\{projectId\}\/exceptions/);
assert.match(js, /\/api\/attendance\/geofences\?customerId=/);
assert.match(js, /\/api\/attendance\/corrections\?[^`]*projectId=/);
assert.match(js, /attendanceRequestGate/);
assert.match(js, /attendanceRequestGate\.begin/);
assert.match(js, /attendance:manage/);
assert.match(js, /withSubmitLock/);
assert.match(js, /项目不存在或无权访问/);
assert.match(js, /当前账号暂无授权项目/);
assert.match(css, /\.attendance-context-bar/);
assert.match(css, /\.attendance-workspace-tabs/);
assert.match(css, /@media \(max-width:/);

console.log('web-project-attendance-ui.test.js: contract passed');
