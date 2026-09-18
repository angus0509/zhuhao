const db = require('../db');
const env = require('../config/env');
const { createError } = require('../utils/response');
const { createWechatOfficialService } = require('./wechat-official.service');

const RETRY_DELAYS_SECONDS = [60, 300, 1800];

function createOfficialNotificationService(dependencies = {}) {
  const database = dependencies.db || db;
  const provider = dependencies.provider || createWechatOfficialService();

  async function bindEmployee({ companyId, employeeId, unionid, officialOpenid }) {
    if (!companyId || !employeeId || !officialOpenid) throw createError('服务号绑定参数不完整', 400);
    const employee = await database.first(
      `SELECT id FROM hr_employee WHERE company_id=:companyId AND id=:employeeId AND employee_status IN (2,3)`,
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工档案不存在或已停用', 404);
    if (!unionid) throw createError('服务号未返回统一UnionID，无法安全绑定', 400, 'WECHAT_OFFICIAL_UNIONID_REQUIRED');
    const sameUnion = await database.first(
      `SELECT e.id FROM hr_employee e JOIN employee_wechat_binding b ON b.employee_id=e.id AND b.company_id=e.company_id
       WHERE e.company_id=:companyId AND b.unionid=:unionid AND b.binding_status=1 LIMIT 1`,
      { companyId, unionid }
    );
    if (sameUnion && Number(sameUnion.id) !== Number(employeeId)) throw createError('该微信已绑定其他员工，无法重复绑定', 409);
    await database.query(
      `INSERT INTO employee_official_binding
       (company_id,employee_id,official_openid,unionid,binding_status,bound_at,updated_at)
       VALUES (:companyId,:employeeId,:officialOpenid,:unionid,1,NOW(),NOW())
       ON DUPLICATE KEY UPDATE official_openid=VALUES(official_openid),unionid=VALUES(unionid),binding_status=1,unbound_at=NULL,updated_at=NOW()`,
      { companyId, employeeId, officialOpenid, unionid }
    );
    return { companyId: Number(companyId), employeeId: Number(employeeId), bound: true };
  }

  async function getBindingStatus(companyId, employeeId) {
    const row = await database.first(
      `SELECT employee_id employeeId, official_openid officialOpenid, unionid, bound_at boundAt
       FROM employee_official_binding WHERE company_id=:companyId AND employee_id=:employeeId AND binding_status=1 LIMIT 1`,
      { companyId, employeeId }
    );
    return row ? { bound: true, ...row, officialOpenid: undefined, unionid: undefined } : { bound: false };
  }

  async function unbindEmployee(companyId, employeeId, operatorId) {
    const result = await database.query(
      `UPDATE employee_official_binding SET binding_status=0,unbound_at=NOW(),unbound_by=:operatorId,updated_at=NOW()
       WHERE company_id=:companyId AND employee_id=:employeeId AND binding_status=1`,
      { companyId, employeeId, operatorId: operatorId || null }
    );
    return { unbound: Number(result?.affectedRows || 0) > 0 };
  }

  async function enqueuePublishedJobs(connection, { companyId, batchId, salaryMonth, operatorId, templateKey = 'payslipPublished' }) {
    await connection.execute(
      `INSERT INTO wechat_official_notification_job
       (company_id,employee_id,batch_id,payslip_id,business_type,template_key,salary_month,delivery_status,next_attempt_at,dedupe_key,created_by)
       SELECT d.company_id,d.employee_id,d.batch_id,d.id,'PAYSLIP_PUBLISHED',:templateKey,:salaryMonth,
              CASE WHEN b.official_openid IS NULL THEN 'SKIPPED_NOT_BOUND' ELSE 'PENDING' END,NOW(),
              CONCAT('PAYSLIP_PUBLISHED:',d.company_id,':',d.batch_id,':',d.employee_id),:operatorId
       FROM salary_detail d
       LEFT JOIN employee_official_binding b ON b.employee_id=d.employee_id AND b.company_id=d.company_id AND b.binding_status=1
       WHERE d.company_id=:companyId AND d.batch_id=:batchId AND d.receipt_status=1
       ON DUPLICATE KEY UPDATE dedupe_key=dedupe_key`,
      { companyId, batchId, salaryMonth, operatorId: operatorId || null, templateKey }
    );
    const row = await connection.execute(
      `SELECT COUNT(*) total FROM wechat_official_notification_job WHERE company_id=:companyId AND batch_id=:batchId AND delivery_status='PENDING'`,
      { companyId, batchId }
    );
    return { queued: Number(row?.[0]?.[0]?.total || 0) };
  }

  async function processPendingJobs({ limit = 50 } = {}) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit || 50)));
    const jobs = await database.query(
      `SELECT j.id,j.company_id companyId,j.employee_id employeeId,j.salary_month salaryMonth,j.template_key templateKey,
              b.official_openid officialOpenid,j.attempt_count attemptCount
       FROM wechat_official_notification_job j
       JOIN employee_official_binding b
         ON b.company_id=j.company_id AND b.employee_id=j.employee_id AND b.binding_status=1
       JOIN salary_batch salary_batch
         ON salary_batch.company_id=j.company_id AND salary_batch.id=j.batch_id AND salary_batch.batch_status=5
       JOIN salary_detail salary_detail
         ON salary_detail.company_id=j.company_id AND salary_detail.id=j.payslip_id
           AND salary_detail.batch_id=j.batch_id AND salary_detail.employee_id=j.employee_id
           AND salary_detail.receipt_status=1
       WHERE j.delivery_status='PENDING' AND j.next_attempt_at<=NOW() ORDER BY j.id LIMIT ${safeLimit}`
    );
    const summary = { claimed: jobs.length, sent: 0, failed: 0 };
    for (const job of jobs) {
      let result;
      try {
        result = await provider.sendTemplate({
          openid: job.officialOpenid,
          templateId: env.wechatOfficial.templates[job.templateKey] || env.wechatOfficial.templates.payslipPublished,
          month: job.salaryMonth,
          url: 'https://lczpt.com/wx/payslip'
        });
      } catch (error) {
        result = { accepted: false, providerCode: error.providerCode || error.code || 'WECHAT_OFFICIAL_SEND_FAILED' };
      }
      const attempt = Number(job.attemptCount || 0) + 1;
      if (result.accepted) {
        await database.query(`UPDATE wechat_official_notification_job SET delivery_status='SENT',attempt_count=:attempt,provider_code=:providerCode,provider_request_id=:requestId,sent_at=NOW(),updated_at=NOW() WHERE id=:id AND company_id=:companyId`, { id: job.id, companyId: job.companyId, attempt, providerCode: result.providerCode || '0', requestId: result.providerRequestId || null });
        summary.sent += 1;
      } else {
        const retryable = attempt < RETRY_DELAYS_SECONDS.length;
        const delay = RETRY_DELAYS_SECONDS[Math.max(0, attempt - 1)] || 1800;
        await database.query(`UPDATE wechat_official_notification_job SET delivery_status=:status,attempt_count=:attempt,provider_code=:providerCode,error_summary='服务号通知发送失败',next_attempt_at=DATE_ADD(NOW(),INTERVAL :delay SECOND),updated_at=NOW() WHERE id=:id AND company_id=:companyId`, { id: job.id, companyId: job.companyId, attempt, providerCode: String(result.providerCode || 'FAILED').slice(0, 80), status: retryable ? 'PENDING' : 'FAILED', delay });
        summary.failed += 1;
      }
    }
    return summary;
  }

  async function listNotifications({ companyId, batchId, status, page = 1, pageSize = 50 }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 50));
    const params = { companyId, offset: (safePage - 1) * safePageSize, pageSize: safePageSize };
    const filters = ['j.company_id=:companyId'];
    if (batchId) { filters.push('j.batch_id=:batchId'); params.batchId = Number(batchId); }
    if (status) { filters.push('j.delivery_status=:status'); params.status = String(status); }
    const rows = await database.query(
      `SELECT j.id,j.batch_id batchId,j.employee_id employeeId,j.salary_month salaryMonth,
              j.business_type businessType,j.delivery_status deliveryStatus,j.attempt_count attemptCount,
              j.provider_code providerCode,j.error_summary errorSummary,j.sent_at sentAt,j.created_at createdAt
       FROM wechat_official_notification_job j WHERE ${filters.join(' AND ')}
       ORDER BY j.id DESC LIMIT :offset,:pageSize`, params
    );
    const total = await database.first(`SELECT COUNT(*) total FROM wechat_official_notification_job j WHERE ${filters.join(' AND ')}`, params);
    return { rows, page: safePage, pageSize: safePageSize, total: Number(total?.total || 0) };
  }

  return { bindEmployee, getBindingStatus, unbindEmployee, enqueuePublishedJobs, processPendingJobs, listNotifications, RETRY_DELAYS_SECONDS };
}

module.exports = { createOfficialNotificationService };
