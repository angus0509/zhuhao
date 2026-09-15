const assert = require('node:assert/strict');
const { calculateDistanceMeters, evaluateGeofence } = require('../src/services/attendance-geofence.service');

assert.equal(calculateDistanceMeters(31.2304, 121.4737, 31.2304, 121.4737), 0);
const known = calculateDistanceMeters(31.2304, 121.4737, 31.2313, 121.4737);
assert.ok(known >= 99 && known <= 101, `expected about 100m, got ${known}`);
assert.equal(evaluateGeofence({ latitude: 31.2304, longitude: 121.4737, accuracy: 20 }, { latitude: 31.2304, longitude: 121.4737, radiusMeters: 300, maxAccuracyMeters: 100 }).status, 'INSIDE');
assert.equal(evaluateGeofence({ latitude: 31.2404, longitude: 121.4737, accuracy: 20 }, { latitude: 31.2304, longitude: 121.4737, radiusMeters: 300, maxAccuracyMeters: 100 }).status, 'OUTSIDE');
assert.equal(evaluateGeofence({ latitude: 31.2304, longitude: 121.4737, accuracy: 150 }, { latitude: 31.2304, longitude: 121.4737, radiusMeters: 300, maxAccuracyMeters: 100 }).status, 'LOW_ACCURACY');
assert.equal(evaluateGeofence({ failed: true, reason: 'permission denied' }, {}).status, 'LOCATION_FAILED');
console.log('attendance-geofence.test.js: all assertions passed');
