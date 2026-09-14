const assert = require('node:assert/strict');
const service = require('../src/services/attendance.service');

assert.equal(typeof service.punchEmployee, 'function');
assert.equal(typeof service.createCorrection, 'function');
assert.equal(typeof service.reviewCorrection, 'function');
console.log('attendance-write-contract.test.js: contract passed');
