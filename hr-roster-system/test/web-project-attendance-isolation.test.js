const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/attendance.service');

async function run() {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const onsite = { id: 9, companyId: 3, dataScope: 5 };

  try {
    assert.equal(typeof service.ensureProjectSchedules, 'function');
    assert.equal(typeof service.loadSchedule, 'function');
    assert.equal(service.isJobEffectiveOnDate({ hireDate: '2026-01-01', leaveDate: '2026-03-31' }, '2026-03-15'), true);
    assert.equal(service.isJobEffectiveOnDate({ hireDate: '2026-01-01', leaveDate: '2026-03-31' }, '2026-04-01'), false);
    assert.equal(service.isJobEffectiveOnDate({ hireDate: '2026-01-01', nextHireDate: '2026-05-01' }, '2026-04-30'), true);
    assert.equal(service.isJobEffectiveOnDate({ hireDate: '2026-01-01', nextHireDate: '2026-05-01' }, '2026-05-01'), false);

    await assert.rejects(service.listDaily(3, onsite, { date: '2026-09-15' }),
      error => error.businessCode === 'PROJECT_REQUIRED');
    await assert.rejects(service.listMonthly(3, onsite, { month: '2026-09' }),
      error => error.businessCode === 'PROJECT_REQUIRED');
    await assert.rejects(service.listCorrections(3, onsite, {}),
      error => error.businessCode === 'PROJECT_REQUIRED');
    for (const invalidDate of ['2026-02-31', '2026-99-01']) {
      await assert.rejects(service.listDaily(3, onsite, { projectId: 12, date: invalidDate }),
        error => error.businessCode === 'INVALID_DATE');
      await assert.rejects(service.ensureProjectSchedules(3, onsite, 12, invalidDate),
        error => error.businessCode === 'INVALID_DATE');
    }
    await assert.rejects(service.listMonthly(3, onsite, { projectId: 12, month: '2026-99' }),
      error => error.businessCode === 'INVALID_MONTH');

    db.query = async sql => /FROM labor_project p/.test(sql) ? [] : [];
    await assert.rejects(service.listDaily(3, onsite, { projectId: 99, date: '2026-09-15' }),
      error => error.businessCode === 'PROJECT_FORBIDDEN');

    const dailyQueries = [];
    const dailyWrites = [];
    db.transaction = async handler => handler({ execute: async (sql, params) => {
      dailyWrites.push({ sql, params });
      if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12, projectName: '一厂项目' }]];
      if (/FROM hr_employee_job j/.test(sql)) return [[{ employeeId: 102, hireDate: '2026-01-01' }]];
      if (/FROM attendance_project_rules/.test(sql)) return [[{
        id: 25, workWeekdays: '1,2,3,4,5', shiftDate: '2026-09-15', scheduleStatus: 'WORK'
      }]];
      if (/FROM attendance_project_calendar/.test(sql)) return [[]];
      if (/FROM attendance_schedules s/.test(sql)) return [[{
        id: 55, projectId: 12, shiftDate: '2026-09-15', scheduleStatus: 'WORK', projectRuleId: 25,
        workStartTime: '08:00:00', workEndTime: '17:00:00', restStartTime: '12:00:00',
        restEndTime: '13:00:00', standardMinutes: 480, lateGraceMinutes: 0,
        earlyGraceMinutes: 0, overtimeMinMinutes: 30
      }]];
      if (/FROM attendance_punches/.test(sql)) return [[]];
      return [{ insertId: 1 }];
    } });
    db.query = async (sql, params) => {
      dailyQueries.push({ sql, params });
      if (/FROM labor_project p/.test(sql)) return [{ projectId: 12, projectName: '一厂项目' }];
      if (/FROM attendance_daily_results d/.test(sql)) return [
        { employeeId: 101, name: '甲', resultStatus: 'NORMAL', geofenceStatus: 'INSIDE' },
        { employeeId: 102, name: '乙', resultStatus: 'ABSENT', geofenceStatus: null }
      ];
      if (/COUNT\(\*\) AS unresolvedHistoryCount/.test(sql)) return [{ unresolvedHistoryCount: 2 }];
      return [];
    };
    const daily = await service.listDaily(3, onsite, { projectId: 12, date: '2026-09-15' });
    assert.equal(daily.project.projectId, 12);
    assert.deepEqual(daily.summary, { scheduled: 2, normal: 1, late: 0, earlyLeave: 0, missingPunch: 0, absent: 1, geofenceException: 0 });
    assert.equal(daily.unresolvedHistoryCount, 2);
    assert.ok(dailyWrites.some(item => /INSERT INTO attendance_schedules/.test(item.sql)), '日报未生成项目排班');
    assert.ok(dailyWrites.some(item => /INSERT INTO attendance_daily_results/.test(item.sql)
      && item.params.resultStatus === 'ABSENT'), '日报未将工作日无打卡计算为旷工');
    const dailySql = dailyQueries.find(item => /FROM attendance_daily_results d/.test(item.sql));
    assert.match(dailySql.sql, /d\.project_id=:projectId/);
    assert.doesNotMatch(dailySql.sql, /j\.project_id/);

    const monthlyQueries = [];
    const monthlyScheduleDates = [];
    const monthlyDailyResults = [];
    db.transaction = async handler => handler({ execute: async (sql, params) => {
      if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12, projectName: '一厂项目' }]];
      if (/FROM hr_employee_job j/.test(sql)) {
        monthlyScheduleDates.push(params.shiftDate);
        return [[{ employeeId: 101, hireDate: '2026-01-01' }]];
      }
      if (/FROM attendance_project_rules/.test(sql)) return params.shiftDate === '2026-09-02' ? [[]] : [[{
        id: 25, workWeekdays: '1,2,3,4,5,6,7', shiftDate: params.shiftDate
      }]];
      if (/FROM attendance_project_calendar/.test(sql)) return params.shiftDate === '2026-09-03'
        ? [[{ dayType: 'REST_DAY' }]] : [[]];
      if (/FROM attendance_schedules s/.test(sql)) return [[{
        id: 55, projectId: 12, shiftDate: params.shiftDate,
        scheduleStatus: params.shiftDate === '2026-09-03' ? 'REST' : 'WORK', projectRuleId: 25,
        workStartTime: '08:00:00', workEndTime: '17:00:00', restStartTime: '12:00:00',
        restEndTime: '13:00:00', standardMinutes: 480, lateGraceMinutes: 0,
        earlyGraceMinutes: 0, overtimeMinMinutes: 30
      }]];
      if (/FROM attendance_punches/.test(sql)) return [[]];
      if (/INSERT INTO attendance_daily_results/.test(sql)) monthlyDailyResults.push(params);
      return [[]];
    } });
    db.query = async (sql, params) => {
      monthlyQueries.push({ sql, params });
      if (/FROM labor_project p/.test(sql)) return [{ projectId: 12, projectName: '一厂项目' }];
      if (/GROUP BY d\.employee_id/.test(sql)) return [{
        employeeId: 101, name: '甲', scheduledDays: 2, attendanceDays: 2,
        approvedNormalMinutes: 900, approvedOvertimeMinutes: 60, lateMinutes: 5,
        earlyLeaveMinutes: 0, missingPunchDays: 0, absentDays: 0, geofenceExceptionCount: 1
      }];
      if (/COUNT\(\*\) AS unresolvedHistoryCount/.test(sql)) return [{ unresolvedHistoryCount: 1 }];
      return [];
    };
    const monthly = await service.listMonthly(3, onsite, { projectId: 12, month: '2026-09' });
    assert.deepEqual(monthly.summary, { employeeCount: 1, approvedNormalMinutes: 900, approvedOvertimeMinutes: 60 });
    assert.equal(monthly.unresolvedHistoryCount, 1);
    const monthlySql = monthlyQueries.find(item => /GROUP BY d\.employee_id/.test(item.sql));
    assert.match(monthlySql.sql, /d\.project_id=:projectId/);
    assert.match(monthlySql.sql, /p\.project_id=d\.project_id/);
    assert.match(monthlySql.sql, /SUM\(d\.result_status<>'REST'\) AS scheduledDays/);
    assert.deepEqual(monthlyScheduleDates, Array.from({ length: 15 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`));
    assert.equal(monthlyDailyResults.length, 14, '无规则日不应生成每日结果');
    assert.equal(monthlyDailyResults.find(item => item.shiftDate === '2026-09-03').resultStatus, 'REST');
    assert.equal(monthlyDailyResults.find(item => item.shiftDate === '2026-09-01').resultStatus, 'ABSENT');

    const scheduleWrites = [];
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        scheduleWrites.push({ sql, params });
        if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12, projectName: '一厂项目' }]];
        if (/FROM hr_employee_job j/.test(sql)) return [[{ employeeId: 101, hireDate: '2026-01-01' }]];
        if (/FROM attendance_project_rules/.test(sql)) return [[{
          id: 25, workWeekdays: '1,2,3,4,5', scheduleStatus: 'WORK'
        }]];
        return [{ insertId: 1 }];
      }
    });
    await service.ensureProjectSchedules(3, onsite, 12, '2026-09-15');
    const generated = scheduleWrites.find(item => /INSERT INTO attendance_schedules/.test(item.sql));
    assert.match(generated.sql, /shift_rule_id,schedule_status,created_by/);
    assert.match(generated.sql, /:projectRuleId,NULL/);
    assert.match(generated.sql, /project_id=COALESCE\(project_id,VALUES\(project_id\)\)/);
    assert.doesNotMatch(generated.sql, /schedule_status=VALUES\(schedule_status\)/);
    const workforceSql = scheduleWrites.find(item => /FROM hr_employee_job j/.test(item.sql)).sql;
    assert.doesNotMatch(workforceSql, /e\.employee_status|j\.job_status/);
    assert.match(workforceSql, /hr_resignation/);
    assert.match(workforceSql, /leave_date/);

    const loadQueries = [];
    await service.loadSchedule({ execute: async sql => {
      loadQueries.push(sql);
      return [[{ id: 1, shiftRuleId: 7, projectRuleId: null }]];
    } }, 3, 101, '2026-09-15');
    assert.match(loadQueries[0], /attendance_shift_rules/);
    assert.match(loadQueries[0], /attendance_project_rules/);

    let updated = false;
    db.transaction = async handler => handler({ execute: async sql => {
      if (/FROM hr_employee e/.test(sql)) return [[{ id: 101 }]];
      if (/attendance_shift_rules/.test(sql)) return [[{ id: 7 }]];
      if (/INSERT INTO attendance_schedules/.test(sql)) updated = /project_rule_id=NULL/.test(sql);
      return [[]];
    } });
    await service.upsertSchedule(3, { id: 1, dataScope: 1 }, 1, {
      employeeId: 101, shiftRuleId: 7, shiftDate: '2026-09-15', scheduleStatus: 'REST'
    });
    assert.equal(updated, true, '人工排班必须清空 project_rule_id');

    const reviewQueries = [];
    db.transaction = async handler => handler({ execute: async (sql, params) => {
      reviewQueries.push({ sql, params });
      if (/FROM attendance_correction_requests c/.test(sql)) return [[{
        id: 5, employee_id: 101, shift_date: '2026-09-01', request_type: 'GEOFENCE_EXCEPTION', projectId: 12
      }]];
      if (/FROM labor_project p/.test(sql)) return [[]];
      return [[]];
    } });
    await assert.rejects(service.reviewCorrection(3, onsite, 5, { action: 'REJECT' }),
      error => error.businessCode === 'PROJECT_FORBIDDEN');
    assert.match(reviewQueries[0].sql, /COALESCE\(p\.project_id,d\.project_id\) AS projectId/);

    db.transaction = async handler => handler({ execute: async sql => {
      if (/FROM attendance_correction_requests c/.test(sql)) return [[{
        id: 6, employee_id: 101, shift_date: '2026-08-01', request_type: 'GEOFENCE_EXCEPTION', projectId: null
      }]];
      throw new Error('无项目快照时不应继续查询当前任职');
    } });
    await assert.rejects(service.reviewCorrection(3, onsite, 6, { action: 'REJECT' }),
      error => error.businessCode === 'PROJECT_HISTORY_UNRESOLVED');

    const futureWrites = [];
    db.transaction = async handler => handler({ execute: async (sql, params) => {
      futureWrites.push({ sql, params });
      if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
      if (/FROM hr_employee_job j/.test(sql)) return [[{ employeeId: 101, hireDate: '2099-01-01' }]];
      if (/FROM attendance_project_rules/.test(sql)) return [[{ id: 25, workWeekdays: '1,2,3,4,5' }]];
      if (/FROM attendance_project_calendar/.test(sql)) return [[]];
      if (/FROM attendance_schedules s/.test(sql)) return [[{ id: 1, projectId: 12, scheduleStatus: 'WORK' }]];
      return [{ insertId: 1 }];
    } });
    await service.ensureProjectSchedules(3, onsite, 12, '2099-01-05');
    assert.equal(futureWrites.some(item => /INSERT INTO attendance_daily_results/.test(item.sql)), false,
      '未来日期不得提前记录旷工');

    let legacyPayrollSql = '';
    db.query = async (sql) => {
      legacyPayrollSql = sql;
      return [{ employeeId: 101, name: '甲', approvedNormalMinutes: 480, approvedOvertimeMinutes: 30 }];
    };
    const legacyPayroll = await service.attendanceSummaryForPayroll(3, onsite, { month: '2026-09' });
    assert.equal(legacyPayroll.list.length, 1);
    assert.match(legacyPayrollSql, /d\.project_id/);
    assert.match(legacyPayrollSql, /JOIN labor_project history_project/);
    assert.match(legacyPayrollSql, /scope_up\.project_id = history_project\.id/);
    assert.doesNotMatch(legacyPayrollSql, /ORDER BY \(j2\.job_status=1\)/);

    db.query = async sql => {
      legacyPayrollSql = sql;
      return [];
    };
    await service.attendanceSummaryForPayroll(3, { id: 1, dataScope: 1 }, { month: '2026-09' });
    assert.match(legacyPayrollSql, /LEFT JOIN labor_project history_project/,
      '企业级角色应保留 project_id NULL 历史合同可见性');
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
}

run().then(() => console.log('web-project-attendance-isolation.test.js: all assertions passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
