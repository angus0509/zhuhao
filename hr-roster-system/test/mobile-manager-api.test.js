const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = {
  first: async () => null,
  query: async () => []
};
const unrelatedServiceStubs = new Map([
  ['./employee.service', { assertEmployeeScope: async () => null }],
  ['./system.service', { MANAGED_ROLE_CODES: [], createUser: async () => null }],
  ['./notice.service', {}],
  ['./sms-delivery.service', {}],
  ['./official-notification.service', { createOfficialNotificationService: () => ({}) }],
  ['./payroll-import-profile.service', {}],
  ['./payroll-item-snapshot.service', { normalizeItemSnapshot: value => value }]
]);
// 隔离工作区依赖指向云端占位文件；本测试只替换数据库和未调用的 PDF 边界。
const originalModuleLoad = Module._load;
Module._load = function loadWithoutPdfDependencies(request, parent, isMain) {
  if (request === '../db') return db;
  if (request === 'pdf-lib') return { PDFDocument: {}, rgb: () => ({}) };
  if (request === '@pdf-lib/fontkit') return {};
  if (unrelatedServiceStubs.has(request)) return unrelatedServiceStubs.get(request);
  return originalModuleLoad.call(this, request, parent, isMain);
};
const service = require('../src/services/operations.service');
Module._load = originalModuleLoad;

const root = path.resolve(__dirname, '..');
const routePath = path.join(root, 'src/routes/mobile-manager.routes.js');
const controllerPath = path.join(root, 'src/controllers/mobile-manager.controller.js');

const allPermissionsUser = {
  id: 9,
  companyId: 1,
  accountType: 'MANAGER',
  dataScope: 5,
  scopeDeptIds: [],
  permissions: ['project:view', 'employee:view', 'attendance:review', 'payroll:view']
};

const forbiddenKeyPattern = /(gross|net|amount|idcard|bankcard|signature|salaryitems?)/i;

function assertNoForbiddenKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbiddenKeyPattern.test(key), false, `mobile payload leaked ${key}`);
    assertNoForbiddenKeys(child);
  }
}

async function withDbStubs(stubs, run) {
  const original = { first: db.first, query: db.query };
  db.first = stubs.first;
  db.query = stubs.query;
  try {
    return await run();
  } finally {
    db.first = original.first;
    db.query = original.query;
  }
}

test('manager mobile routes require manager authentication and payroll permission', () => {
  assert.equal(fs.existsSync(routePath), true, 'mobile manager route must exist');
  const routeSource = fs.readFileSync(routePath, 'utf8');
  assert.match(routeSource, /router\.use\(requireAuth, requireManagerAccount\)/);
  assert.match(routeSource, /router\.get\('\/mobile\/manager\/overview', controller\.overview\)/);
  assert.match(
    routeSource,
    /router\.get\('\/mobile\/manager\/payslip-status',\s*requirePermission\('payroll:view'\), controller\.payslipStatus\)/
  );
});

test('manager mobile controllers pass only authenticated request context to services', async () => {
  assert.equal(fs.existsSync(controllerPath), true, 'mobile manager controller must exist');
  assert.equal(typeof service.managerMobileOverview, 'function');
  assert.equal(typeof service.managerMobilePayslipStatus, 'function');

  const controller = require(controllerPath);
  const original = {
    overview: service.managerMobileOverview,
    payslipStatus: service.managerMobilePayslipStatus
  };
  const calls = [];
  service.managerMobileOverview = async (...args) => {
    calls.push(['overview', ...args]);
    return { activeProjectCount: 1 };
  };
  service.managerMobilePayslipStatus = async (...args) => {
    calls.push(['payslipStatus', ...args]);
    return { page: 1, pageSize: 20, total: 0, list: [] };
  };
  const req = {
    companyId: 7,
    user: { ...allPermissionsUser, companyId: 7 },
    query: { month: '2026-09' },
    body: { mustNotPass: true },
    headers: { authorization: 'Bearer must-not-pass' }
  };
  const payloads = [];
  const res = { json: payload => payloads.push(payload) };
  const next = error => {
    throw error;
  };

  try {
    await controller.overview(req, res, next);
    await controller.payslipStatus(req, res, next);
  } finally {
    service.managerMobileOverview = original.overview;
    service.managerMobilePayslipStatus = original.payslipStatus;
  }

  assert.deepEqual(calls[0], ['overview', 7, req.user]);
  assert.deepEqual(calls[1], ['payslipStatus', 7, req.user, req.query]);
  assert.equal(payloads[0].code, 0);
  assert.equal(payloads[1].code, 0);
});

