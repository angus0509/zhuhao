const assert = require('node:assert/strict');
const db = require('../src/db');

function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function run() {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const service = require('../src/services/attendance-project.service');

  for (const name of ['listProjects', 'getProjectSettings', 'saveProjectSettings', 'listCalendar', 'saveCalendarDay', 'resolveProjectRule']) {
    assert.equal(typeof service[name], 'function', `${name} missing`);
  }

  try {
    let captured;
    db.query = async (sql, params) => {
      captured = { sql, params };
      return [{ projectId: 12, projectName: '一厂项目', customerId: 7, customerName: '甲客户' }];
    };
    const projects = await service.listProjects(3, { id: 9, companyId: 3, dataScope: 5 });
    assert.equal(projects.length, 1);
    assert.match(captured.sql, /sys_user_project/);
    assert.match(captured.sql, /p\.company_id=:companyId/);
    assert.deepEqual(captured.params, { companyId: 3, scopeUserId: 9, scopeCompanyId: 3 });

    await assert.rejects(
      service.saveProjectSettings(3, { id: 9, dataScope: 1 }, 9, 12, {
        ruleName: '白班', workStartTime: '8:00', workEndTime: '17:00',
        workWeekdays: [1, 2, 3, 4, 5], effectiveFrom: '2026-09-16'
      }),
      error => error.businessCode === 'INVALID_PROJECT_RULE'
    );

    const baseRule = {
      ruleName: '白班', workStartTime: '08:00', workEndTime: '17:00',
      workWeekdays: [1, 2, 3, 4, 5], effectiveFrom: '2026-09-16'
    };
    for (const invalidRule of [
      { ...baseRule, workEndTime: '08:00' },
      { ...baseRule, workEndTime: '07:59' },
      { ...baseRule, restStartTime: '13:00', restEndTime: '12:00' },
      { ...baseRule, restStartTime: '07:30', restEndTime: '12:00' },
      { ...baseRule, restStartTime: '12:00', restEndTime: '17:30' },
      { ...baseRule, standardMinutes: 0 }
    ]) {
      assert.throws(() => service.validateRule(invalidRule), error => error.businessCode === 'INVALID_PROJECT_RULE');
    }
    assert.deepEqual(service.validateRule({ ...baseRule, restStartTime: '', restEndTime: '' }), {
      ruleName: '白班', workStartTime: '08:00', workEndTime: '17:00',
      restStartTime: null, restEndTime: null, standardMinutes: 480,
      lateGraceMinutes: 0, earlyGraceMinutes: 0, overtimeMinMinutes: 30,
      workWeekdays: [1, 2, 3, 4, 5], effectiveFrom: '2026-09-16'
    });
    await assert.rejects(
      service.saveProjectSettings(3, { id: 9, dataScope: 1 }, 9, 12, {
        ruleName: '白班', workStartTime: '08:00', workEndTime: '17:00',
        workWeekdays: [1, 1, 6], effectiveFrom: '2026-09-16'
      }),
      error => error.businessCode === 'INVALID_PROJECT_RULE'
    );

    const resolveQueries = [];
    const resolved = await service.resolveProjectRule({
      execute: async (sql, params) => {
        resolveQueries.push({ sql, params });
        if (/attendance_project_rules/.test(sql)) return [[{
          id: 25, projectId: 12, ruleName: '白班', workStartTime: '08:00:00', workEndTime: '17:00:00',
          restStartTime: '12:00:00', restEndTime: '13:00:00', standardMinutes: 480,
          lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30,
          workWeekdays: '1,2,3,4,5,6', effectiveFrom: '2026-09-01'
        }]];
        return [[{ dayType: 'REST_DAY' }]];
      }
    }, 3, 12, '2026-09-19');
    assert.equal(resolved.scheduleStatus, 'REST');
    assert.deepEqual(resolved.workWeekdays, [1, 2, 3, 4, 5, 6]);
    assert.match(resolveQueries[0].sql, /effective_from<=:shiftDate/);
    assert.match(resolveQueries[0].sql, /ORDER BY effective_from DESC/);

    const noRule = await service.resolveProjectRule({ execute: async () => [[]] }, 3, 12, '2026-09-20');
    assert.equal(noRule, null);
    const weekendRest = await service.resolveProjectRule({
      execute: async sql => /attendance_project_rules/.test(sql)
        ? [[{ id: 25, workWeekdays: '1,2,3,4,5' }]] : [[]]
    }, 3, 12, '2026-09-20');
    assert.equal(weekendRest.scheduleStatus, 'REST');
    const specialWorkday = await service.resolveProjectRule({
      execute: async sql => /attendance_project_rules/.test(sql)
        ? [[{ id: 25, workWeekdays: '1,2,3,4,5' }]] : [[{ dayType: 'WORKDAY' }]]
    }, 3, 12, '2026-09-20');
    assert.equal(specialWorkday.scheduleStatus, 'WORK');

    let forbiddenProjectQuery;
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        forbiddenProjectQuery = { sql, params };
        return [[]];
      }
    });
    await assert.rejects(
      service.getProjectSettings(3, { id: 9, companyId: 3, dataScope: 5 }, 12),
      error => error.businessCode === 'PROJECT_FORBIDDEN' && error.statusCode === 403
    );
    assert.match(forbiddenProjectQuery.sql, /p\.company_id=:companyId/);
    assert.deepEqual(forbiddenProjectQuery.params, {
      companyId: 3, projectId: 12, scopeUserId: 9, scopeCompanyId: 3
    });

    const writes = [];
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        writes.push({ sql, params });
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12 }]];
        if (/FROM attendance_project_rules/.test(sql)) return [[]];
        if (/INSERT INTO attendance_project_rules/.test(sql)) return [{ insertId: 25 }];
        return [{ insertId: 100 }];
      }
    });
    const saved = await service.saveProjectSettings(3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, {
      ruleName: '白班', workStartTime: '08:00', workEndTime: '17:00', restStartTime: '12:00', restEndTime: '13:00',
      standardMinutes: 480, lateGraceMinutes: 5, earlyGraceMinutes: 5, overtimeMinMinutes: 30,
      workWeekdays: [1, 2, 3, 4, 5, 6], effectiveFrom: '2026-09-16'
    });
    assert.deepEqual(saved, { projectId: 12, ruleId: 25, effectiveFrom: '2026-09-16' });
    assert.ok(writes.some(item => /ON DUPLICATE KEY UPDATE/.test(item.sql)));
    const audit = writes.find(item => /INSERT INTO hr_operation_log/.test(item.sql));
    assert.ok(audit, 'project rule audit missing');
    assert.deepEqual(JSON.parse(audit.params.afterData), { projectId: 12, ruleId: 25, effectiveFrom: '2026-09-16' });

    const today = shanghaiDate();
    const tomorrow = addDays(today, 1);
    let mutationAttempted = false;
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12 }]];
        if (/FROM attendance_project_rules/.test(sql)) return [[{ id: 88, effectiveFrom: today }]];
        if (/INSERT INTO attendance_project_rules/.test(sql)) mutationAttempted = true;
        return [[]];
      }
    });
    await assert.rejects(
      service.saveProjectSettings(3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, { ...baseRule, effectiveFrom: today }),
      error => error.businessCode === 'PROJECT_RULE_IMMUTABLE'
    );
    assert.equal(mutationAttempted, false, '已生效规则不得被 upsert');

    db.transaction = async handler => handler({
      execute: async sql => {
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12 }]];
        if (/FROM attendance_project_rules/.test(sql)) return [[{ id: 89, effectiveFrom: tomorrow }]];
        if (/FROM attendance_schedules/.test(sql)) return [[{ referenced: 1 }]];
        if (/INSERT INTO attendance_project_rules/.test(sql)) mutationAttempted = true;
        return [[]];
      }
    });
    await assert.rejects(
      service.saveProjectSettings(3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, { ...baseRule, effectiveFrom: tomorrow }),
      error => error.businessCode === 'PROJECT_RULE_IMMUTABLE'
    );
    assert.equal(mutationAttempted, false, '已被排班引用规则不得被 upsert');

    const futureWrites = [];
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        futureWrites.push({ sql, params });
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12 }]];
        if (/FROM attendance_project_rules/.test(sql)) return [[{ id: 90, effectiveFrom: tomorrow }]];
        if (/FROM attendance_schedules/.test(sql)) return [[]];
        if (/INSERT INTO attendance_project_rules/.test(sql)) return [{ insertId: 90 }];
        return [{ insertId: 100 }];
      }
    });
    const updatedFuture = await service.saveProjectSettings(
      3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, { ...baseRule, effectiveFrom: tomorrow }
    );
    assert.equal(updatedFuture.ruleId, 90);
    assert.ok(futureWrites.some(item => /INSERT INTO attendance_project_rules/.test(item.sql)));

    writes.length = 0;
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        writes.push({ sql, params });
        if (/SELECT p\.id/.test(sql)) return [[{ id: 12 }]];
        return [{ insertId: 100 }];
      }
    });
    const calendar = await service.saveCalendarDay(3, { id: 9, companyId: 3, dataScope: 5 }, 9, 12, {
      calendarDate: '2026-10-10', dayType: 'WORKDAY', remark: '国庆调班'
    });
    assert.deepEqual(calendar, { projectId: 12, calendarDate: '2026-10-10', dayType: 'WORKDAY' });
    assert.ok(writes.some(item => /INSERT INTO attendance_project_calendar/.test(item.sql) && /ON DUPLICATE KEY UPDATE/.test(item.sql)));
    assert.ok(writes.some(item => /INSERT INTO hr_operation_log/.test(item.sql)));

    await assert.rejects(
      service.listCalendar(3, { id: 9, dataScope: 1 }, 12, '2026-13'),
      error => error.businessCode === 'INVALID_MONTH'
    );
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
}

run().then(() => console.log('web-project-attendance-service.test.js: contract passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
