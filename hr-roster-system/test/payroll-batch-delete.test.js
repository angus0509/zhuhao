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
  assert.equal(typeof service.deletePayrollBatch, 'function', '缺少工资批次删除服务');

  await assert.rejects(
    () => service.deletePayrollBatch(1, 61, { confirmed: false, reason: '工资表上传错误' }, 9, scopedUser),
    /确认删除/
  );
  await assert.rejects(
    () => service.deletePayrollBatch(1, 61, { confirmed: true, reason: '错误' }, 9, scopedUser),
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
          batchStatus: 1,
          batchNo: 'GZ202609001',
          salaryMonth: '2026-09',
          projectId: 7,
          sourceType: 'MANUAL',
          calculationRunId: null,
          wageRunLinked: 0,
          employeeCount: 2
        }]];
      }
      if (/viewCount/.test(sql) && /signatureCount/.test(sql)) {
        return [[{ viewCount: 0, signatureCount: 0, receiptCount: 0, disputeCount: 0 }]];
      }
      return [{ affectedRows: 1 }];
    }
  });

  try {
    const result = await service.deletePayrollBatch(
      1,
      61,
      { confirmed: true, reason: '工资表上传错误，需要删除重传' },
      9,
      scopedUser
    );
    assert.deepEqual(result, { batchId: 61, deleted: true });
  } finally {
    db.transaction = originalTransaction;
  }

  db.transaction = async handler => handler({
    async execute(sql) {
      if (/SELECT b\.id[\s\S]*FOR UPDATE/.test(sql)) {
        return [[{
          id: 64,
          batchStatus: 1,
          batchNo: 'GZ202609004',
          salaryMonth: '2026-09',
          projectId: 7,
          sourceType: 'ATTENDANCE_AUTO',
          calculationRunId: 18,
          wageRunLinked: 1
        }]];
      }
      throw new Error(`考勤自动算薪批次不应执行删除语句: ${sql}`);
    }
  });
  try {
    await assert.rejects(
      () => service.deletePayrollBatch(1, 64, { confirmed: true, reason: '工资表上传错误，需要删除重传' }, 9, scopedUser),
      /考勤自动算薪生成的工资批次不能删除/
    );
  } finally {
    db.transaction = originalTransaction;
  }

  const sql = statements.map(item => item.sql).join('\n');
  assert.match(sql, /sys_user_project/, '删除必须校验项目数据范围');
  assert.match(sql, /salary_receipt_log/, '删除前必须检查员工查看证据');
  assert.match(sql, /salary_signature/, '删除前必须检查员工签名');
  assert.match(sql, /salary_dispute/, '删除前必须检查工资异议');
  assert.match(sql, /UPDATE sms_delivery_job[\s\S]*batch_id=NULL[\s\S]*payslip_id=NULL/, '短信历史必须保留并解除工资记录引用');
  assert.match(sql, /UPDATE wechat_official_notification_job[\s\S]*batch_id=NULL[\s\S]*payslip_id=NULL/, '服务号通知历史必须保留并解除工资记录引用');
  assert.match(sql, /DELETE FROM salary_detail/, '必须删除工资明细');
  assert.match(sql, /DELETE FROM salary_batch[\s\S]*batch_status IN \(1,4\)/, '仅允许删除已退回或已撤回批次');
  assert.match(sql, /action_type[\s\S]*delete/, '删除必须写入审计日志');
  assert.ok(statements.some(item => item.params?.reason === '工资表上传错误，需要删除重传'));

  db.transaction = async handler => handler({
    async execute(sql) {
      if (/SELECT b\.id[\s\S]*FOR UPDATE/.test(sql)) {
        return [[{ id: 62, batchStatus: 5, batchNo: 'GZ202609002', salaryMonth: '2026-09', projectId: 7 }]];
      }
      throw new Error(`已发放批次不应继续执行删除语句: ${sql}`);
    }
  });
  try {
    await assert.rejects(
      () => service.deletePayrollBatch(1, 62, { confirmed: true, reason: '工资表上传错误，需要删除重传' }, 9, scopedUser),
      /仅已退回或已撤回/
    );
  } finally {
    db.transaction = originalTransaction;
  }

  db.transaction = async handler => handler({
    async execute(sql) {
      if (/SELECT b\.id[\s\S]*FOR UPDATE/.test(sql)) {
        return [[{ id: 63, batchStatus: 4, batchNo: 'GZ202609003', salaryMonth: '2026-09', projectId: 7 }]];
      }
      if (/viewCount/.test(sql)) {
        return [[{ viewCount: 1, signatureCount: 0, receiptCount: 0, disputeCount: 0 }]];
      }
      throw new Error(`有员工证据时不应执行删除语句: ${sql}`);
    }
  });
  try {
    await assert.rejects(
      () => service.deletePayrollBatch(1, 63, { confirmed: true, reason: '工资表上传错误，需要删除重传' }, 9, scopedUser),
      /已有员工查看、签名、签收或提交异议/
    );
  } finally {
    db.transaction = originalTransaction;
  }

  const routes = fs.readFileSync('src/routes/operations.routes.js', 'utf8');
  assert.match(
    routes,
    /delete\('\/payroll\/batches\/:id'[\s\S]*sensitiveLimiter[\s\S]*requirePermission\('payroll:manage'\)/,
    '工资批次删除接口必须启用限流和管理权限'
  );

  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /data-delete-payroll=/, '网页端缺少工资批次删除入口');
  assert.match(app, /确认删除工资批次[\s\S]*删除后不可恢复/, '网页端删除前必须明确提示不可恢复');
  assert.match(app, /method:\s*'DELETE'/, '网页端必须调用删除接口');

  console.log('payroll-batch-delete-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