test('overview scopes every permitted statistic and returns null for missing permissions', async () => {
  assert.equal(typeof service.managerMobileOverview, 'function');
  const calls = [];

  await withDbStubs({
    first: async (sql, params) => {
      calls.push({ sql, params: { ...params } });
      if (/FROM labor_project p/.test(sql)) return { total: 6 };
      if (/FROM hr_employee e/.test(sql)) return { total: 238 };
      if (/FROM attendance_correction_requests c/.test(sql)) return { total: 4 };
      if (/FROM salary_detail d/.test(sql)) {
        return { employeeTotal: 220, unsignedTotal: 18, signedTotal: 196, otherStatusTotal: 6 };
      }
      throw new Error(`Unexpected overview SQL: ${sql}`);
    },
    query: async () => {
      throw new Error('overview must not load list rows');
    }
  }, async () => {
    const result = await service.managerMobileOverview(1, allPermissionsUser);
    assert.deepEqual(result, {
      activeProjectCount: 6,
      activeEmployeeCount: 238,
      pendingAttendanceReviewCount: 4,
      payslipStatus: {
        employeeTotal: 220,
        unsignedTotal: 18,
        signedTotal: 196,
        otherStatusTotal: 6
      }
    });
    assertNoForbiddenKeys(result);

    assert.equal(calls.length, 4);
    for (const call of calls) {
      assert.equal(call.params.companyId, 1);
      assert.equal(call.params.scopeUserId, 9);
      assert.match(call.sql, /sys_user_project/, 'project-scoped user must be filtered by project');
    }
  });

  let partialCallCount = 0;
  await withDbStubs({
    first: async (sql, params) => {
      partialCallCount += 1;
      assert.equal(params.companyId, 2, 'company isolation must use authenticated company');
      assert.match(sql, /FROM hr_employee e/);
      return { total: 12 };
    },
    query: async () => {
      throw new Error('unexpected query');
    }
  }, async () => {
    const partial = await service.managerMobileOverview(2, {
      ...allPermissionsUser,
      companyId: 2,
      permissions: ['employee:view']
    });
    assert.deepEqual(partial, {
      activeProjectCount: null,
      activeEmployeeCount: 12,
      pendingAttendanceReviewCount: null,
      payslipStatus: null
    });
  });
  assert.equal(partialCallCount, 1, 'missing permissions must not run hidden enterprise queries');

  let noPermissionQueries = 0;
  await withDbStubs({
    first: async () => {
      noPermissionQueries += 1;
      return { total: 999 };
    },
    query: async () => {
      noPermissionQueries += 1;
      return [];
    }
  }, async () => {
    const none = await service.managerMobileOverview(3, {
      ...allPermissionsUser,
      companyId: 3,
      permissions: []
    });
    assert.deepEqual(none, {
      activeProjectCount: null,
      activeEmployeeCount: null,
      pendingAttendanceReviewCount: null,
      payslipStatus: null
    });
  });
  assert.equal(noPermissionQueries, 0);
});

