const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const noticeService = require('../src/services/notice.service');
const smsDeliveryService = require('../src/services/sms-delivery.service');
const operationsService = require('../src/services/operations.service');

async function main() {
  const original = {
    first: db.first,
    query: db.query,
    transaction: db.transaction,
    createNotice: noticeService.createNotice,
    enqueuePublishedJobs: smsDeliveryService.enqueuePublishedJobs
  };
  const statements = [];
  let noticeCreated = false;
  let smsQueued = false;
  let batchStatus = 3;
  db.first = async () => ({ id: 61, project_id: 16, batch_status: 3, total_net: 4460, salary_month: '2026-08' });
  db.query = async (sql, params) => {
    statements.push({ sql, params });
    return { affectedRows: 1 };
  };
  db.transaction = async callback => callback({
    execute: async (sql, params) => {
      statements.push({ sql, params });
      if (/SELECT b\.id/.test(sql)) {
        return [[{ id: 61, project_id: 16, batch_status: batchStatus, total_net: 4460, salary_month: '2026-08' }]];
      }
      return [{ affectedRows: 1 }];
    }
  });
  noticeService.createNotice = async () => { noticeCreated = true; };
  smsDeliveryService.enqueuePublishedJobs = async () => {
    smsQueued = true;
    return { queued: 1, skippedNoPhone: 0 };
  };
  try {
    const result = await operationsService.reviewPayrollBatch(
      1,
      61,
      { approved: true },
      9,
      { id: 9, companyId: 1, dataScope: 1, permissions: ['payroll:review'] }
    );
    assert.equal(result.batchStatus, 5, '复核通过后应直接返回已发放状态');
    assert.ok(statements.some(item => /UPDATE salary_detail SET receipt_status=1/.test(item.sql)),
      '复核发放后员工工资条应进入待签收');
    assert.equal(noticeCreated, true, '复核发放后应创建站内通知');
    assert.equal(smsQueued, true, '复核发放后应创建短信任务');

    statements.length = 0;
    noticeCreated = false;
    smsQueued = false;
    batchStatus = 4;
    const historical = await operationsService.publishPayrollBatch(
      1,
      61,
      9,
      { id: 9, companyId: 1, dataScope: 1, permissions: ['payroll:manage'] }
    );
    assert.equal(historical.batchId, 61, '历史待发放批次仍应支持单独发布');
    assert.ok(statements.some(item => item.params?.fromStatus === 4),
      '历史批次发布必须只允许从待发放状态更新');
    assert.equal(noticeCreated, true, '历史批次发布后应创建站内通知');
    assert.equal(smsQueued, true, '历史批次发布后应创建短信任务');
  } finally {
    db.first = original.first;
    db.query = original.query;
    db.transaction = original.transaction;
    noticeService.createNotice = original.createNotice;
    smsDeliveryService.enqueuePublishedJobs = original.enqueuePublishedJobs;
  }

  console.log('payroll-publish-sms-isolation-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
