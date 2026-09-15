const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/attendance-geofence-management.service');
assert.equal(service.validate({ fenceName: '一号厂区', latitude: 31.2, longitude: 121.4, radiusMeters: 300, maxAccuracyMeters: 100 }).radiusMeters, 300);
assert.throws(() => service.validate({ fenceName: '错误', latitude: 100, longitude: 121, radiusMeters: 1, maxAccuracyMeters: 1 }), /围栏参数无效/);
for (const name of ['list', 'create', 'update', 'replaceProjectGeofences']) assert.equal(typeof service[name], 'function');

async function run() {
  const originalQuery = db.query;
  const originalFirst = db.first;
  const originalTransaction = db.transaction;
  try {
    let captured;
    db.query = async (sql, params) => {
      captured = { sql, params };
      return [{ id: 31, customerId: 7, fenceName: '东门', radiusMeters: 300, maxAccuracyMeters: 100, status: 1 }];
    };
    const readonly = await service.list(3, { id: 9, companyId: 3, dataScope: 5 }, {
      customerId: 7, includeCoordinates: true
    });
    assert.equal(readonly[0].latitude, undefined);
    assert.doesNotMatch(captured.sql, /g\.latitude|g\.longitude/);
    assert.match(captured.sql, /g\.customer_id=:customerId/);
    assert.match(captured.sql, /sys_user_project/);

    await service.list(3, { id: 9, companyId: 3, dataScope: 5, permissions: ['attendance:manage'] }, {
      customerId: 7
    });
    assert.match(captured.sql, /g\.latitude,g\.longitude/);

    const writes = [];
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        writes.push({ sql, params });
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12, customerId: 7 }]];
        if (/FROM attendance_geofences/.test(sql)) return [[
          { id: 31, customerId: 7 }, { id: 32, customerId: 7 }
        ]];
        return [{ insertId: 1 }];
      }
    });
    const linked = await service.replaceProjectGeofences(
      {}, 3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, [31, 32]
    );
    assert.deepEqual(linked, { projectId: 12, geofenceIds: [31, 32] });
    assert.ok(writes.some(item => /FROM attendance_geofences/.test(item.sql) && /geofenceId0/.test(JSON.stringify(item.params))));
    assert.deepEqual(writes.filter(item => /INSERT INTO attendance_project_geofence/.test(item.sql)).map(item => item.params.geofenceId), [31, 32]);
    assert.ok(writes.findIndex(item => /UPDATE attendance_project_geofence/.test(item.sql))
      < writes.findIndex(item => /INSERT INTO attendance_project_geofence/.test(item.sql)));

    writes.length = 0;
    const empty = await service.replaceProjectGeofences(
      {}, 3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, []
    );
    assert.deepEqual(empty.geofenceIds, []);
    assert.ok(writes.some(item => /UPDATE attendance_project_geofence/.test(item.sql)));

    writes.length = 0;
    const deduplicated = await service.replaceProjectGeofences(
      {}, 3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, [31, 31, 32]
    );
    assert.deepEqual(deduplicated.geofenceIds, [31, 32]);
    assert.equal(writes.filter(item => /INSERT INTO attendance_project_geofence/.test(item.sql)).length, 2);

    db.transaction = async handler => handler({
      execute: async sql => {
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12, customerId: 7 }]];
        if (/FROM attendance_geofences/.test(sql)) return [[{ id: 41, customerId: 8 }]];
        return [[]];
      }
    });
    await assert.rejects(
      service.replaceProjectGeofences({}, 3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, [41]),
      error => error.businessCode === 'GEOFENCE_CUSTOMER_MISMATCH'
    );

    db.transaction = async handler => handler({ execute: async () => [[]] });
    await assert.rejects(
      service.replaceProjectGeofences({}, 3, { id: 9, companyId: 3, dataScope: 5 }, 9, 999, [31]),
      error => error.businessCode === 'PROJECT_FORBIDDEN'
    );

    db.transaction = async handler => handler({
      execute: async sql => {
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12, customerId: 7 }]];
        if (/FROM attendance_geofences/.test(sql)) return [[]];
        return [[]];
      }
    });
    await assert.rejects(
      service.replaceProjectGeofences({}, 3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, [31]),
      error => error.businessCode === 'GEOFENCE_CUSTOMER_MISMATCH'
    );

    let inserted;
    db.query = async (sql, params) => {
      if (/SELECT c\.id/.test(sql)) return [{ id: 7 }];
      inserted = { sql, params };
      return { insertId: 50 };
    };
    const created = await service.create(3, { id: 9, companyId: 3, dataScope: 5 }, 9, {
      customerId: 7, fenceName: '北门', latitude: 31.2, longitude: 121.4,
      radiusMeters: 300, maxAccuracyMeters: 100
    });
    assert.equal(created.customerId, 7);
    assert.match(inserted.sql, /company_id,customer_id,fence_name/);
    assert.doesNotMatch(inserted.sql, /project_id/);

    db.first = async () => ({ id: 60, customerId: 99 });
    db.query = async sql => /SELECT c\.id/.test(sql) ? [] : { affectedRows: 1 };
    await assert.rejects(
      service.update(3, { id: 9, companyId: 3, dataScope: 5 }, 9, 60, { status: 0 }),
      error => error.businessCode === 'CUSTOMER_FORBIDDEN'
    );
  } finally {
    db.query = originalQuery;
    db.first = originalFirst;
    db.transaction = originalTransaction;
  }
}

run().then(() => console.log('attendance-geofence-management.test.js: contract passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