test('payslip status validates filters, keeps batch totals, and returns an allowlisted payload', async () => {
  assert.equal(typeof service.managerMobilePayslipStatus, 'function');
  const firstCalls = [];
  const queryCalls = [];
  await withDbStubs({
    first: async (sql, params) => {
      firstCalls.push({ sql, params: { ...params } });
      if (/projectCustomerMatch/.test(sql)) return { projectCustomerMatch: 1 };
      if (/filteredBatchCount/.test(sql)) return { filteredBatchCount: 1 };
      throw new Error(`Unexpected payslip status first SQL: ${sql}`);
    },
    query: async (sql, params) => {
      queryCalls.push({ sql, params: { ...params } });
      return [{
        batchId: 801,
        batchNo: 'PAY-202609-001',
        salaryMonth: '2026-09',
        customerName: '测试客户',
        projectId: 101,
        projectName: '一厂项目',
        publishedAt: '2026-10-10 09:00:00',
        employeeTotal: 100,
        unsignedTotal: 8,
        signedTotal: 90,
        otherStatusTotal: 2
      }];
    }
  }, async () => {
    const result = await service.managerMobilePayslipStatus(2, {
      ...allPermissionsUser,
      companyId: 2
    }, {
      page: 2,
      pageSize: 999,
      month: '2026-09',
      customerId: '18',
      projectId: '101',
      receiptStatus: 'UNSIGNED'
    });

    assert.deepEqual(result, {
      page: 1,
      pageSize: 50,
      total: 1,
      list: [{
        batchId: 801,
        batchNo: 'PAY-202609-001',
        salaryMonth: '2026-09',
        customerName: '测试客户',
        projectId: 101,
        projectName: '一厂项目',
        publishedAt: '2026-10-10 09:00:00',
        employeeTotal: 100,
        unsignedTotal: 8,
        signedTotal: 90,
        otherStatusTotal: 2
      }]
    });
    assertNoForbiddenKeys(result);

    const listCall = queryCalls[0];
    assert.equal(listCall.params.companyId, 2);
    assert.equal(listCall.params.month, '2026-09');
    assert.equal(listCall.params.customerId, 18);
    assert.equal(listCall.params.projectId, 101);
    assert.equal(listCall.params.pageSize, 50);
    assert.equal(listCall.params.offset, 0);
    assert.match(listCall.sql, /sys_user_project/);
    assert.match(listCall.sql, /HAVING unsignedTotal > 0/);
    assert.match(listCall.sql, /COUNT\(d\.id\) employeeTotal/);
    assert.match(listCall.sql, /b\.paid_at publishedAt/);
    assert.doesNotMatch(listCall.sql, /total_gross|total_net|gross_amount|net_amount|id_card|bank_card|signature/i);
    assert.equal(firstCalls[0].params.companyId, 2);
  });

  await assert.rejects(
    () => service.managerMobilePayslipStatus(1, allPermissionsUser, { month: '2026/09' }),
    error => error.statusCode === 400 && error.businessCode === 'INVALID_SALARY_MONTH'
  );
  await assert.rejects(
    () => service.managerMobilePayslipStatus(1, allPermissionsUser, { projectId: '0' }),
    error => error.statusCode === 400 && error.businessCode === 'INVALID_PROJECT_ID'
  );
  await assert.rejects(
    () => service.managerMobilePayslipStatus(1, allPermissionsUser, { customerId: '-1' }),
    error => error.statusCode === 400 && error.businessCode === 'INVALID_CUSTOMER_ID'
  );
  await assert.rejects(
    () => service.managerMobilePayslipStatus(1, allPermissionsUser, { receiptStatus: 'UNKNOWN' }),
    error => error.statusCode === 400 && error.businessCode === 'INVALID_RECEIPT_STATUS'
  );
});

test('payslip status rejects a requested project outside the requested customer and scope', async () => {
  assert.equal(typeof service.managerMobilePayslipStatus, 'function');
  let listQueries = 0;
  await withDbStubs({
    first: async (sql, params) => {
      assert.match(sql, /projectCustomerMatch/);
      assert.equal(params.companyId, 1);
      assert.equal(params.customerId, 18);
      assert.equal(params.projectId, 101);
      assert.match(sql, /sys_user_project/);
      return null;
    },
    query: async () => {
      listQueries += 1;
      return [];
    }
  }, async () => {
    await assert.rejects(
      () => service.managerMobilePayslipStatus(1, allPermissionsUser, {
        customerId: 18,
        projectId: 101
      }),
      error => error.statusCode === 403 && error.businessCode === 'PROJECT_SCOPE_DENIED'
    );
  });
  assert.equal(listQueries, 0);
});
