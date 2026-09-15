const db = require('../db');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');

function validate(body = {}) {
  const latitude = Number(body.latitude); const longitude = Number(body.longitude);
  const radiusMeters = Number(body.radiusMeters); const maxAccuracyMeters = Number(body.maxAccuracyMeters);
  if (!body.fenceName || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isInteger(radiusMeters) || radiusMeters < 20 || radiusMeters > 5000 || !Number.isInteger(maxAccuracyMeters) || maxAccuracyMeters < 10 || maxAccuracyMeters > 1000) throw createError('围栏参数无效', 400, 'INVALID_GEOFENCE');
  return { fenceName: String(body.fenceName).slice(0, 100), latitude, longitude, radiusMeters, maxAccuracyMeters };
}

async function assertProject(companyId, user, projectId) {
  const params = { companyId, projectId };
  const scope = projectScope(user, params, 'p');
  const rows = await db.query(`SELECT p.id FROM labor_project p WHERE p.company_id=:companyId AND p.id=:projectId ${scope} LIMIT 1`, params);
  if (!rows[0]) throw createError('项目不存在或无操作权限', 404, 'PROJECT_NOT_FOUND');
}

async function list(companyId, user, projectId) {
  const params = { companyId, projectId: Number(projectId || 0) };
  const scope = projectScope(user, params, 'p');
  return db.query(`SELECT g.id,g.project_id AS projectId,p.project_name AS projectName,g.fence_name AS fenceName,
    g.latitude,g.longitude,g.radius_meters AS radiusMeters,g.max_accuracy_meters AS maxAccuracyMeters,g.status,g.updated_at AS updatedAt
    FROM attendance_geofences g JOIN labor_project p ON p.id=g.project_id AND p.company_id=g.company_id
    WHERE g.company_id=:companyId AND (:projectId=0 OR g.project_id=:projectId) ${scope} ORDER BY p.project_name,g.fence_name`, params);
}

async function create(companyId, user, operatorId, body) {
  const projectId = Number(body.projectId); await assertProject(companyId, user, projectId); const values = validate(body);
  const result = await db.query(`INSERT INTO attendance_geofences (company_id,project_id,fence_name,latitude,longitude,radius_meters,max_accuracy_meters,status,created_by)
    VALUES (:companyId,:projectId,:fenceName,:latitude,:longitude,:radiusMeters,:maxAccuracyMeters,1,:operatorId)`, { companyId, projectId, operatorId, ...values });
  return { id: result.insertId, projectId, ...values, status: 1 };
}

async function update(companyId, user, id, body) {
  const current = await db.first('SELECT id,project_id AS projectId FROM attendance_geofences WHERE id=:id AND company_id=:companyId', { id, companyId });
  if (!current) throw createError('围栏不存在', 404, 'GEOFENCE_NOT_FOUND');
  await assertProject(companyId, user, current.projectId);
  if (body.status === 0) { await db.query('UPDATE attendance_geofences SET status=0 WHERE id=:id AND company_id=:companyId', { id, companyId }); return { id, status: 0 }; }
  const values = validate(body);
  await db.query(`UPDATE attendance_geofences SET fence_name=:fenceName,latitude=:latitude,longitude=:longitude,radius_meters=:radiusMeters,max_accuracy_meters=:maxAccuracyMeters,status=1 WHERE id=:id AND company_id=:companyId`, { id, companyId, ...values });
  return { id, ...values, status: 1 };
}

module.exports = { list, create, update, validate };
