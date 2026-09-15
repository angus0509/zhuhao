const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const { projectScope } = require('../utils/data-scope');
const { createError } = require('../utils/response');
const { DEFAULT_UPLOAD_ROOT } = require('./payslip-signature.service');

function createPayrollSignaturePreviewService(dependencies = {}) {
  const database = dependencies.db || db;
  const filesystem = dependencies.fs || fs;
  const uploadRoot = path.resolve(dependencies.uploadRoot || DEFAULT_UPLOAD_ROOT);

  async function resolveFile(row, missingMessage) {
    if (!row) throw createError(missingMessage, 404);
    if (String(row.mimeType || '').toLowerCase() !== 'image/png') {
      throw createError('签名文件类型异常，请联系管理员', 409);
    }
    const absolutePath = path.resolve(uploadRoot, String(row.storagePath || ''));
    if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw createError('签名文件存储路径不安全', 400);
    }
    try {
      await filesystem.access(absolutePath);
    } catch (_error) {
      throw createError('签名文件不存在，请联系管理员检查备份', 404);
    }
    return {
      payslipId: Number(row.payslipId || 0),
      employeeId: Number(row.employeeId || 0),
      signedName: row.signedName || '',
      signedAt: row.signedAt || null,
      originalName: row.originalName || '工资条手写签名.png',
      mimeType: 'image/png',
      absolutePath
    };
  }

  async function resolveManagerSignature(companyId, payslipId, user) {
    const normalizedPayslipId = Number(payslipId);
    if (!Number.isSafeInteger(normalizedPayslipId) || normalizedPayslipId <= 0) {
      throw createError('工资条参数无效');
    }
    const params = { companyId: Number(companyId), payslipId: normalizedPayslipId };
    const row = await database.first(
      `SELECT d.id payslipId,d.employee_id employeeId,
              signature.signed_name signedName,signature.signed_at signedAt,
              attachment.storage_path storagePath,attachment.mime_type mimeType,
              attachment.original_name originalName
       FROM salary_detail d
       JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       JOIN salary_signature signature ON signature.company_id=d.company_id
         AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
       JOIN hr_attachment attachment ON attachment.id=signature.attachment_id
         AND attachment.company_id=signature.company_id AND attachment.employee_id=signature.employee_id
         AND attachment.biz_type='payslip_signature' AND attachment.biz_id=d.id AND attachment.status=1
       WHERE d.company_id=:companyId AND d.id=:payslipId ${projectScope(user, params, 'p')}
       LIMIT 1`,
      params
    );
    const result = await resolveFile(row, '员工签名不存在或无项目权限');
    await database.query(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_detail',:payslipId,'view_signature',
         JSON_OBJECT('employeeId',:employeeId,'signedAt',:signedAt))`,
      {
        companyId: Number(companyId),
        operatorId: Number(user?.id || 0) || null,
        payslipId: normalizedPayslipId,
        employeeId: Number(row.employeeId || 0),
        signedAt: row.signedAt || null
      }
    );
    return { ...result, payslipId: result.payslipId || normalizedPayslipId };
  }

  async function resolveEmployeeSignature(companyId, payslipId, user) {
    const normalizedPayslipId = Number(payslipId);
    const employeeId = Number(user?.employeeId || 0);
    if (!Number.isSafeInteger(normalizedPayslipId) || normalizedPayslipId <= 0) {
      throw createError('工资条参数无效');
    }
    if (user?.accountType !== 'EMPLOYEE' || !employeeId) {
      throw createError('仅员工本人可以查看工资条签名', 403);
    }
    const row = await database.first(
      `SELECT d.id payslipId,d.employee_id employeeId,
              signature.signed_name signedName,signature.signed_at signedAt,
              attachment.storage_path storagePath,attachment.mime_type mimeType,
              attachment.original_name originalName
       FROM salary_detail d
       JOIN salary_signature signature ON signature.company_id=d.company_id
         AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
       JOIN hr_attachment attachment ON attachment.id=signature.attachment_id
         AND attachment.company_id=signature.company_id AND attachment.employee_id=signature.employee_id
         AND attachment.biz_type='payslip_signature' AND attachment.biz_id=d.id AND attachment.status=1
       WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
       LIMIT 1`,
      { companyId: Number(companyId), payslipId: normalizedPayslipId, employeeId }
    );
    const result = await resolveFile(row, '工资条签名不存在或无本人访问权限');
    return { mimeType: result.mimeType, file: result.absolutePath };
  }

  return { resolveManagerSignature, resolveEmployeeSignature };
}

module.exports = {
  ...createPayrollSignaturePreviewService(),
  createPayrollSignaturePreviewService
};
