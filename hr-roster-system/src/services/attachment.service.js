const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const { createError } = require('../utils/response');
const { assertEmployeeScope } = require('./employee.service');

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const BUSINESS_TYPES = {
  contract: { table: 'hr_labor_contract', permission: 'contract:manage', label: '劳动合同' },
  social: { table: 'hr_social_security', permission: 'social:manage', label: '保险材料' },
  certificate: { table: 'hr_employee_certificate', permission: 'cert:manage', label: '员工证件' },
  risk_case: { table: 'hr_risk_case', permission: 'risk:handle', label: '整改证据' }
};

function assertBusinessType(bizType) {
  const normalized = String(bizType || '').trim();
  if (!BUSINESS_TYPES[normalized]) throw createError('附件业务类型不正确');
  return normalized;
}

function assertPermission(user, permission) {
  if (!user?.permissions?.includes(permission)) throw createError('无附件操作权限', 403);
}

async function resolveBusiness(companyId, bizType, bizId, user, operation = 'view') {
  const type = assertBusinessType(bizType);
  const id = Number(bizId);
  if (!Number.isInteger(id) || id <= 0) throw createError('附件关联业务ID不正确');
  const config = BUSINESS_TYPES[type];
  if (operation === 'upload') assertPermission(user, config.permission);
  if (type === 'risk_case' && operation !== 'upload' && !user?.permissions?.includes('risk:view')) {
    throw createError('无风险材料查看权限', 403);
  }

  let row;
  if (type === 'risk_case') {
    row = await db.first(
      `SELECT r.employee_id employeeId FROM hr_risk_case c
       JOIN hr_risk_alert r ON r.id=c.source_alert_id AND r.company_id=c.company_id
       WHERE c.company_id=:companyId AND c.id=:bizId LIMIT 1`,
      { companyId, bizId: id }
    );
  } else {
    row = await db.first(
      `SELECT employee_id employeeId FROM ${config.table}
       WHERE company_id=:companyId AND id=:bizId LIMIT 1`,
      { companyId, bizId: id }
    );
  }
  if (!row) throw createError(`${config.label}记录不存在`, 404);
  await assertEmployeeScope(companyId, Number(row.employeeId), user);
  return { type, id, employeeId: Number(row.employeeId), config };
}

function formatAttachment(row) {
  return {
    id: Number(row.id),
    bizType: row.bizType,
    bizId: Number(row.bizId),
    originalName: row.originalName,
    fileSize: Number(row.fileSize),
    mimeType: row.mimeType,
    fileSha256: row.fileSha256,
    categoryName: BUSINESS_TYPES[row.bizType]?.label || '合规材料',
    createdByName: row.createdByName || '',
    createdAt: row.createdAt,
    downloadUrl: `/api/attachments/${row.id}/download`
  };
}

async function uploadAttachment(companyId, body, file, operatorId, user) {
  if (!file?.buffer?.length) throw createError('请选择需要上传的附件');
  const context = await resolveBusiness(companyId, body.bizType, body.bizId, user, 'upload');
  const extension = path.extname(file.originalname || '').toLowerCase();
  const storedName = `${crypto.randomUUID()}${extension}`;
  const relativePath = path.join(`company-${companyId}`, storedName);
  const absolutePath = path.resolve(UPLOAD_ROOT, relativePath);
  if (!absolutePath.startsWith(`${UPLOAD_ROOT}${path.sep}`)) throw createError('附件存储路径不安全');
  const originalName = path.basename(String(file.originalname || '附件')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
  const fileSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

  await fs.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(absolutePath, file.buffer, { mode: 0o600, flag: 'wx' });
  try {
    const result = await db.transaction(async connection => {
      const [insertResult] = await connection.execute(
        `INSERT INTO hr_attachment
         (company_id,biz_type,biz_id,employee_id,storage_path,original_name,file_size,mime_type,file_sha256,status,created_by)
         VALUES (:companyId,:bizType,:bizId,:employeeId,:storagePath,:originalName,:fileSize,:mimeType,:fileSha256,1,:operatorId)`,
        {
          companyId,
          bizType: context.type,
          bizId: context.id,
          employeeId: context.employeeId,
          storagePath: relativePath,
          originalName,
          fileSize: file.size,
          mimeType: file.mimetype,
          fileSha256,
          operatorId
        }
      );
      await connection.execute(
        `INSERT INTO hr_operation_log
         (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
         VALUES (:companyId,:operatorId,'合规附件','attachment',:attachmentId,'upload',:afterData)`,
        {
          companyId,
          operatorId,
          attachmentId: insertResult.insertId,
          afterData: JSON.stringify({ bizType: context.type, bizId: context.id, employeeId: context.employeeId, originalName, fileSha256 })
        }
      );
      return insertResult.insertId;
    });
    return getAttachment(companyId, result, user);
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => {});
    throw error;
  }
}

