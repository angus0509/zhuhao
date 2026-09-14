const assert = require('node:assert/strict');
const service = require('../src/services/attendance.service');
for (const name of ['createShiftRule', 'upsertSchedule', 'attendanceSummaryForPayroll']) assert.equal(typeof service[name], 'function', `${name} missing`);
console.log('attendance-management-contract.test.js: contract passed');
