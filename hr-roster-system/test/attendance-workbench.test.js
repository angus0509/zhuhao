const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/attendance-workbench.service');

async function run() {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql, params });
    if (/AS scheduled/.test(sql)) {
      return [{
        projectId: 12,
        closureStatus: 'OPEN',
        closureVersionNo: 0,
        confirmedAt: null,
        scheduled: 5,
        present: 3,
        normal: 1,
        late: 1,
        earlyLeave: 0,
        missingPunch: 1,
        absent: 1,
        geofenceException: 1,
        pendingReview: 1
      }];
    }
    return [{
      employeeId: 101,
      name: '张三',
      firstInAt: '2026-09-29 08:02:00',
      lastOutAt: null,
      workedMinutes: 240,
      approvedMinutes: 240,
      resultStatus: 'MISSING_PUNCH',
      geofenceStatus: 'INSIDE',
      pendingReason: '缺少打卡'
    }];
  };
  try {
    const result = await service.getWorkbench(3, {
      id: 9,
      companyId: 3,
      dataScope: 5
    }, {
      projectId: 12,
      date: '2026-09-29',
      status: 'PENDING',
      keyword: '张'
    });
    assert.deepEqual(result.summary, {
      scheduled: 5,
      present: 3,
      normal: 1,
      late: 1,
      earlyLeave: 0,
      missingPunch: 1,
      absent: 1,
      geofenceException: 1,
      pendingReview: 1
    });
    assert.deepEqual(result.closure, { status: 'OPEN', versionNo: 0, confirmedAt: null });
    assert.equal(result.list.length, 1);
    assert.equal(JSON.stringify(result).includes('hourlyRate'), false);
    assert.equal(JSON.stringify(result).includes('earnedAmount'), false);
    assert.equal(queries.length, 2);
    assert.ok(queries.every(item => /sys_user_project/.test(item.sql)), '汇总与明细都必须应用项目范围');
    assert.equal(queries[1].params.keyword, '%张%');
    assert.match(queries[1].sql, /review_status<>'APPROVED'/);

    await assert.rejects(
      service.getWorkbench(3, { id: 9, companyId: 3, dataScope: 1 }, {
        projectId: 12,
        date: '2026-02-30'
      }),
      error => error.businessCode === 'INVALID_WORKBENCH_QUERY'
    );
    await assert.rejects(
      service.getWorkbench(3, { id: 9, companyId: 3, dataScope: 1 }, {
        projectId: 12,
        date: '2026-09-29',
        keyword: '超'.repeat(51)
      }),
      error => error.businessCode === 'INVALID_WORKBENCH_QUERY'
    );
  } finally {
    db.query = originalQuery;
  }
}

run().then(() => console.log('attendance-workbench-tests-ok')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
