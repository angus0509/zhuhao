const db = require('../db');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');

const TARGETS = new Set([
  'employeeNo', 'employeeName', 'idCardNo', 'phone',
  'baseSalary', 'positionSalary', 'performanceSalary', 'allowanceAmount',
  'pieceAmount', 'overtime15Amount', 'overtime20Amount', 'overtime30Amount',
  'grossAmount', 'socialDeduction', 'taxDeduction', 'advanceDeduction',
  'otherDeduction', 'netAmount', 'custom', 'ignore'
]);
const CATEGORIES = new Set(['', 'income', 'deduction', 'summary', 'display']);

function normalizeSignature(value) {
  const signature = String(value || '').trim();
  if (!/^[a-f0-9]{64}$/.test(signature)) throw createError('表头签名格式不正确');
  return signature;
}

function normalizeHeaders(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw createError('工资表头必须为1至100列');
  return value.map((header, index) => {
    const text = String(header == null ? '' : header).trim();
    if (text.length > 50) throw createError(`第${index + 1}列表头最多50个字符`);
    return text;
  });
}

function normalizeMapping(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw createError('工资字段映射必须为1至100列');
  const seen = new Set();
  const normalized = value.map(item => {
    const columnIndex = Number(item?.columnIndex);
    const target = String(item?.target || 'ignore');
    const category = String(item?.category || '');
    const sourceHeader = String(item?.sourceHeader || '').trim();
    if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= 100 || seen.has(columnIndex)) {
      throw createError('工资字段映射列号重复或无效');
    }
    if (!TARGETS.has(target) || !CATEGORIES.has(category) || sourceHeader.length > 50) throw createError('工资字段映射内容无效');
    seen.add(columnIndex);
    return { columnIndex, sourceHeader, target, category, includeInPayslip: item?.includeInPayslip === true };
  });
  const identityTargets = new Set(['employeeNo', 'employeeName', 'idCardNo', 'phone']);
  if (!normalized.some(item => identityTargets.has(item.target))) throw createError('工资字段映射至少需要一种员工身份');
  if (normalized.filter(item => item.target === 'netAmount').length !== 1) throw createError('工资字段映射必须且只能包含一列实发工资');
  const criticalTargets = [...identityTargets, 'grossAmount', 'netAmount'];
  if (criticalTargets.some(target => normalized.filter(item => item.target === target).length > 1)) {
    throw createError('员工身份、应发工资或实发工资等关键字段不能重复映射');
  }
  return normalized;
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

async function findProfile(companyId, projectId, headerSignature, user = null) {
  const signature = normalizeSignature(headerSignature);
  if (!Number.isSafeInteger(Number(projectId)) || Number(projectId) <= 0) throw createError('项目参数不正确');
  const params = { companyId: Number(companyId), projectId: Number(projectId), headerSignature: signature };
  const scopeSql = projectScope(user, params, 'p');
  const row = await db.first(
    `SELECT sip.id,sip.project_id projectId,sip.header_signature headerSignature,
            sip.source_headers sourceHeaders,sip.mapping_json mappingJson
     FROM salary_import_profile sip
     JOIN labor_project p ON p.id=sip.project_id AND p.company_id=sip.company_id
     WHERE sip.company_id=:companyId AND sip.project_id=:projectId
       AND sip.header_signature=:headerSignature AND sip.status=1${scopeSql}
     LIMIT 1`,
    params
  );
  if (!row) return null;
  return {
    profileId: Number(row.id),
    projectId: Number(row.projectId),
    headerSignature: row.headerSignature,
    sourceHeaders: parseJsonArray(row.sourceHeaders),
    mapping: parseJsonArray(row.mappingJson)
  };
}

async function upsertProfile(connection, input) {
  const companyId = Number(input.companyId);
  const projectId = Number(input.projectId);
  if (!Number.isSafeInteger(companyId) || companyId <= 0 || !Number.isSafeInteger(projectId) || projectId <= 0) {
    throw createError('企业或项目参数不正确');
  }
  const headerSignature = normalizeSignature(input.headerSignature);
  const sourceHeaders = normalizeHeaders(input.sourceHeaders);
  const mapping = normalizeMapping(input.mapping);
  const [result] = await connection.execute(
    `INSERT INTO salary_import_profile
     (company_id,project_id,header_signature,source_headers,mapping_json,status,last_used_at,created_by)
     VALUES (:companyId,:projectId,:headerSignature,:sourceHeaders,:mappingJson,1,NOW(),:operatorId)
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),source_headers=VALUES(source_headers),
       mapping_json=VALUES(mapping_json),status=1,last_used_at=NOW(),updated_at=NOW()`,
    {
      companyId,
      projectId,
      headerSignature,
      sourceHeaders: JSON.stringify(sourceHeaders),
      mappingJson: JSON.stringify(mapping),
      operatorId: Number(input.operatorId || 0) || null
    }
  );
  return { profileId: Number(result.insertId) };
}

module.exports = {
  findProfile,
  upsertProfile,
  normalizeSignature,
  normalizeHeaders,
  normalizeMapping
};
