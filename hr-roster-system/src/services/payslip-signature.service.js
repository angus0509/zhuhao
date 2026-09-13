const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const { validatePng } = require('../utils/png-validator');
const { createError } = require('../utils/response');

const DEFAULT_UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const MAX_SIGNATURE_BYTES = 1024 * 1024;

function employeeIdFromUser(user) {
  const employeeId = Number(user?.employeeId || 0);
  if (user?.accountType !== 'EMPLOYEE' || !employeeId) {
    throw createError('仅员工本人可以上传工资条签名', 403);
  }
  return employeeId;
}

function createPayslipSignatureService(dependencies = {}) {
  const database = dependencies.db || db;
  const filesystem = dependencies.fs || fs;
  const uploadRoot = path.resolve(dependencies.uploadRoot || DEFAULT_UPLOAD_ROOT);
  const randomUUID = dependencies.randomUUID || crypto.randomUUID;
  const now = dependencies.now || (() => new Date());
  const pngValidator = dependencies.validatePng || validatePng;

  async function uploadMySignature(companyId, payslipId, file, body = {}, user, requestMeta = {}) {
    const employeeId = employeeIdFromUser(user);
    const signedName = String(body.signedName || '').trim();
    const statementVersion = String(body.statementVersion || '1.0').trim();
    if (!signedName || signedName.length > 50) throw createError('请填写签名人姓名');
    if (statementVersion !== '1.0') throw createError('签收声明版本无效，请刷新后重试');
    if (!file?.buffer?.length) throw createError('请先完成手写签名');
    if (String(file.mimetype || '').toLowerCase() !== 'image/png'
      || path.extname(String(file.originalname || '')).toLowerCase() !== '.png') {
      throw createError('工资条签名仅支持PNG格式');
    }
    const png = pngValidator(file.buffer, {
      maxBytes: MAX_SIGNATURE_BYTES,
      maxWidth: 2048,
      maxHeight: 1024,
      maxPixels: 2_000_000
    });
    const relativePath = path.join(`company-${Number(companyId)}`, 'payslip-signatures', `${randomUUID()}.png`);
    const absolutePath = path.resolve(uploadRoot, relativePath);
    if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) throw createError('签名文件存储路径不安全');
    const signedAt = now();
    const ipAddress = String(requestMeta.ipAddress || '').slice(0, 50) || null;
    const deviceInfo = String(requestMeta.deviceInfo || '').slice(0, 255) || null;

    await filesystem.mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
    await filesystem.writeFile(absolutePath, file.buffer, { mode: 0o600, flag: 'wx' });
    try {
      return await database.transaction(async connection => {
        const [rows] = await connection.execute(
          `SELECT d.id,e.name employeeName,d.receipt_status receiptStatus,
                  signature.id activeSignatureId,dispute.id openDisputeId
           FROM salary_detail d
           JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id AND b.batch_status=5
           JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
             AND e.employee_status IN (2,3) AND e.deleted_at IS NULL
           LEFT JOIN salary_signature signature ON signature.company_id=d.company_id
             AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
           LEFT JOIN salary_dispute dispute ON dispute.company_id=d.company_id
             AND dispute.salary_detail_id=d.id AND dispute.employee_id=d.employee_id
             AND dispute.handle_status IN (0,1)
           WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
           LIMIT 1 FOR UPDATE`,
          { companyId, payslipId: Number(payslipId), employeeId }
        );
        const payslip = rows[0];
        if (!payslip) throw createError('工资条不存在或无本人访问权限', 404);
        if (Number(payslip.receiptStatus) !== 1) throw createError('工资条当前状态不能签名');
        if (Number(payslip.openDisputeId || 0) > 0) throw createError('工资条异议处理中，不能签名');
        if (Number(payslip.activeSignatureId || 0) > 0) throw createError('工资条已经完成签名');
        if (signedName !== String(payslip.employeeName || '').trim()) {
          throw createError('签名姓名必须与员工档案一致');
        }

        const [attachmentResult] = await connection.execute(
          `INSERT INTO hr_attachment
           (company_id,biz_type,biz_id,employee_id,storage_path,original_name,file_size,mime_type,file_sha256,status,created_by)
           VALUES (:companyId,:bizType,:payslipId,:employeeId,:storagePath,:originalName,:fileSize,'image/png',:fileSha256,1,:userId)`,
          {
            companyId,
            bizType: 'payslip_signature',
            payslipId: Number(payslipId),
            employeeId,
            storagePath: relativePath,
            originalName: '工资条手写签名.png',
            fileSize: file.buffer.length,
            fileSha256: png.sha256,
            userId: Number(user.id)
          }
        );
        const [signatureResult] = await connection.execute(
          `INSERT INTO salary_signature
           (company_id,salary_detail_id,employee_id,attachment_id,signature_sha256,signed_name,
            statement_version,ip_address,device_info,signed_at,status)
           VALUES (:companyId,:payslipId,:employeeId,:attachmentId,:signatureSha256,:signedName,
             :statementVersion,:ipAddress,:deviceInfo,:signedAt,1)`,
          {
            companyId,
            payslipId: Number(payslipId),
            employeeId,
            attachmentId: Number(attachmentResult.insertId),
            signatureSha256: png.sha256,
            signedName,
            statementVersion,
            ipAddress,
            deviceInfo,
            signedAt
          }
        );
        return {
          signatureId: Number(signatureResult.insertId),
          signedName,
          signedAt: signedAt.toISOString()
        };
      });
    } catch (error) {
      await filesystem.unlink(absolutePath).catch(() => {});
      throw error;
    }
  }

  return { uploadMySignature };
}

const service = createPayslipSignatureService();

module.exports = {
  ...service,
  createPayslipSignatureService,
  DEFAULT_UPLOAD_ROOT,
  MAX_SIGNATURE_BYTES
};
