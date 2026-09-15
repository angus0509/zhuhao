const fs = require('node:fs');
const assert = require('node:assert/strict');
const sql = fs.readFileSync('sql/migrate-attendance-geofence-20260915.mysql.sql', 'utf8');
assert.match(sql, /CREATE TABLE IF NOT EXISTS attendance_geofences/);
for (const field of ['geofence_id', 'latitude', 'longitude', 'location_accuracy', 'distance_meters', 'geofence_radius_snapshot', 'geofence_status', 'location_reason']) assert.match(sql, new RegExp(`COLUMN_NAME='${field}'`));
assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
console.log('attendance-geofence-schema.test.js: contract passed');