async function getAttachment(companyId, attachmentId, user, includeStoragePath = false) {
  const row = await db.first(
    `SELECT a.id,a.biz_type bizType,a.biz_id bizId,a.employee_id employeeId,a.storage_path storagePath,
            a.original_name originalName,a.file_size fileSize,a.mime_type mimeType,a.file_sha256 fileSha256,
            a.created_at createdAt,u.real_name createdByName
     FROM hr_attachment a LEFT JOIN sys_user u ON u.id=a.created_by AND u.company_id=a.company_id
     WHERE a.company_id=:companyId AND a.id=:attachmentId AND a.status=1 LIMIT 1`,
    { companyId, attachmentId: Number(attachmentId) }
  );
  if (!row) throw createError('附件不存在', 404);
  await resolveBusiness(companyId, row.bizType, row.bizId, user, 'view');
  const attachment = formatAttachment(row);
  if (includeStoragePath) attachment.storagePath = row.storagePath;
  return attachment;
}

async function listAttachments(companyId, query, user) {
  const context = await resolveBusiness(companyId, query.bizType, query.bizId, user, 'view');
  const rows = await db.query(
    `SELECT a.id,a.biz_type bizType,a.biz_id bizId,a.original_name originalName,a.file_size fileSize,
            a.mime_type mimeType,a.file_sha256 fileSha256,a.created_at createdAt,u.real_name createdByName
     FROM hr_attachment a LEFT JOIN sys_user u ON u.id=a.created_by AND u.company_id=a.company_id
     WHERE a.company_id=:companyId AND a.biz_type=:bizType AND a.biz_id=:bizId AND a.status=1
     ORDER BY a.id DESC`,
    { companyId, bizType: context.type, bizId: context.id }
  );
  return rows.map(formatAttachment);
}

async function listEmployeeAttachments(companyId, employeeId, user) {
  await assertEmployeeScope(companyId, Number(employeeId), user);
  const excludeRisk = user?.permissions?.includes('risk:view') ? '' : "AND a.biz_type<>'risk_case'";
  const rows = await db.query(
    `SELECT a.id,a.biz_type bizType,a.biz_id bizId,a.original_name originalName,a.file_size fileSize,
            a.mime_type mimeType,a.file_sha256 fileSha256,a.created_at createdAt,u.real_name createdByName
     FROM hr_attachment a LEFT JOIN sys_user u ON u.id=a.created_by AND u.company_id=a.company_id
     WHERE a.company_id=:companyId AND a.employee_id=:employeeId AND a.status=1 ${excludeRisk}
     ORDER BY a.id DESC`,
    { companyId, employeeId: Number(employeeId) }
  );
  return rows.map(formatAttachment);
}

async function resolveDownload(companyId, attachmentId, user) {
  const attachment = await getAttachment(companyId, attachmentId, user, true);
  const absolutePath = path.resolve(UPLOAD_ROOT, attachment.storagePath);
  if (!absolutePath.startsWith(`${UPLOAD_ROOT}${path.sep}`)) throw createError('附件存储路径不安全');
  try {
    await fs.access(absolutePath);
  } catch (_error) {
    throw createError('附件文件不存在，请联系管理员检查备份', 404);
  }
  return { ...attachment, absolutePath };
}

module.exports = {
  UPLOAD_ROOT,
  BUSINESS_TYPES,
  uploadAttachment,
  listAttachments,
  listEmployeeAttachments,
  resolveDownload
};
