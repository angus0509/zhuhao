const assert = require('node:assert/strict');
const db = require('../src/db');
const closureService = require('../src/services/attendance-closure.service');
const attendanceService = require('../src/services/attendance.service');

const user = { id: 9, companyId: 3, dataScope: 1 };

async function withTransaction(execute, callback) {
  const original = db.transaction;
  db.transaction = async handler => handler({ execute });
  try {
    return await callback();
  } finally {
    db.transaction = original;
  }
}

function baseResponder(writes, options = {}) {
  return async (sql, params) => {
    if (!/^\s*SELECT\b/i.test(sql)) writes.push({ sql, params });
    if (/FROM attendance_daily_closure_events/.test(sql)) return [[]];
    if (/FROM labor_project p/.test(sql)) {
      return options.projectDenied ? [[]] : [[{ projectId: 12 }]];
    }
    if (/FROM attendance_daily_closures/.test(sql) && /FOR UPDATE/.test(sql)) {
      return options.closure
        ? [[options.closure]]
        : [[]];
    }
    if (/AS pendingCount/.test(sql)) return [[{ pendingCount: Number(options.pendingCount || 0) }]];
    if (/AS paidCount/.test(sql)) return [[{ paidCount: Number(options.paidCount || 0) }]];
    return [{ insertId: options.insertId || 81, affectedRows: 1 }];
  };
}

