const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const originalModuleLoad = Module._load;
Module._load = function loadWithoutEmployeeDependencies(request, parent, isMain) {
  if (request === './employee.service') return { assertEmployeeScope: async () => null };
  return originalModuleLoad.call(this, request, parent, isMain);
};
const db = require('../src/db');
const service = require('../src/services/attendance.service');
Module._load = originalModuleLoad;

const reviewer = {
  id: 9,
  companyId: 1,
  dataScope: 5,
  scopeDeptIds: [],
  permissions: ['attendance:review']
};
const routeSource = fs.readFileSync(
  path.resolve(__dirname, '../src/routes/attendance.routes.js'),
  'utf8'
);

test('attendance project list accepts view or review permission without broadening settings', () => {
  assert.match(routeSource, /requireAnyPermission/);
  assert.match(
    routeSource,
    /get\('\/attendance\/projects', requireAuth,\s*requireAnyPermission\(\['attendance:view', 'attendance:review'\]\),\s*controller\.projects\)/
  );
  assert.match(
    routeSource,
    /get\('\/attendance\/projects\/:projectId\/settings', requireAuth, requirePermission\('attendance:view'\)/
  );
});

test('correction list returns requested time for the selected scoped project', async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params: { ...params } });
    if (/FROM labor_project p/.test(sql)) {
      return [{ projectId: 12, projectName: '一厂项目', customerId: 7 }];
    }
    return [{
      id: 301,
      employeeId: 88,
      name: '员工甲',
      shiftDate: '2026-10-21',
      requestType: 'TIME_CORRECTION',
      requestedTime: '2026-10-21 08:03:00.000',
      status: 'PENDING'
    }];
  };
  try {
    const rows = await service.listCorrections(1, reviewer, { projectId: 12 });
    assert.equal(rows[0].requestedTime, '2026-10-21 08:03:00.000');
    const listCall = calls.find(call => /FROM attendance_correction_requests c/.test(call.sql));
    assert.ok(listCall);
    assert.match(listCall.sql, /c\.requested_time AS requestedTime/);
    assert.equal(listCall.params.projectId, 12);
  } finally {
    db.query = originalQuery;
  }
});

test('review validates request id and trimmed rejection comment before transaction', async () => {
  const originalTransaction = db.transaction;
  let transactionCalls = 0;
  db.transaction = async () => {
    transactionCalls += 1;
    throw new Error('transaction must not start for invalid input');
  };
  try {
    await assert.rejects(
      () => service.reviewCorrection(1, reviewer, 301, {
        action: 'APPROVE', clientRequestId: 'short'
      }),
      error => error.statusCode === 400 && error.businessCode === 'INVALID_CLIENT_REQUEST_ID'
    );
    await assert.rejects(
      () => service.reviewCorrection(1, reviewer, 301, {
        action: 'REJECT', reviewComment: '   ', clientRequestId: 'review-301-abc12345'
      }),
      error => error.statusCode === 400 && error.businessCode === 'REVIEW_COMMENT_REQUIRED'
    );
    await assert.rejects(
      () => service.reviewCorrection(1, reviewer, 301, {
        action: 'REJECT', reviewComment: '原'.repeat(501), clientRequestId: 'review-301-abc12345'
      }),
      error => error.statusCode === 400 && error.businessCode === 'REVIEW_COMMENT_TOO_LONG'
    );
    assert.equal(transactionCalls, 0);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('concurrent review succeeds at most once and writes a minimal idempotency audit', async () => {
  const originalTransaction = db.transaction;
  let status = 'PENDING';
  let queue = Promise.resolve();
  const writes = [];
  const client = {
    execute: async (sql, params = {}) => {
      if (/SELECT c\.\*/.test(sql)) {
        return [status === 'PENDING' ? [{
          id: 301,
          company_id: 1,
          employee_id: 88,
          shift_date: '2026-10-21',
          request_type: 'TIME_CORRECTION',
          requested_time: null,
          projectId: 12
        }] : []];
      }
      if (/FROM labor_project p/.test(sql)) {
        return [[{ projectId: 12, projectName: '一厂项目', customerId: 7 }]];
      }
      if (/UPDATE attendance_correction_requests/.test(sql)) {
        status = params.status;
        writes.push({ type: 'update', sql, params: { ...params } });
        return [{ affectedRows: 1 }];
      }
      if (/INSERT INTO hr_operation_log/.test(sql)) {
        writes.push({ type: 'audit', sql, params: { ...params } });
        return [{ insertId: 9001 }];
      }
      throw new Error(`Unexpected review SQL: ${sql}`);
    }
  };
  db.transaction = handler => {
    const current = queue.then(() => handler(client));
    queue = current.catch(() => {});
    return current;
  };

  try {
    const results = await Promise.allSettled([
      service.reviewCorrection(1, reviewer, 301, {
        action: 'REJECT',
        reviewComment: '  资料不符  ',
        clientRequestId: 'review-301-request-a'
      }),
      service.reviewCorrection(1, reviewer, 301, {
        action: 'REJECT',
        reviewComment: '重复审核',
        clientRequestId: 'review-301-request-b'
      })
    ]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter(item => item.status === 'rejected').length, 1);
    assert.equal(results.find(item => item.status === 'rejected').reason.businessCode, 'CORRECTION_NOT_FOUND');

    const update = writes.find(item => item.type === 'update');
    assert.equal(update.params.comment, '资料不符');
    const audit = writes.find(item => item.type === 'audit');
    assert.ok(audit, 'successful review must write an operation log in the transaction');
    const auditData = JSON.parse(audit.params.afterData);
    assert.deepEqual(auditData, {
      clientRequestId: 'review-301-request-a',
      correctionId: 301,
      action: 'REJECT',
      result: 'REJECTED'
    });
    assert.doesNotMatch(audit.params.afterData, /员工甲|身份证|手机号|工资/);
  } finally {
    db.transaction = originalTransaction;
  }
});
