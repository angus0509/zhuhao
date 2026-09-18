const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/operations.service');

const scopedUser = {
  id: 9,
  companyId: 1,
  dataScope: 5,
  scopeDeptIds: [],
  permissions: ['payroll:manage']
};

async function main() {
  assert.equal(typeof service.withdrawPayrollBatch, 'function', '缺少工资条撤回服务');
  await assert.rejects(
    () => service.withdrawPayrollBatch(1, 61, { confirmed: false, reason: '工资数据录入错误' }, 9, scopedUser),
    /确认撤回/
  );
  await assert.rejects(
    () => service.withdrawPayrollBatch(1, 61, { confirmed: true, reason: '错' }, 9, scopedUser),
    /5至200字/
  );

  const originalTransaction = db.transaction;
  const statements = [];
  db.transaction = async handler => handler({
    async execute(sql, params) {
      statements.push({ sql, params });
      if (/SELECT b\.id[\s\S]*FOR UPDATE/.test(sql)) {
        return [[{
          id: 61,
          batchStatus: 5,
          salaryMonth: '2026-08',
          projectId: 7
        }]];
      }
      if (/viewCount/.test(sql) && /signatureCount/.test(sql)) {
        return [[{ viewCount: 0, signatureCount: 0, receiptCount: 0, disputeCount: 0 }]];
      }
      return [{ affectedRows: 1 }];
    }
  });

  try {
    const result = await service.withdrawPayrollBatch(
      1,
      61,
      { confirmed: true, reason: '工资数据录入错误，需要撤回修正' },
      9,
      scopedUser
    );
    assert.deepEqual(result, { batchId: 61, batchStatus: 4, statusName: '待发放' });
  } finally {
    db.transaction = originalTransaction;
  }

  const sql = statements.map(item => item.sql).join('\n');
  assert.match(sql, /sys_user_project/, '撤回必须校验项目数据范围');
  assert.match(sql, /salary_receipt_log/, '撤回前必须检查员工查看证据');
  assert.match(sql, /salary_signature/, '撤回前必须检查员工签名');
  assert.match(sql, /salary_dispute/, '撤回前必须检查工资异议');
  assert.match(sql, /UPDATE salary_batch SET batch_status=4,paid_at=NULL/, '撤回后批次必须回到待发放');
  assert.match(sql, /UPDATE salary_detail SET receipt_status=0,receipt_at=NULL/, '撤回后员工端工资条必须隐藏');
  assert.match(sql, /UPDATE sms_delivery_job[\s\S]*delivery_status='CANCELLED'/, '撤回后短信任务必须取消');
  assert.match(sql, /UPDATE wechat_official_notification_job[\s\S]*delivery_status='CANCELLED'/,
    '撤回后服务号通知任务必须取消');
  assert.match(sql, /UPDATE wechat_official_notification_job[\s\S]*dedupe_key[\s\S]*WITHDRAWN/,
    '撤回后服务号通知任务必须释放原去重键');
  assert.match(sql, /UPDATE wechat_official_notification_job[\s\S]*delivery_status IN \('PENDING','SENDING'\)/,
    '撤回只能取消尚未处理的服务号通知任务');
  assert.match(sql, /action_type[\s\S]*withdraw/, '撤回必须写入审计日志');
  assert.ok(statements.some(item => item.params?.reason === '工资数据录入错误，需要撤回修正'));

  db.transaction = async handler => handler({
    async execute(sql) {
      if (/SELECT b\.id[\s\S]*FOR UPDATE/.test(sql)) {
        return [[{ id: 61, batchStatus: 5, salaryMonth: '2026-08', projectId: 7 }]];
      }
      if (/viewCount/.test(sql)) {
        return [[{ viewCount: 1, signatureCount: 0, receiptCount: 0, disputeCount: 0 }]];
      }
      return [{ affectedRows: 1 }];
    }
  });
  try {
    await assert.rejects(
      () => service.withdrawPayrollBatch(
        1,
        61,
        { confirmed: true, reason: '工资数据录入错误，需要撤回修正' },
        9,
        scopedUser
      ),
      /已有员工查看、签名、签收或提交异议/
    );
  } finally {
    db.transaction = originalTransaction;
  }

  const originalFirst = db.first;
  const originalQuery = db.query;
  db.first = async sql => {
    if (/COUNT\(\*\) batchCount/.test(sql)) return { batchCount: 2, totalGross: 20000, totalNet: 18000 };
    if (/COUNT\(\*\) filteredBatchCount/.test(sql)) return { filteredBatchCount: 2 };
    if (/employeeTotal/.test(sql)) return { employeeTotal: 2, viewedTotal: 1, signedTotal: 1, unsignedTotal: 1 };
    throw new Error(`Unexpected overview first SQL: ${sql}`);
  };
  db.query = async sql => {
    assert.match(sql, /salary_receipt_log/, '工资批次列表必须聚合员工查看记录');
    assert.match(sql, /salary_signature/, '工资批次列表必须聚合员工签名记录');
    assert.match(sql, /salary_dispute/, '工资批次列表必须聚合工资异议');
    return [
      {
        id: 61, batchNo: 'GZ202608001', salaryMonth: '2026-08', batchStatus: 5,
        employeeCount: 1, signedCount: 1, unsignedCount: 0,
        withdrawViewedCount: 1, withdrawSignatureCount: 1, withdrawReceiptCount: 1, withdrawDisputeCount: 0
      },
      {
        id: 62, batchNo: 'GZ202608002', salaryMonth: '2026-08', batchStatus: 5,
        employeeCount: 1, signedCount: 0, unsignedCount: 1,
        withdrawViewedCount: 0, withdrawSignatureCount: 0, withdrawReceiptCount: 0, withdrawDisputeCount: 0
      }
    ];
  };
  try {
    const overview = await service.payrollOverview(1, scopedUser);
    assert.equal(overview.batches[0].canWithdraw, false);
    assert.equal(overview.batches[0].withdrawBlockedReason, '已有员工签收，不可撤回');
    assert.equal(overview.batches[1].canWithdraw, true);
    assert.equal(overview.batches[1].withdrawBlockedReason, '');
  } finally {
    db.first = originalFirst;
    db.query = originalQuery;
  }

  const routes = fs.readFileSync('src/routes/operations.routes.js', 'utf8');
  assert.match(
    routes,
    /put\('\/payroll\/batches\/:id\/withdraw'[\s\S]*sensitiveLimiter[\s\S]*requirePermission\('payroll:manage'\)/,
    '工资条撤回接口必须启用限流和管理权限'
  );

  console.log('payroll-withdrawal-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