async function run() {
  await assert.rejects(
    withTransaction(baseResponder([], { pendingCount: 1 }), () =>
      closureService.confirmDailyClosure(3, user, 9, {
        projectId: 12,
        shiftDate: '2026-09-29',
        clientRequestId: 'closure-confirm-12-20260929-v1'
      })),
    error => error.businessCode === 'ATTENDANCE_PENDING'
  );

  const confirmWrites = [];
  const confirmed = await withTransaction(baseResponder(confirmWrites), () =>
    closureService.confirmDailyClosure(3, user, 9, {
      projectId: 12,
      shiftDate: '2026-09-29',
      clientRequestId: 'closure-confirm-12-20260929-v1'
    }));
  assert.deepEqual(confirmed, {
    projectId: 12,
    shiftDate: '2026-09-29',
    status: 'CONFIRMED',
    versionNo: 1
  });
  assert.ok(confirmWrites.some(item => /INSERT INTO attendance_daily_closure_events/.test(item.sql)));
  assert.ok(confirmWrites.some(item => /UPDATE wage_calculation_runs SET status='CANCELLED'/.test(item.sql)));
  assert.equal(confirmWrites.filter(item => /INSERT INTO hr_operation_log/.test(item.sql)).length, 1);

  const replayWrites = [];
  const replayed = await withTransaction(async (sql, params) => {
    if (!/^\s*SELECT\b/i.test(sql)) replayWrites.push({ sql, params });
    if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
    if (/FROM attendance_daily_closure_events/.test(sql)) {
      return [[{
        actionType: 'CONFIRM', projectId: 12, shiftDate: '2026-09-29', versionNo: 1
      }]];
    }
    throw new Error(`replay should stop before: ${sql}`);
  }, () => closureService.confirmDailyClosure(3, user, 9, {
    projectId: 12,
    shiftDate: '2026-09-29',
    clientRequestId: 'closure-confirm-12-20260929-v1'
  }));
  assert.deepEqual(replayed, confirmed);
  assert.equal(replayWrites.length, 0, '重复请求不得再次写入或记录操作日志');

  const replayEvent = { actionType: 'CONFIRM', projectId: 12, shiftDate: '2026-09-29', versionNo: 1 };
  const closureReplayResponder = (event, authorized) => async sql => {
    if (/FROM labor_project p/.test(sql)) return [authorized || !sql.includes('sys_user_project')
      ? [{ projectId: 12 }] : []];
    if (/FROM attendance_daily_closure_events/.test(sql)) return [[event]];
    throw new Error(`重放请求不应继续：${sql}`);
  };
  const scopedUser = { ...user, dataScope: 5 };
  await assert.rejects(
    withTransaction(closureReplayResponder(replayEvent, false), () =>
      closureService.confirmDailyClosure(3, scopedUser, 9, {
        projectId: 12, shiftDate: '2026-09-29', clientRequestId: 'closure-confirm-12-20260929-v1'
      })),
    error => error.businessCode === 'PROJECT_FORBIDDEN'
  );
  await assert.rejects(
    withTransaction(closureReplayResponder(replayEvent, true), () =>
      closureService.confirmDailyClosure(3, user, 9, {
        projectId: 12, shiftDate: '2026-09-30', clientRequestId: 'closure-confirm-12-20260929-v1'
      })),
    error => error.businessCode === 'ATTENDANCE_REQUEST_CONFLICT'
  );
  await assert.rejects(
    withTransaction(closureReplayResponder(replayEvent, true), () =>
      closureService.confirmDailyClosure(3, user, 9, {
        projectId: 13, shiftDate: '2026-09-29', clientRequestId: 'closure-confirm-12-20260929-v1'
      })),
    error => error.businessCode === 'ATTENDANCE_REQUEST_CONFLICT'
  );
  await assert.rejects(
    withTransaction(closureReplayResponder(replayEvent, true), () =>
      closureService.reopenDailyClosure(3, user, 9, {
        projectId: 12, shiftDate: '2026-09-29', reason: '测试重开',
        clientRequestId: 'closure-confirm-12-20260929-v1'
      })),
    error => error.businessCode === 'ATTENDANCE_REQUEST_CONFLICT'
  );

  await assert.rejects(
    withTransaction(baseResponder([], {
      closure: { id: 81, status: 'CONFIRMED', versionNo: 1 }, paidCount: 1
    }), () => closureService.reopenDailyClosure(3, user, 9, {
      projectId: 12,
      shiftDate: '2026-09-29',
      reason: '员工补交下班卡',
      clientRequestId: 'closure-reopen-12-20260929-v1'
    })),
    error => error.businessCode === 'DAILY_PAYMENT_ACTIVE'
  );

  const reviewWrites = [];
  const reviewed = await withTransaction(async (sql, params) => {
    if (!/^\s*SELECT\b/i.test(sql)) reviewWrites.push({ sql, params });
    if (/FROM attendance_daily_review_events/.test(sql)) return [[]];
    if (/FROM attendance_daily_results d/.test(sql) && /FOR UPDATE/.test(sql)) {
      return [[{
        id: 55,
        projectId: 12,
        employeeId: 101,
        shiftDate: '2026-09-29',
        resultStatus: 'MISSING_PUNCH',
        hasGeofenceException: 0
      }]];
    }
    return [{ insertId: 91, affectedRows: 1 }];
  }, () => closureService.reviewDailyException(3, user, 9, 55, {
    action: 'CONFIRM_EXCEPTION',
    reviewComment: '已核实为现场设备故障',
    clientRequestId: 'daily-review-55-20260929'
  }));
  assert.deepEqual(reviewed, { id: 55, resultStatus: 'MISSING_PUNCH', reviewStatus: 'APPROVED' });
  const reviewUpdate = reviewWrites.find(item => /UPDATE attendance_daily_results/.test(item.sql));
  assert.match(reviewUpdate.sql, /review_status='APPROVED'/);
  assert.doesNotMatch(reviewUpdate.sql, /result_status\s*=/);
  assert.ok(reviewWrites.some(item => /INSERT INTO attendance_daily_review_events/.test(item.sql)));

  const reviewReplayEvent = {
    dailyResultId: 55, projectId: 12, actionType: 'CONFIRM_EXCEPTION', resultStatus: 'MISSING_PUNCH'
  };
  const reviewReplayResponder = (event, authorized) => async sql => {
    if (/FROM attendance_daily_review_events/.test(sql)) return [[event]];
    if (/FROM labor_project p/.test(sql)) return [authorized || !sql.includes('sys_user_project')
      ? [{ projectId: 12 }] : []];
    throw new Error(`核实重放请求不应继续：${sql}`);
  };
  const reviewReplay = await withTransaction(reviewReplayResponder(reviewReplayEvent, true), () =>
    closureService.reviewDailyException(3, user, 9, 55, {
      action: 'CONFIRM_EXCEPTION', reviewComment: '重复核实', clientRequestId: 'daily-review-55-20260929'
    }));
  assert.deepEqual(reviewReplay, reviewed);
  await assert.rejects(
    withTransaction(reviewReplayResponder(reviewReplayEvent, false), () =>
      closureService.reviewDailyException(3, scopedUser, 9, 55, {
        action: 'CONFIRM_EXCEPTION', reviewComment: '重复核实', clientRequestId: 'daily-review-55-20260929'
      })),
    error => error.businessCode === 'PROJECT_FORBIDDEN'
  );
  await assert.rejects(
    withTransaction(reviewReplayResponder(reviewReplayEvent, true), () =>
      closureService.reviewDailyException(3, user, 9, 56, {
        action: 'CONFIRM_EXCEPTION', reviewComment: '另一条核实', clientRequestId: 'daily-review-55-20260929'
      })),
    error => error.businessCode === 'ATTENDANCE_REQUEST_CONFLICT'
  );

  await assert.rejects(
    withTransaction(async sql => {
      if (/FROM attendance_daily_review_events/.test(sql)) return [[]];
      if (/FROM attendance_daily_results d/.test(sql) && /FOR UPDATE/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }, () => closureService.reviewDailyException(3, { ...user, dataScope: 5 }, 9, 55, {
      action: 'CONFIRM_EXCEPTION',
      reviewComment: '越权核实',
      clientRequestId: 'daily-review-55-forbidden'
    })),
    error => error.businessCode === 'ATTENDANCE_RESULT_FORBIDDEN'
  );

  const recalculateWrites = [];
  await attendanceService.recalculateDaily({
    execute: async (sql, params) => {
      recalculateWrites.push({ sql, params });
      if (/SELECT punch_type/.test(sql)) return [[]];
      return [{ affectedRows: 1 }];
    }
  }, 3, 101, '2026-09-29', {
    id: 31,
    projectId: 12,
    scheduleStatus: 'WORK',
    workStartTime: '08:00:00',
    workEndTime: '17:00:00',
    standardMinutes: 480,
    lateGraceMinutes: 0,
    earlyGraceMinutes: 0,
    overtimeMinMinutes: 30
  });
  const recalculate = recalculateWrites.find(item => /ON DUPLICATE KEY UPDATE/.test(item.sql));
  assert.match(recalculate.sql, /review_status='NONE'/);
  assert.match(recalculate.sql, /reviewed_by=NULL/);
  assert.match(recalculate.sql, /reviewed_at=NULL/);
}

run().then(() => console.log('attendance-daily-closure-tests-ok')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
