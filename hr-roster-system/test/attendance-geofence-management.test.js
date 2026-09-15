const assert = require('node:assert/strict');
const service = require('../src/services/attendance-geofence-management.service');
assert.equal(service.validate({ fenceName: '一号厂区', latitude: 31.2, longitude: 121.4, radiusMeters: 300, maxAccuracyMeters: 100 }).radiusMeters, 300);
assert.throws(() => service.validate({ fenceName: '错误', latitude: 100, longitude: 121, radiusMeters: 1, maxAccuracyMeters: 1 }), /围栏参数无效/);
for (const name of ['list', 'create', 'update']) assert.equal(typeof service[name], 'function');
console.log('attendance-geofence-management.test.js: contract passed');
