const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/operations.service');

const scopedUser = {
  id: 9,
  companyId: 1,
  dataScope: 5,
  scopeDeptIds: [],
  permissions: ['payroll:view']
};

async function withDbStubs(stubs, callback) {
  const original = { first: db.first, query: db.query };
  Object.assign(db, stubs);
  try {
    return await callback();
  } finally {
    Object.assign(db, original);
  }
}

async function main() {
  assert.equal(typeof service.getPayrollBatchDetail, 'function', '缺少工资批次详情服务');
  const calls = [];
  await withDbStubs({
    first: async (sql, params) => {
      calls.push({ type: 'first', sql, params });
      if (/FROM salary_batch b/.test(sql) && !/COUNT\(d\.id\)/.test(sql)) {
        return {
          id: 61,
          batchNo: 'GZ202608001',
          salaryMonth: '2026-08',
          batchStatus: 5,
          projectName: '装配项目',
          customerName: '甲客户',
          grossTotal: 16300,
          netTotal: 13800,
          paidAt: '2026-08-10 09:00:00'
        };
      }
      return {
        total: 5,
        unboundCount: 1,
        pendingViewCount: 1,
        pendingSignCount: 1,
        signedCount: 2,
        disputeCount: 1
      };
    },
    query: async (sql, params) => {
      calls.push({ type: 'query', sql, params });
      return [
        {
          id: 901,
          employeeId: 88,
          employeeName: '张三',
          grossAmount: 8150,
          netAmount: 8350,
          itemSnapshot: JSON.stringify([
            { label: '基本工资', value: 8000, category: 'income', sortOrder: 1 },
            { label: '扣款', value: 100, category: 'deduction', sortOrder: 2 }
          ]),
          receiptStatus: 1,
          viewed: 1,
          wechatBound: 1,
          smsDeliveryStatus: 'FAILED',
          smsErrorSummary: 'the number of sms messages sent from a single mobile number within 1 hour exceeds the upper limit',
          signedAt: null,
          receiptAt: null,
          openDisputeId: null
        },
        {
          id: 902,
          employeeId: 89,
          employeeName: '李四',
          grossAmount: 8150,
          netAmount: 6900,
          receiptStatus: 2,
          viewed: 1,
          wechatBound: 0,
          smsDeliveryStatus: 'SENT',
          smsErrorSummary: null,
          signedName: '李四',
          signatureAttachmentId: 501,
          signedAt: '2026-08-12 10:00:00',
          receiptAt: '2026-08-12 10:01:00',
          openDisputeId: null
        }
      ];
    }
  }, async () => {
    const result = await service.getPayrollBatchDetail(1, 61, { page: 1, pageSize: 20 }, scopedUser);
    assert.equal(result.batch.id, 61);
    assert.equal(result.batch.statusName, '已发放');
    assert.deepEqual(result.progress, {
      total: 5,
      unboundCount: 1,
      pendingViewCount: 1,
      pendingSignCount: 1,
      signedCount: 2,
      disputeCount: 1,
      signedRate: 40
    });
    assert.equal(result.list[0].displayStatus, '待签字');
    assert.equal('hasAmountWarning' in result.list[0], false, '工资条详情不得返回金额异常标识');
    assert.equal('amountWarnings' in result.list[0], false, '工资条详情不得返回金额异常内容');
    assert.equal(result.list[0].wechatBound, true);
    assert.equal(result.list[0].smsErrorSummary, '同一手机号一小时发送次数已达上限，请稍后重试');
    assert.equal(result.list[1].displayStatus, '已签收');
    assert.equal(result.list[1].wechatBound, false);
    assert.equal(result.list[1].deliveryStatus, '发放成功');
    assert.equal(result.list[1].signedName, '李四');
    assert.equal(result.list[1].signaturePreviewUrl, '/api/payroll/payslips/902/signature');
    assert.equal(result.page, 1);
    assert.equal(result.total, 5);
  });

  const sql = calls.map(item => item.sql).join('\n');
  assert.match(sql, /sys_user_project/, '批次详情必须执行项目数据隔离');
  assert.match(sql, /employee_wechat_binding/, '批次详情必须统计员工微信绑定状态');
  assert.match(sql, /salary_receipt_log/, '批次详情必须区分待查看与待签字');
  assert.match(sql, /salary_signature/, '批次详情必须显示签名状态');
  assert.match(sql, /sms_delivery_job/, '批次详情必须显示短信通知状态');
  assert.match(sql, /salary_dispute/, '批次详情必须显示工资异议状态');
  for (const call of calls) {
    assert.equal(call.params.companyId, 1);
    assert.equal(call.params.batchId, 61);
  }

  const routes = require('../src/routes/operations.routes');
  const route = (routes.stack || []).find(layer => layer.route?.path === '/payroll/batches/:id/details');
  assert.ok(route, '缺少工资批次详情接口');
  assert.ok(route.route.methods.get);

  console.log('payroll-batch-detail-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
