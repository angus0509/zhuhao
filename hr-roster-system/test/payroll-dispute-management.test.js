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
  permissions: ['payroll:view', 'payroll:manage']
};

async function withDbStubs(stubs, callback) {
  const original = {
    first: db.first,
    query: db.query,
    transaction: db.transaction
  };
  Object.assign(db, stubs);
  try {
    return await callback();
  } finally {
    Object.assign(db, original);
  }
}

async function testList() {
  const calls = [];
  await withDbStubs({
    first: async (sql, params) => {
      calls.push({ type: 'first', sql, params });
      return { total: 1 };
    },
    query: async (sql, params) => {
      calls.push({ type: 'query', sql, params });
      return [{
        id: 71,
        salaryDetailId: 901,
        employeeId: 88,
        employeeName: '张三',
        customerName: '甲客户',
        projectName: '装配项目',
        salaryMonth: '2026-08',
        batchNo: 'GZ202608001',
        grossAmount: 8150,
        netAmount: 6900,
        disputeReason: '本月加班工时与实际记录不一致，请核对。',
        handleStatus: 0,
        handleRemark: null,
        handlerName: null,
        createdAt: '2026-08-14 10:00:00',
        handledAt: null
      }];
    }
  }, async () => {
    const result = await service.listPayrollDisputes(1, { handleStatus: '0', page: 1, pageSize: 20 }, scopedUser);
    assert.equal(result.total, 1);
    assert.equal(result.list[0].handleStatusName, '待处理');
    assert.equal(result.list[0].grossAmount, 8150);
    assert.equal(result.list[0].netAmount, 6900);
  });

  const sql = calls.map(item => item.sql).join('\n');
  assert.match(sql, /FROM salary_dispute sd/);
  assert.match(sql, /sd\.company_id\s*=\s*:companyId/);
  assert.match(sql, /sys_user_project/, '工资异议列表必须执行项目数据隔离');
  assert.match(sql, /sd\.handle_status=:handleStatus/);
  assert.equal(calls[0].params.handleStatus, 0);
}

async function runHandle(action, expectedStatus, shouldResetReceipt) {
  const executed = [];
  const disputeRow = {
    id: 71,
    company_id: 1,
    salary_detail_id: 901,
    employee_id: 88,
    project_id: 16,
    handle_status: 0,
    employee_name: '张三',
    salary_month: '2026-08'
  };

  await withDbStubs({
    first: async (sql, params) => {
      executed.push({ type: 'scope', sql, params });
      return disputeRow;
    },
    transaction: async callback => callback({
      execute: async (sql, params) => {
        executed.push({ type: 'execute', sql, params });
        if (/SELECT sd\.id/.test(sql)) return [[disputeRow]];
        return [{ affectedRows: 1, insertId: 501 }];
      }
    })
  }, async () => {
    const result = await service.handlePayrollDispute(
      1,
      71,
      { action, remark: '已核对考勤和工资计算，处理结论已反馈员工。' },
      9,
      scopedUser
    );
    assert.equal(result.disputeId, 71);
    assert.equal(result.handleStatus, expectedStatus);
  });

  const update = executed.find(item => /UPDATE salary_dispute/.test(item.sql));
  assert.ok(update, '处理异议必须更新异议状态');
  assert.equal(update.params.targetStatus, expectedStatus);
  assert.match(executed.map(item => item.sql).join('\n'), /hr_operation_log/,
    '工资异议处理必须写审计日志');
  assert.match(executed.map(item => item.sql).join('\n'), /hr_system_notice/,
    '工资异议处理结果必须通知员工');
  const receiptUpdate = executed.find(item => /UPDATE salary_detail/.test(item.sql));
  assert.equal(Boolean(receiptUpdate), shouldResetReceipt,
    '仅完成或驳回异议后才应恢复员工待签收状态');
  if (receiptUpdate) {
    assert.match(receiptUpdate.sql, /receipt_status=1/);
    assert.equal(receiptUpdate.params.employeeId, 88);
  }
}

async function main() {
  assert.equal(typeof service.listPayrollDisputes, 'function', '缺少工资异议列表服务');
  assert.equal(typeof service.handlePayrollDispute, 'function', '缺少工资异议处理服务');
  await testList();
  await runHandle('processing', 1, false);
  await runHandle('resolve', 2, true);
  await runHandle('reject', 3, true);

  await assert.rejects(
    () => service.handlePayrollDispute(1, 71, { action: 'resolve', remark: '太短' }, 9, scopedUser),
    /处理说明需填写5至500字/
  );
  await assert.rejects(
    () => service.handlePayrollDispute(1, 71, { action: 'delete', remark: '无效操作测试说明' }, 9, scopedUser),
    /处理操作无效/
  );

  const routes = require('../src/routes/operations.routes');
  const routePaths = (routes.stack || []).filter(layer => layer.route).map(layer => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods)
  }));
  assert.ok(routePaths.some(item => item.path === '/payroll/disputes' && item.methods.includes('get')),
    '缺少工资异议管理列表接口');
  assert.ok(routePaths.some(item => item.path === '/payroll/disputes/:id/handle' && item.methods.includes('put')),
    '缺少工资异议处理接口');

  console.log('payroll-dispute-management-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
