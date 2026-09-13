const crypto = require('crypto');
const db = require('../db');
const env = require('../config/env');
const smsProvider = require('./tencent-sms.service');
const { projectScope } = require('../utils/data-scope');
const { createError } = require('../utils/response');

const RETRY_DELAYS_SECONDS = [60, 300, 1800];

function normalizeMiniProgramLoginUrlLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    return '';
  }
  // 腾讯云短信引流报备要求使用已备案的自有域名中转页；
  // 只允许优企云固定入口，禁止 query/hash，避免携带员工身份、工资条 ID 或 Token。
  if (parsed.protocol !== 'https:'
    || parsed.hostname !== 'lczpt.com'
    || parsed.pathname !== '/wx/payslip'
    || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) {
    return '';
  }
  return parsed.toString();
}

function userFacingProviderError(code, message) {
  const normalizedCode = String(code || '');
  const normalizedMessage = String(message || '');
  if (/PhoneNumberOneHourLimit/i.test(normalizedCode)
    || /single mobile number within 1 hour exceeds/i.test(normalizedMessage)) {
    return '同一手机号一小时发送次数已达上限，请稍后重试';
  }
  if (/PhoneNumberDailyLimit|DailyLimit/i.test(normalizedCode)) {
    return '同一手机号当日发送次数已达上限，请明日再试';
  }
  if (/PhoneNumber/i.test(normalizedCode) && /Invalid|Format/i.test(normalizedCode)) {
    return '手机号格式不正确，请核对员工手机号';
  }
  if (/Template|Sign/i.test(normalizedCode)) {
    return '短信签名或模板配置异常，请联系管理员处理';
  }
  if (/Balance|Insufficient/i.test(normalizedCode)) {
    return '短信账户余额不足，请联系管理员处理';
  }
  if (/Limit|Frequency|RequestLimit/i.test(normalizedCode)) {
    return '短信发送过于频繁，请稍后重试';
  }
  if (/Internal|Timeout|Unavailable/i.test(normalizedCode)) {
    return '短信服务暂时不可用，请稍后重试';
  }
  if (/[一-鿿]/.test(normalizedMessage)) return normalizedMessage.slice(0, 255);
  return normalizedMessage ? '短信发送失败，请稍后重试' : '';
}

function deliveryStatusName(status) {
  return {
    PENDING: '待发送',
    SENDING: '发送中',
    SENT: '发送成功',
    FAILED: '发送失败',
    SKIPPED_NO_PHONE: '无有效手机号',
    CANCELLED: '已取消'
  }[String(status || '')] || '未知状态';
}

