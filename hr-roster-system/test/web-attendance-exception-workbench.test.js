const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('public/index.html', 'utf8');
const js = fs.readFileSync('public/js/views/attendance.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

for (const id of [
  'attendanceExceptionSummary',
  'attendanceExceptionStatusFilter',
  'attendanceEmployeeKeyword',
  'attendanceExceptionBody',
  'attendanceClosureStatus',
  'attendanceConfirmDay',
  'attendanceReopenDay',
  'attendanceDailySettlementLink'
]) assert.match(html, new RegExp(`id="${id}"`), `${id} missing`);

for (const name of [
  'loadAttendanceWorkbench',
  'confirmAttendanceDay',
  'reopenAttendanceDay',
  'reviewAttendanceDailyException',
  'attendanceClientRequestId'
]) assert.match(js, new RegExp(`(?:async )?function ${name}\\(`), `${name} missing`);

assert.match(js, /attendanceRequestGate\.begin\('workbench'\)/);
assert.match(js, /\/api\/attendance\/workbench/);
assert.match(js, /\/api\/attendance\/daily-close/);
assert.match(js, /\/api\/attendance\/daily-reopen/);
assert.match(js, /\/api\/attendance\/daily-results\/\$\{resultId\}\/review/);
assert.match(js, /withSubmitLock/);
assert.match(js, /confirmDialog/);
assert.match(js, /clientRequestId/);
assert.doesNotMatch(html, /attendanceExceptionBody[^]*(?:时薪|应结金额)/);
assert.match(css, /\.attendance-exception-filters/);
assert.match(css, /@media \(max-width: 760px\)/);

console.log('web-attendance-exception-workbench-tests-ok');
