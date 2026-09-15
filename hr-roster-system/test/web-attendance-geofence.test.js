const fs = require('node:fs'); const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8'); const js = fs.readFileSync('public/js/views/attendance.js', 'utf8');
for (const id of ['attendanceGeofenceForm', 'attendanceGeofenceBody']) assert.match(html, new RegExp(`id="${id}"`));
assert.match(html, /data-action-perm="attendance:manage"/);
assert.match(js, /\/api\/attendance\/geofences/);
assert.match(js, /data-disable-geofence/);
console.log('web-attendance-geofence.test.js: contract passed');
