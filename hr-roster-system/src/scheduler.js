const db = require('./db');
const riskService = require('./services/risk.service');
const smsDeliveryService = require('./services/sms-delivery.service');
const officialNotificationService = require('./services/official-notification.service').createOfficialNotificationService();

const DAILY_SCAN_HOUR = 2;
const SMS_DELIVERY_INTERVAL_MS = 60 * 1000;
let scanRunning = false;
let smsDeliveryRunning = false;
let schedulerTimer = null;
let smsDeliveryTimer = null;
let officialNotificationRunning = false;

function millisecondsUntilNextRun(now = new Date()) {
  const next = new Date(now);
  next.setHours(DAILY_SCAN_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function recordScanResult(companyId, result) {
  await db.query(
    `INSERT INTO hr_risk_scan_log
     (company_id,scan_type,risk_count,new_risk_count,scan_status,error_message,started_at,completed_at)
     VALUES (:companyId,'scheduled',:riskCount,:newRiskCount,:scanStatus,:errorMessage,:startedAt,NOW())`,
    {
      companyId,
      riskCount: Number(result.riskCount || 0),
      newRiskCount: Number(result.newRiskCount || 0),
      scanStatus: Number(result.scanStatus || 1),
      errorMessage: result.errorMessage || null,
      startedAt: result.startedAt
    }
  );
}

async function scanAllCompanies() {
  if (scanRunning) return { skipped: true, reason: 'previous_scan_running' };
  scanRunning = true;
  const summary = { companyCount: 0, successCount: 0, failureCount: 0, newRiskCount: 0 };
  try {
    const companies = await db.query('SELECT id FROM hr_company WHERE status=1 ORDER BY id');
    summary.companyCount = companies.length;
    for (const company of companies) {
      const companyId = Number(company.id);
      const startedAt = new Date();
      try {
        const scanResult = await riskService.scanRisks(companyId);
        const riskCountRow = await db.first(
          'SELECT COUNT(*) total FROM hr_risk_alert WHERE company_id=:companyId AND handle_status IN (0,1)',
          { companyId }
        );
        await recordScanResult(companyId, {
          riskCount: Number(riskCountRow?.total || 0),
          newRiskCount: Number(scanResult.created || 0),
          scanStatus: 1,
          startedAt
        });
        summary.successCount += 1;
        summary.newRiskCount += Number(scanResult.created || 0);
      } catch (error) {
        summary.failureCount += 1;
        try {
          await recordScanResult(companyId, {
            scanStatus: 2,
            errorMessage: String(error.message || error).slice(0, 500),
            startedAt
          });
        } catch (logError) {
          console.error(`[Scheduler] 企业${companyId}扫描失败且日志写入失败`, logError);
        }
        console.error(`[Scheduler] 企业${companyId}风险扫描失败`, error);
      }
    }
    return summary;
  } finally {
    scanRunning = false;
  }
}

function safeErrorIdentity(error) {
  const sanitize = value => String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 80);
  return {
    name: sanitize(error?.name) || 'Error',
    code: sanitize(error?.code || error?.businessCode) || 'SMS_DELIVERY_FAILED'
  };
}

async function runSmsDelivery() {
  if (smsDeliveryRunning) return { skipped: true, reason: 'previous_sms_delivery_running' };
  smsDeliveryRunning = true;
  try {
    const result = await smsDeliveryService.processPendingJobs({ limit: 100 });
    const summary = {
      claimed: Number(result?.claimed || 0),
      sent: Number(result?.sent || 0),
      failed: Number(result?.failed || 0),
      skipped: Number(result?.skipped || 0)
    };
    console.log('[Scheduler] 短信队列处理完成', summary);
    return summary;
  } catch (error) {
    const identity = safeErrorIdentity(error);
    console.error('[Scheduler] 短信队列处理异常', identity);
    return { failed: true, code: identity.code };
  } finally {
    smsDeliveryRunning = false;
  }
}

async function runOfficialNotification() {
  if (officialNotificationRunning) return { skipped: true, reason: 'previous_official_notification_running' };
  officialNotificationRunning = true;
  try {
    return await officialNotificationService.processPendingJobs({ limit: 50 });
  } finally {
    officialNotificationRunning = false;
  }
}

function scheduleNextRun() {
  const delay = millisecondsUntilNextRun();
  schedulerTimer = setTimeout(async () => {
    console.log('[Scheduler] 开始每日用工风险扫描');
    try {
      const summary = await scanAllCompanies();
      console.log('[Scheduler] 每日用工风险扫描完成', summary);
    } catch (error) {
      console.error('[Scheduler] 每日用工风险扫描异常', error);
    } finally {
      scheduleNextRun();
    }
  }, delay);
  return delay;
}

function startScheduler() {
  if (schedulerTimer) return false;
  const delay = scheduleNextRun();
  smsDeliveryTimer = setInterval(() => {
    runSmsDelivery();
    runOfficialNotification();
  }, SMS_DELIVERY_INTERVAL_MS);
  console.log(`[Scheduler] 已启用，每日${String(DAILY_SCAN_HOUR).padStart(2, '0')}:00执行，距下次扫描${Math.ceil(delay / 60000)}分钟`);
  return true;
}

function stopScheduler() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  if (smsDeliveryTimer) clearInterval(smsDeliveryTimer);
  schedulerTimer = null;
  smsDeliveryTimer = null;
}

module.exports = {
  DAILY_SCAN_HOUR,
  SMS_DELIVERY_INTERVAL_MS,
  millisecondsUntilNextRun,
  scanAllCompanies,
  runSmsDelivery,
  runOfficialNotification,
  startScheduler,
  stopScheduler
};
