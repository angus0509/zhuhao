const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

async function main() {
  const { createSmsDeliveryService } = require('../src/services/sms-delivery.service');
  const calls = [];
  const jobs = [{
    id: 10, company_id: 1, employee_id: 88, batch_id: 7, payslip_id: 70,
    business_type: 'PAYSLIP_PUBLISHED', template_key: 'payslipPublished',
    salary_month: '2026-08', attempt_count: 0
  }];
  const connection = {
    async execute(sql, params = {}) {
      calls.push({ sql, params });
      if (/INSERT INTO sms_delivery_job/i.test(sql)) return [{ affectedRows: 2 }];
      if (/SUM\(CASE WHEN delivery_status='PENDING'/i.test(sql)) {
        return [[{ queued: 1, skippedNoPhone: 1 }]];
      }
      if (/FROM sms_delivery_job[\s\S]*FOR UPDATE SKIP LOCKED/i.test(sql)) return [jobs];
      if (/UPDATE sms_delivery_job SET delivery_status='SENDING'/i.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    }
  };
  const state = { providerCalls: [], updates: [] };
  const db = {
    async transaction(handler) { return handler(connection); },
    async first(sql) {
      if (/FROM sms_delivery_job j/i.test(sql)) {
        return { id: 10, employeeId: 88, phone: '13800000000', employeeStatus: 2, receiptStatus: 1 };
      }
      throw new Error(`Unexpected first SQL: ${sql}`);
    },
    async query(sql, params) {
      state.updates.push({ sql, params });
      return { affectedRows: 1 };
    }
  };
  const service = createSmsDeliveryService({
    db,
    smsProvider: {
      async sendTemplate(payload) {
        state.providerCalls.push(payload);
        return { accepted: true, providerCode: 'Ok', providerMessage: '', requestId: 'req-1', serialNo: 'serial-1' };
      }
    },
    hmacSecret: 'test-sms-code-hmac-secret-32-bytes-minimum',
    payslipUrlLink: 'https://lczpt.com/wx/payslip'
  });
  assert.equal(
    service._testing.normalizeMiniProgramLoginUrlLink('https://lczpt.com/wx/payslip'),
    'https://lczpt.com/wx/payslip'
  );
  assert.equal(service._testing.normalizeMiniProgramLoginUrlLink('http://lczpt.com/wx/payslip'), '');
  assert.equal(service._testing.normalizeMiniProgramLoginUrlLink('https://wxaurl.cn/example'), '',
    '腾讯云引流报备必须使用已备案的优企云自有域名中转页');
  assert.equal(service._testing.normalizeMiniProgramLoginUrlLink('https://lczpt.com/wx/payslip?employeeId=88'), '',
    '微信跳转链接不得携带业务查询参数');
  assert.equal(service._testing.retryableCode('LimitExceeded.PhoneNumberDailyLimit'), false,
    '手机号每日上限属于确定性失败，不得自动重试');
  assert.equal(service._testing.retryableCode('LimitExceeded.PhoneNumberOneHourLimit'), false,
    '手机号每小时上限属于确定性失败，不得自动重试');
  assert.equal(service._testing.retryableCode('RequestLimitExceeded'), true,
    '通用请求限流仍应允许有限重试');

  const enqueued = await service.enqueuePublishedJobs(connection, {
    companyId: 1, batchId: 7, salaryMonth: '2026-08', operatorId: 9
  });
  assert.deepEqual(enqueued, { queued: 1, skippedNoPhone: 1 });
  const insertCall = calls.find(call => /INSERT INTO sms_delivery_job/i.test(call.sql));
  assert.match(insertCall.sql, /ON DUPLICATE KEY UPDATE dedupe_key=dedupe_key/);
  assert.doesNotMatch(insertCall.sql, /ON DUPLICATE KEY UPDATE id=id/,
    'INSERT ... SELECT 连接多张含 id 字段的表时，去重更新不得使用歧义的 id=id');
  assert.match(insertCall.sql, /company_id=:companyId/);

  const serviceSource = require('node:fs').readFileSync(
    require.resolve('../src/services/sms-delivery.service'),
    'utf8'
  );
  assert.doesNotMatch(serviceSource, /ON DUPLICATE KEY UPDATE id=id/g,
    '工资发布和催签短信队列都不得保留歧义的 id=id');

  const summary = await service.processPendingJobs({ limit: 100 });
  assert.deepEqual(summary, { claimed: 1, sent: 1, failed: 0, skipped: 0 });
  assert.deepEqual(state.providerCalls[0], {
    phone: '13800000000',
    templateKey: 'payslipPublished',
    params: []
  });
  assert.equal(state.providerCalls[0].params.length, 0,
    '已生效的工资条模板2727678无变量，发送时不得附带链接参数');
  assert.equal(JSON.stringify(state.updates).includes('13800000000'), false,
    '任务更新不得写入完整手机号');

  const departedProviderCalls = [];
  const departedService = createSmsDeliveryService({
    db: {
      async transaction(handler) { return handler(connection); },
      async first(sql) {
        if (/FROM sms_delivery_job j/i.test(sql)) {
          return { id: 10, employeeId: 88, phone: '13800000000', employeeStatus: 3, receiptStatus: 1 };
        }
        throw new Error(`Unexpected first SQL: ${sql}`);
      },
      async query() { return { affectedRows: 1 }; }
    },
    smsProvider: {
      async sendTemplate(payload) {
        departedProviderCalls.push(payload);
        return { accepted: true, providerCode: 'Ok', requestId: 'req-departed', serialNo: 'serial-departed' };
      }
    },
    hmacSecret: 'test-sms-code-hmac-secret-32-bytes-minimum'
  });
  const departedSummary = await departedService.processPendingJobs({ limit: 100 });
  assert.deepEqual(departedSummary, { claimed: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(departedProviderCalls.length, 1,
    '已离职员工的已发布工资条仍应发送查看通知');

  const failedState = { updates: [] };
  const failedService = createSmsDeliveryService({
    db: {
      async transaction(handler) { return handler(connection); },
      async first(sql) {
        if (/FROM sms_delivery_job j/i.test(sql)) {
          return { id: 10, employeeId: 88, phone: '13800000000', employeeStatus: 2, receiptStatus: 1 };
        }
        throw new Error(`Unexpected first SQL: ${sql}`);
      },
      async query(sql, params) {
        failedState.updates.push({ sql, params });
        return { affectedRows: 1 };
      }
    },
    smsProvider: {
      async sendTemplate() {
        return {
          accepted: false,
          providerCode: 'LimitExceeded.PhoneNumberOneHourLimit',
          providerMessage: 'the number of sms messages sent from a single mobile number within 1 hour exceeds the upper limit',
          requestId: 'req-limit',
          serialNo: ''
        };
      }
    },
    hmacSecret: 'test-sms-code-hmac-secret-32-bytes-minimum'
  });
  const failedSummary = await failedService.processPendingJobs({ limit: 100 });
  assert.equal(failedSummary.failed, 1);
  const failedUpdate = failedState.updates.find(item => /error_summary=:errorSummary/i.test(item.sql));
  assert.ok(failedUpdate, '短信失败后必须记录可展示的失败摘要');
  assert.equal(failedUpdate.params.deliveryStatus, 'FAILED',
    '手机号频次上限失败不得再次进入自动重试队列');
  assert.equal(failedUpdate.params.errorSummary, '同一手机号一小时发送次数已达上限，请稍后重试');
  assert.equal(failedUpdate.params.providerCode, 'LimitExceeded.PhoneNumberOneHourLimit',
    '供应商原始错误码必须保留供排查');

  const historicalSummaryService = createSmsDeliveryService({
    db: {
      async first(sql) {
        if (/FROM salary_batch b/.test(sql)) return { id: 7, salaryMonth: '2026-08', batchStatus: 5, projectId: 3 };
        if (/COUNT\(\*\) total/.test(sql)) {
          assert.match(sql, /d\.receipt_status=1/, '可补发数量必须排除已签收工资条');
          assert.match(sql, /e\.employee_status\s+IN\s*\(2,3\)/,
            '可补发数量必须允许已离职员工，并继续排除其他停用状态');
          return {
            total: 1, pending: 0, sending: 0, sent: 0, failed: 1, skippedNoPhone: 0,
            retryableCount: 1
          };
        }
        throw new Error(`Unexpected historical summary first SQL: ${sql}`);
      },
      async query(sql) {
        if (/FROM sms_delivery_job j/.test(sql)) {
          return [{
            employeeId: 88,
            employeeName: '张三',
            phoneTail: '0000',
            receiptStatus: 1,
            deliveryStatus: 'FAILED',
            lastAttemptAt: '2026-08-15 10:00:00',
            errorSummary: 'the number of sms messages sent from a single mobile number within 1 hour exceeds the upper limit'
          }];
        }
        throw new Error(`Unexpected historical summary query SQL: ${sql}`);
      }
    }
  });
  const historicalSummary = await historicalSummaryService.getBatchSummary({ companyId: 1, batchId: 7, user: {} });
  assert.equal(historicalSummary.retryableCount, 1);
  assert.equal(historicalSummary.items[0].deliveryStatusName, '发送失败');
  assert.equal(historicalSummary.items[0].errorSummary, '同一手机号一小时发送次数已达上限，请稍后重试',
    '历史英文失败原因也必须在管理端转为中文');

  console.log('payroll-sms-delivery-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
