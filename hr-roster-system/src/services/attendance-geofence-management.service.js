const db = require('../db');
const { createError } = require('../utils/response');
const { customerScope, projectScope } = require('../utils/data-scope');

function validate(body = {}) {
  const latitude = Number(body.latitude); const longitude = Number(body.longitude);
  const radiusMeters = Number(body.radiusMeters); const maxAccuracyMeters = Number(body.maxAccuracyMeters);
  if (!body.fenceName || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isInteger(radiusMeters) || radiusMeters < 20 || radiusMeters > 5000 || !Number.isInteger(maxAccuracyMeters) || maxAccuracyMeters < 10 || maxAccuracyMeters > 1000) throw createError('围栏参数无效', 400, 'INVALID_GEOFENCE');
  return { fenceName: String(body.fenceName).slice(0, 100), latitude, longitude, radiusMeters, maxAccuracyMeters };
}

function positiveId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : 0; }
async function query(client, sql, params) { const [rows] = await client.execute(sql, params); return rows; }

async function assertCustomer(companyId, user, customerId, client = null) {
  const id = positiveId(customerId);
  if (!id) throw createError('客户不存在或无权访问', 403, 'CUSTOMER_FORBIDDEN');
  const params = { companyId, customerId: id };
  const scope = customerScope(user, params, 'c');
  const sql = `SELECT c.id FROM crm_customer c WHERE c.company_id=:companyId AND c.id=:customerId ${scope} LIMIT 1`;
  const rows = client ? await query(client, sql, params) : await db.query(sql, params);
  if (!rows[0]) throw createError('客户不存在或无权访问', 403, 'CUSTOMER_FORBIDDEN');
}

async function assertProject(client, companyId, user, projectId) {
  const params = { companyId, projectId };
  const scope = projectScope(user, params, 'p');
  const rows = await query(client, `SELECT p.id,p.customer_id AS customerId FROM labor_project p WHERE p.company_id=:companyId AND p.id=:projectId ${scope} LIMIT 1`, params);
  if (!rows[0]) throw createError('项目不存在或无操作权限', 403, 'PROJECT_FORBIDDEN');
  return rows[0];
}

async function list(companyId, user, options = {}) {
  const customerId = positiveId(options.customerId);
  if (!customerId) throw createError('客户参数无效', 400, 'CUSTOMER_REQUIRED');
  const params = { companyId, customerId };
  const scope = customerScope(user, params, 'c');
  const publicFields = `g.id,g.customer_id AS customerId,c.customer_name AS customerName,
    g.fence_name AS fenceName,g.radius_meters AS radiusMeters,g.max_accuracy_meters AS maxAccuracyMeters,g.status,g.updated_at AS updatedAt`;
  const canManage = Array.isArray(user?.permissions) && user.permissions.includes('attendance:manage');
  const coordinateFields = canManage ? ',g.latitude,g.longitude' : '';
  return db.query(`SELECT ${publicFields}${coordinateFields} FROM attendance_geofences g
    JOIN crm_customer c ON c.id=g.customer_id AND c.company_id=g.company_id
    WHERE g.company_id=:companyId AND g.customer_id=:customerId ${scope} ORDER BY g.fence_name,g.id`, params);
}

async function create(companyId, user, operatorId, body) {
  const customerId = positiveId(body.customerId); await assertCustomer(companyId, user, customerId); const values = validate(body);
  const result = await db.query(`INSERT INTO attendance_geofences (company_id,customer_id,fence_name,latitude,longitude,radius_meters,max_accuracy_meters,status,created_by,updated_by)
    VALUES (:companyId,:customerId,:fenceName,:latitude,:longitude,:radiusMeters,:maxAccuracyMeters,1,:operatorId,:operatorId)`, { companyId, customerId, operatorId: positiveId(operatorId), ...values });
  return { id: result.insertId, customerId, ...values, status: 1 };
}

async function update(companyId, user, operatorId, id, body) {
  const current = await db.first('SELECT id,customer_id AS customerId FROM attendance_geofences WHERE id=:id AND company_id=:companyId', { id, companyId });
  if (!current) throw createError('围栏不存在', 404, 'GEOFENCE_NOT_FOUND');
  await assertCustomer(companyId, user, current.customerId);
  if (body.status === 0) { await db.query('UPDATE attendance_geofences SET status=0,updated_by=:operatorId WHERE id=:id AND company_id=:companyId', { id, companyId, operatorId: positiveId(operatorId) }); return { id, status: 0 }; }
  const values = validate(body);
  await db.query(`UPDATE attendance_geofences SET fence_name=:fenceName,latitude=:latitude,longitude=:longitude,radius_meters=:radiusMeters,max_accuracy_meters=:maxAccuracyMeters,status=1,updated_by=:operatorId WHERE id=:id AND company_id=:companyId`, { id, companyId, operatorId: positiveId(operatorId), ...values });
  return { id, ...values, status: 1 };
}

async function replaceProjectGeofences(client, companyId, user, operatorId, projectId, geofenceIds = []) {
  const run = async transactionClient => {
    const project = await assertProject(transactionClient, companyId, user, positiveId(projectId));
    const ids = [...new Set(geofenceIds.map(positiveId).filter(Boolean))];
    if (ids.length) {
      const params = { companyId };
      const placeholders = ids.map((geofenceId, index) => { params[`geofenceId${index}`] = geofenceId; return `:geofenceId${index}`; });
      const fences = await query(transactionClient, `SELECT id,customer_id AS customerId FROM attendance_geofences WHERE company_id=:companyId AND id IN (${placeholders.join(',')}) AND status=1`, params);
      if (fences.length !== ids.length || fences.some(fence => Number(fence.customerId) !== Number(project.customerId))) throw createError('项目只能关联同一客户的有效围栏', 400, 'GEOFENCE_CUSTOMER_MISMATCH');
    }
    await query(transactionClient, 'UPDATE attendance_project_geofence SET status=0,updated_by=:operatorId WHERE company_id=:companyId AND project_id=:projectId AND status=1', { companyId, projectId: positiveId(projectId), operatorId: positiveId(operatorId) });
    for (const geofenceId of ids) {
      await query(transactionClient, `INSERT INTO attendance_project_geofence (company_id,project_id,geofence_id,status,created_by,updated_by)
        VALUES (:companyId,:projectId,:geofenceId,1,:operatorId,:operatorId)
        ON DUPLICATE KEY UPDATE status=1,updated_by=VALUES(updated_by),updated_at=CURRENT_TIMESTAMP`, { companyId, projectId: positiveId(projectId), geofenceId, operatorId: positiveId(operatorId) });
    }
    return { projectId: positiveId(projectId), geofenceIds: ids };
  };
  return client?.execute ? run(client) : db.transaction(run);
}

module.exports = { list, create, update, replaceProjectGeofences, validate };