function createSmsDeliveryService(dependencies = {}) {
  const database = dependencies.db || db;
  const provider = dependencies.smsProvider || smsProvider;
  const hmacSecret = dependencies.hmacSecret ?? env.smsCode.hmacSecret;
  const payslipUrlLink = normalizeMiniProgramLoginUrlLink(
    dependencies.payslipUrlLink ?? env.tencentSms.payslipUrlLink
  );

  function phoneHash(companyId, phone) {
    if (Buffer.byteLength(String(hmacSecret || ''), 'utf8') < 32) return null;
    return crypto.createHmac('sha256', hmacSecret)
      .update(`delivery-phone:${companyId}:${phone}`)
      .digest('hex');
  }

  async function enqueuePublishedJobs(connection, { companyId, batchId, salaryMonth, operatorId }) {
    await connection.execute(
      `INSERT INTO sms_delivery_job
       (company_id,employee_id,batch_id,payslip_id,business_type,template_key,salary_month,phone_tail,
        delivery_status,next_attempt_at,dedupe_key,created_by)
       SELECT d.company_id,d.employee_id,d.batch_id,d.id,'PAYSLIP_PUBLISHED','payslipPublished',:salaryMonth,
              CASE WHEN e.phone REGEXP '^1[0-9]{10}$' THEN RIGHT(e.phone,4) ELSE NULL END,
              CASE WHEN e.phone REGEXP '^1[0-9]{10}$' THEN 'PENDING' ELSE 'SKIPPED_NO_PHONE' END,
              NOW(),CONCAT('PAYSLIP_PUBLISHED:',d.company_id,':',d.batch_id,':',d.employee_id),:operatorId
       FROM salary_detail d
       JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
       WHERE d.company_id=:companyId AND d.batch_id=:batchId AND d.receipt_status=1
       ON DUPLICATE KEY UPDATE dedupe_key=dedupe_key`,
      { companyId, batchId, salaryMonth, operatorId: operatorId || null }
    );
    const [summaryRows] = await connection.execute(
      `SELECT
         SUM(CASE WHEN delivery_status='PENDING' THEN 1 ELSE 0 END) queued,
         SUM(CASE WHEN delivery_status='SKIPPED_NO_PHONE' THEN 1 ELSE 0 END) skippedNoPhone
       FROM sms_delivery_job
       WHERE company_id=:companyId AND batch_id=:batchId AND business_type='PAYSLIP_PUBLISHED'`,
      { companyId, batchId }
    );
    return {
      queued: Number(summaryRows[0]?.queued || 0),
      skippedNoPhone: Number(summaryRows[0]?.skippedNoPhone || 0)
    };
  }

  async function claimPendingJobs(limit) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit || 100)));
    return database.transaction(async connection => {
      const [rows] = await connection.execute(
        `SELECT id,company_id,employee_id,batch_id,payslip_id,business_type,template_key,salary_month,attempt_count
         FROM sms_delivery_job
         WHERE delivery_status='PENDING' AND next_attempt_at<=NOW()
         ORDER BY id LIMIT ${safeLimit} FOR UPDATE SKIP LOCKED`
      );
      if (!rows.length) return [];
      const ids = rows.map(row => Number(row.id)).filter(Number.isInteger);
      await connection.execute(
        `UPDATE sms_delivery_job SET delivery_status='SENDING',last_attempt_at=NOW(),updated_at=NOW()
         WHERE id IN (${ids.join(',')}) AND delivery_status='PENDING'`
      );
      return rows;
    });
  }

  function paramsForJob() {
    // 当前工资条发布/提醒统一使用腾讯云已生效的无变量模板 2727678。
    // 腾讯云会严格校验模板变量数量，因此不得继续传入历史链接参数。
    return [];
  }

  function retryableCode(code) {
    const normalized = String(code || '');
    if (/PhoneNumber(?:OneHour|Daily)Limit|DailyLimit/i.test(normalized)) return false;
    return /Limit|Frequency|Internal|Timeout|Unavailable|RequestLimit/i.test(normalized);
  }

  async function markSkipped(jobId, companyId, status, summary) {
    await database.query(
      `UPDATE sms_delivery_job
       SET delivery_status=:status,error_summary=:summary,updated_at=NOW()
       WHERE id=:jobId AND company_id=:companyId AND delivery_status='SENDING'`,
      { jobId, companyId, status, summary: String(summary || '').slice(0, 255) }
    );
  }

  async function sendJob(job) {
    const companyId = Number(job.company_id ?? job.companyId);
    const jobId = Number(job.id);
    const current = await database.first(
      `SELECT j.id,e.id employeeId,e.phone,e.employee_status employeeStatus,
              d.receipt_status receiptStatus
       FROM sms_delivery_job j
       JOIN hr_employee e ON e.id=j.employee_id AND e.company_id=j.company_id
       LEFT JOIN salary_detail d ON d.id=j.payslip_id AND d.company_id=j.company_id
       WHERE j.company_id=:companyId AND j.id=:jobId LIMIT 1`,
      { companyId, jobId }
    );
    if (!current || ![2, 3].includes(Number(current.employeeStatus))) {
      await markSkipped(jobId, companyId, 'CANCELLED', '员工档案已停用');
      return 'skipped';
    }
    if (Number(current.receiptStatus) !== 1) {
      await markSkipped(jobId, companyId, 'CANCELLED', '工资条已处理，无需提醒');
      return 'skipped';
    }
    const phone = String(current.phone || '').trim();
    if (!/^1\d{10}$/.test(phone)) {
      await markSkipped(jobId, companyId, 'SKIPPED_NO_PHONE', '员工未登记有效手机号');
      return 'skipped';
    }

    let result;
    try {
      result = await provider.sendTemplate({
        phone,
        templateKey: job.template_key ?? job.templateKey,
        params: paramsForJob(job)
      });
    } catch (error) {
      result = {
        accepted: false,
        providerCode: error.businessCode || 'SMS_PROVIDER_UNAVAILABLE',
        providerMessage: '短信服务暂时不可用',
        requestId: '',
        serialNo: ''
      };
    }

    const attemptCount = Number((job.attempt_count ?? job.attemptCount) || 0) + 1;
    if (result.accepted) {
      await database.query(
        `UPDATE sms_delivery_job SET delivery_status='SENT',attempt_count=:attemptCount,
         phone_hash=:phoneHash,phone_tail=:phoneTail,provider_code=:providerCode,
         provider_request_id=:requestId,provider_serial_no=:serialNo,error_summary=NULL,sent_at=NOW(),updated_at=NOW()
         WHERE id=:jobId AND company_id=:companyId AND delivery_status='SENDING'`,
        {
          jobId, companyId, attemptCount, phoneHash: phoneHash(companyId, phone), phoneTail: phone.slice(-4),
          providerCode: result.providerCode || 'Ok', requestId: result.requestId || null,
          serialNo: result.serialNo || null
        }
      );
      return 'sent';
    }

    const retryable = retryableCode(result.providerCode) && attemptCount < RETRY_DELAYS_SECONDS.length;
    const delaySeconds = RETRY_DELAYS_SECONDS[Math.max(0, attemptCount - 1)] || 1800;
    await database.query(
      `UPDATE sms_delivery_job SET delivery_status=:deliveryStatus,attempt_count=:attemptCount,
       phone_hash=:phoneHash,phone_tail=:phoneTail,provider_code=:providerCode,
       provider_request_id=:requestId,provider_serial_no=:serialNo,error_summary=:errorSummary,
       next_attempt_at=DATE_ADD(NOW(),INTERVAL :delaySeconds SECOND),updated_at=NOW()
       WHERE id=:jobId AND company_id=:companyId AND delivery_status='SENDING'`,
      {
        jobId, companyId, attemptCount, phoneHash: phoneHash(companyId, phone), phoneTail: phone.slice(-4),
        providerCode: String(result.providerCode || 'FAILED').slice(0, 80),
        requestId: result.requestId || null, serialNo: result.serialNo || null,
        errorSummary: userFacingProviderError(result.providerCode, result.providerMessage || '短信发送失败'),
        deliveryStatus: retryable ? 'PENDING' : 'FAILED', delaySeconds
      }
    );
    return 'failed';
  }

  async function processPendingJobs({ limit = 100 } = {}) {
    const jobs = await claimPendingJobs(limit);
    const summary = { claimed: jobs.length, sent: 0, failed: 0, skipped: 0 };
    for (const job of jobs) {
      const outcome = await sendJob(job);
      if (outcome === 'sent') summary.sent += 1;
      else if (outcome === 'failed') summary.failed += 1;
      else summary.skipped += 1;
    }
    return summary;
  }

  async function getScopedBatch(companyId, batchId, user) {
    const params = { companyId, batchId: Number(batchId) };
    const batch = await database.first(
      `SELECT b.id,b.salary_month salaryMonth,b.batch_status batchStatus,p.id projectId
       FROM salary_batch b
       JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       WHERE b.company_id=:companyId AND b.id=:batchId ${projectScope(user, params, 'p')}`,
      params
    );
    if (!batch) throw createError('工资批次不存在或无项目权限', 404);
    return batch;
  }

  async function getBatchSummary({ companyId, batchId, user }) {
    await getScopedBatch(companyId, batchId, user);
    const params = { companyId, batchId: Number(batchId) };
    const totals = await database.first(
      `SELECT COUNT(*) total,
              SUM(j.delivery_status='PENDING') pending,
              SUM(j.delivery_status='SENDING') sending,
              SUM(j.delivery_status='SENT') sent,
              SUM(j.delivery_status='FAILED') failed,
              SUM(j.delivery_status='SKIPPED_NO_PHONE') skippedNoPhone,
              SUM(CASE WHEN j.delivery_status IN ('FAILED','SKIPPED_NO_PHONE')
                    AND d.receipt_status=1 AND e.employee_status IN (2,3) AND e.deleted_at IS NULL
                    AND e.phone REGEXP '^1[0-9]{10}$' THEN 1 ELSE 0 END) retryableCount
       FROM sms_delivery_job j
       LEFT JOIN salary_detail d ON d.id=j.payslip_id AND d.company_id=j.company_id
       LEFT JOIN hr_employee e ON e.id=j.employee_id AND e.company_id=j.company_id
       WHERE j.company_id=:companyId AND j.batch_id=:batchId`,
      params
    );
    const items = await database.query(
      `SELECT j.employee_id employeeId,e.name employeeName,j.phone_tail phoneTail,
              d.receipt_status receiptStatus,j.delivery_status deliveryStatus,
              j.last_attempt_at lastAttemptAt,j.error_summary errorSummary
       FROM sms_delivery_job j
       JOIN hr_employee e ON e.id=j.employee_id AND e.company_id=j.company_id
       LEFT JOIN salary_detail d ON d.id=j.payslip_id AND d.company_id=j.company_id
       WHERE j.company_id=:companyId AND j.batch_id=:batchId
       ORDER BY j.id DESC LIMIT 500`,
      params
    );
    return {
      total: Number(totals?.total || 0),
      pending: Number(totals?.pending || 0) + Number(totals?.sending || 0),
      sent: Number(totals?.sent || 0),
      failed: Number(totals?.failed || 0),
      skippedNoPhone: Number(totals?.skippedNoPhone || 0),
      retryableCount: Number(totals?.retryableCount || 0),
      items: items.map(item => ({
        employeeId: Number(item.employeeId),
        employeeName: item.employeeName || '',
        phoneTail: item.phoneTail || '',
        receiptStatus: Number(item.receiptStatus || 0),
        deliveryStatus: item.deliveryStatus,
        deliveryStatusName: deliveryStatusName(item.deliveryStatus),
        lastAttemptAt: item.lastAttemptAt || null,
        errorSummary: userFacingProviderError('', item.errorSummary)
      }))
    };
  }

  async function enqueueReminderJobs({ companyId, batchId, operatorId, user, confirmed }) {
    if (confirmed !== true) throw createError('请确认后再发送催签短信');
    const batch = await getScopedBatch(companyId, batchId, user);
    if (Number(batch.batchStatus) !== 5) throw createError('仅已发布工资批次可发送催签短信');
    const stats = await database.first(
      `SELECT COUNT(*) total,
              SUM(CASE WHEN e.phone REGEXP '^1[0-9]{10}$' THEN 0 ELSE 1 END) skippedNoPhone
       FROM salary_detail d
       JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
       WHERE d.company_id=:companyId AND d.batch_id=:batchId AND d.receipt_status=1`,
      { companyId, batchId }
    );
    const total = Number(stats?.total || 0);
    if (total > 500) throw createError('单次催签不能超过500人，请分批处理');
    if (!total) return { created: 0, suppressed: 0, skippedNoPhone: 0 };

    const result = await database.query(
      `INSERT INTO sms_delivery_job
       (company_id,employee_id,batch_id,payslip_id,business_type,template_key,salary_month,phone_tail,
        delivery_status,next_attempt_at,dedupe_key,created_by)
       SELECT d.company_id,d.employee_id,d.batch_id,d.id,'PAYSLIP_REMINDER','payslipReminder',:salaryMonth,
              CASE WHEN e.phone REGEXP '^1[0-9]{10}$' THEN RIGHT(e.phone,4) ELSE NULL END,
              CASE WHEN e.phone REGEXP '^1[0-9]{10}$' THEN 'PENDING' ELSE 'SKIPPED_NO_PHONE' END,
              NOW(),CONCAT('PAYSLIP_REMINDER:',d.company_id,':',d.batch_id,':',d.employee_id,':',FLOOR(UNIX_TIMESTAMP()/43200)),
              :operatorId
       FROM salary_detail d
       JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
       WHERE d.company_id=:companyId AND d.batch_id=:batchId AND d.receipt_status=1
       ON DUPLICATE KEY UPDATE dedupe_key=dedupe_key`,
      {
        companyId,
        batchId,
        salaryMonth: batch.salaryMonth,
        operatorId: operatorId || null
      }
    );
    await database.query(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'sms_remind',
         JSON_OBJECT('candidateCount',:total))`,
      { companyId, operatorId, batchId, total }
    );
    const skippedNoPhone = Number(stats?.skippedNoPhone || 0);
    return {
      created: Math.max(0, Math.min(total - skippedNoPhone, Number(result.affectedRows || 0))),
      suppressed: Math.max(0, total - Number(result.affectedRows || 0)),
      skippedNoPhone
    };
  }

  async function retryFailedJobs({ companyId, batchId, operatorId, user, confirmed }) {
    if (confirmed !== true) throw createError('请确认后再补发失败短信');
    await getScopedBatch(companyId, batchId, user);
    const result = await database.query(
      `UPDATE sms_delivery_job j
       JOIN salary_detail d ON d.id=j.payslip_id AND d.company_id=j.company_id
       JOIN hr_employee e ON e.id=j.employee_id AND e.company_id=j.company_id
       SET j.delivery_status='PENDING',j.attempt_count=0,j.next_attempt_at=NOW(),
           j.error_summary=NULL,j.updated_at=NOW()
       WHERE j.company_id=:companyId AND j.batch_id=:batchId
         AND j.delivery_status IN ('FAILED','SKIPPED_NO_PHONE')
         AND d.receipt_status=1 AND e.employee_status IN (2,3) AND e.deleted_at IS NULL
         AND e.phone REGEXP '^1[0-9]{10}$'`,
      { companyId, batchId }
    );
    await database.query(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'sms_retry',
         JSON_OBJECT('queued',:queued))`,
      { companyId, operatorId, batchId, queued: Number(result.affectedRows || 0) }
    );
    return { queued: Number(result.affectedRows || 0), cancelledAlreadySigned: 0 };
  }

  return {
    enqueuePublishedJobs,
    processPendingJobs,
    getBatchSummary,
    enqueueReminderJobs,
    retryFailedJobs,
    _testing: {
      paramsForJob, retryableCode, userFacingProviderError, deliveryStatusName,
      normalizeMiniProgramLoginUrlLink
    }
  };
}

const service = createSmsDeliveryService();

module.exports = {
  ...service,
  createSmsDeliveryService,
  formatErrorSummary: userFacingProviderError
};
