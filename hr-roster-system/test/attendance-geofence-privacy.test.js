const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/services/attendance.service.js', 'utf8');
assert.match(source, /evaluateEmployeeLocation/);
assert.match(source, /GEOFENCE_EXCEPTION/);
assert.match(source, /geofenceStatus/);
assert.match(source, /distanceMeters/);
assert.doesNotMatch(source.match(/async function listDaily[\s\S]*?async function listMonthly/)[0], /p\.latitude|p\.longitude/);
console.log('attendance-geofence-privacy.test.js: contract passed');
