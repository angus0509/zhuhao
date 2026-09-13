const db = require('../db');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');
const { normalizeHeaders, normalizeMapping } = require('./payroll-import-profile.service');

function normalizeName(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name) throw createError('模板名称不能为空');
  if (name.length > 50) throw createError('模板名称最多50个字符');
  return name;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function assertProjectId(value) {
  const projectId = Number(value);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw createError('项目参数不正确');
  return projectId;
}

async function listTemplates(companyId, projectId, user = null) {
  const params = { companyId: Number(companyId), projectId: assertProjectId(projectId) };
  const scopeSql = projectScope(user, params, 'p');
  const rows = await db.query(
    `SELECT t.id,t.name,t.source_headers sourceHeaders,t.mapping_json mappingJson,
            t.last_used_at lastUsedAt,t.updated_at updatedAt
     FROM salary_import_template t
     JOIN labor_project p ON p.id=t.project_id AND p.company_id=t.company_id
     WHERE t.company_id=:companyId AND t.project_id=:projectId AND t.status=1${scopeSql}
     ORDER BY t.last_used_at DESC,t.id DESC`,
    params
  );
  return rows.map(row => ({
    id: Number(row.id),
    name: row.name,
    sourceHeaders: parseJsonArray(row.sourceHeaders),
    mapping: parseJsonArray(row.mappingJson),
    lastUsedAt: row.lastUsedAt || null,
    updatedAt: row.updatedAt || null
  }));
}

async function createTemplate(companyId, body, operatorId) {
  const projectId = assertProjectId(body?.projectId);
  const name = normalizeName(body?.name);
  const sourceHeaders = normalizeHeaders(body?.sourceHeaders);
  const mapping = normalizeMapping(body?.mapping);
  try {
    const result = await db.query(
      `INSERT INTO salary_import_template
       (company_id,project_id,name,source_headers,mapping_json,status,last_used_at,created_by)
       VALUES (:companyId,:projectId,:name,:sourceHeaders,:mappingJson,1,NOW(),:operatorId)`,
      {
        companyId: Number(companyId),
        projectId,
        name,
        sourceHeaders: JSON.stringify(sourceHeaders),
        mappingJson: JSON.stringify(mapping),
        operatorId: Number(operatorId) || null
      }
    );
    return { templateId: Number(result.insertId) };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw createError('该模板名称已存在');
    throw error;
  }
}

async function updateTemplate(companyId, templateId, body) {
  const id = Number(templateId);
  if (!Number.isSafeInteger(id) || id <= 0) throw createError('模板参数不正确');
  const name = normalizeName(body?.name);
  const sourceHeaders = normalizeHeaders(body?.sourceHeaders);
  const mapping = normalizeMapping(body?.mapping);
  try {
    const result = await db.query(
      `UPDATE salary_import_template
       SET name=:name,source_headers=:sourceHeaders,mapping_json=:mappingJson,updated_at=NOW()
       WHERE company_id=:companyId AND id=:id AND status=1`,
      {
        companyId: Number(companyId),
        id,
        name,
        sourceHeaders: JSON.stringify(sourceHeaders),
        mappingJson: JSON.stringify(mapping)
      }
    );
    if (!result.affectedRows) throw createError('模板不存在', 404);
    return { templateId: id };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw createError('该模板名称已存在');
    throw error;
  }
}

async function deleteTemplate(companyId, templateId) {
  const id = Number(templateId);
  if (!Number.isSafeInteger(id) || id <= 0) throw createError('模板参数不正确');
  const result = await db.query(
    `UPDATE salary_import_template SET status=0,updated_at=NOW()
     WHERE company_id=:companyId AND id=:id AND status=1`,
    { companyId: Number(companyId), id }
  );
  if (!result.affectedRows) throw createError('模板不存在', 404);
  return { templateId: id };
}

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  normalizeName
};
