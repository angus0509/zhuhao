const db = require('../db');
const { projectScope } = require('../utils/data-scope');
const { createError } = require('../utils/response');
const { replaceProjectGeofences } = require('./attendance-geofence-management.service');

async function query(client, sql, params = {}) {
  const [rows] = await client.execute(sql, params);
  return rows;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validMonth(value) {
  const text = String(value || '');
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(text);
}

function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
}

function minutesOfDay(value) {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function validMoney(value) {
  return /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(value ?? '').trim());
}

function validateShiftRules(shifts) {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!Array.isArray(shifts) || shifts.length !== 2) {
    throw createError('白班和夜班规则必须各配置一条', 400, 'INVALID_SHIFT_RULE');
  }
  const normalized = shifts.map(item => {
    const shiftType = String(item?.shiftType || '');
    const workStartTime = String(item?.workStartTime || '');
    const workEndTime = String(item?.workEndTime || '');
    const restStartTime = item?.restStartTime ? String(item.restStartTime) : null;
    const restEndTime = item?.restEndTime ? String(item.restEndTime) : null;
    const standardHours = Number(item?.standardHours);
    const invalid = !['DAY', 'NIGHT'].includes(shiftType)
      || !timePattern.test(workStartTime) || !timePattern.test(workEndTime)
      || Boolean(restStartTime) !== Boolean(restEndTime)
      || !Number.isFinite(standardHours) || standardHours <= 0 || standardHours > 24
      || !Number.isInteger(standardHours * 2) || !validMoney(item?.hourlyRate);
    if (invalid) throw createError('班次规则参数无效', 400, 'INVALID_SHIFT_RULE');
    if (shiftType === 'DAY' && workEndTime <= workStartTime) {
      throw createError('白班下班时间必须晚于上班时间', 400, 'INVALID_SHIFT_RULE');
    }
    if (restStartTime) {
      if (!timePattern.test(restStartTime) || !timePattern.test(restEndTime)) {
        throw createError('班次休息时间无效', 400, 'INVALID_SHIFT_RULE');
      }
      const start = minutesOfDay(workStartTime);
      let end = minutesOfDay(workEndTime);
      if (end <= start) end += 1440;
      let restStart = minutesOfDay(restStartTime);
      let restEnd = minutesOfDay(restEndTime);
      if (restStart <= start && end > 1440) restStart += 1440;
      if (restEnd <= start && end > 1440) restEnd += 1440;
      if (restEnd <= restStart || restStart < start || restEnd > end) {
        throw createError('班次休息时间必须位于上下班时间内', 400, 'INVALID_SHIFT_RULE');
      }
    }
    return {
      shiftType,
      workStartTime,
      workEndTime,
      restStartTime,
      restEndTime,
      standardHours,
      standardMinutes: standardHours * 60,
      hourlyRate: Number(item.hourlyRate).toFixed(2)
    };
  });
  if (new Set(normalized.map(item => item.shiftType)).size !== 2) {
    throw createError('白班和夜班规则必须各配置一条', 400, 'INVALID_SHIFT_RULE');
  }
  return normalized.sort((left, right) => (left.shiftType === 'DAY' ? -1 : right.shiftType === 'DAY' ? 1 : 0));
}

function validateAllowances(allowances = []) {
  if (!Array.isArray(allowances) || allowances.length > 50) {
    throw createError('补贴规则参数无效', 400, 'INVALID_ALLOWANCE_RULE');
  }
  const seen = new Set();
  return allowances.map((item, index) => {
    const allowanceName = String(item?.allowanceName || '').trim();
    const shiftScope = String(item?.shiftScope || '');
    const calculationType = String(item?.calculationType || '');
    const key = `${allowanceName}\u0000${shiftScope}`;
    if (!allowanceName || allowanceName.length > 80 || !['DAY', 'NIGHT', 'ALL'].includes(shiftScope)
      || !['PER_SHIFT', 'PER_HOUR'].includes(calculationType) || !validMoney(item?.unitAmount)) {
      throw createError('补贴规则参数无效', 400, 'INVALID_ALLOWANCE_RULE');
    }
    if (seen.has(key)) throw createError('同一班次存在重复补贴', 400, 'DUPLICATE_ALLOWANCE');
    seen.add(key);
    return { allowanceName, shiftScope, calculationType, unitAmount: Number(item.unitAmount).toFixed(2), sortOrder: index };
  });
}

function validateRule(body = {}) {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const ruleName = String(body.ruleName || '').trim();
  const weekdays = body.workWeekdays;
  const minuteDefaults = {
    standardMinutes: 480,
    lateGraceMinutes: 0,
    earlyGraceMinutes: 0,
    overtimeMinMinutes: 30
  };
  const minutes = Object.fromEntries(Object.entries(minuteDefaults).map(([key, fallback]) => {
    const value = body[key] == null || body[key] === '' ? fallback : Number(body[key]);
    return [key, value];
  }));
  const restStartTime = body.restStartTime ? String(body.restStartTime) : null;
  const restEndTime = body.restEndTime ? String(body.restEndTime) : null;
  const workStartTime = String(body.workStartTime || '');
  const workEndTime = String(body.workEndTime || '');
  const invalid = !ruleName || ruleName.length > 100
    || !timePattern.test(workStartTime)
    || !timePattern.test(workEndTime)
    || workEndTime <= workStartTime
    || Boolean(restStartTime) !== Boolean(restEndTime)
    || (restStartTime && (!timePattern.test(restStartTime) || !timePattern.test(restEndTime)
      || restEndTime <= restStartTime || restStartTime < workStartTime || restEndTime > workEndTime))
    || !Array.isArray(weekdays) || weekdays.length === 0
    || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)
    || new Set(weekdays).size !== weekdays.length
    || Object.entries(minutes).some(([key, value]) => !Number.isInteger(value)
      || value < (key === 'standardMinutes' ? 1 : 0) || value > 1440)
    || !validDate(body.effectiveFrom);
  if (invalid) throw createError('项目考勤规则参数无效', 400, 'INVALID_PROJECT_RULE');
  return {
    ruleName,
    workStartTime,
    workEndTime,
    restStartTime,
    restEndTime,
    ...minutes,
    workWeekdays: [...weekdays].sort((a, b) => a - b),
    effectiveFrom: body.effectiveFrom
  };
}

async function assertProject(client, companyId, user, projectId) {
  const id = positiveId(projectId);
  if (!id) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
  const params = { companyId, projectId: id };
  const scope = projectScope(user, params, 'p');
  const rows = await query(client, `SELECT p.id,p.customer_id AS customerId,p.project_name AS projectName
    FROM labor_project p WHERE p.company_id=:companyId AND p.id=:projectId ${scope} LIMIT 1`, params);
  if (!rows[0]) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
  return rows[0];
}

async function listProjects(companyId, user) {
  const params = { companyId };
  const scope = projectScope(user, params, 'p');
  return db.query(`SELECT p.id AS projectId,p.project_name AS projectName,
      p.customer_id AS customerId,c.customer_name AS customerName
    FROM labor_project p JOIN crm_customer c ON c.id=p.customer_id AND c.company_id=p.company_id
    WHERE p.company_id=:companyId AND p.status=2 ${scope}
    ORDER BY c.customer_name,p.project_name,p.id`, params);
}

async function getProjectSettings(companyId, user, projectId) {
  return db.transaction(async client => {
    const project = await assertProject(client, companyId, user, projectId);
    const rules = await query(client, `SELECT id AS ruleId,rule_name AS ruleName,work_start_time AS workStartTime,
        work_end_time AS workEndTime,rest_start_time AS restStartTime,rest_end_time AS restEndTime,
        standard_minutes AS standardMinutes,late_grace_minutes AS lateGraceMinutes,
        early_grace_minutes AS earlyGraceMinutes,overtime_min_minutes AS overtimeMinMinutes,
        work_weekdays AS workWeekdays,effective_from AS effectiveFrom,status
      FROM attendance_project_rules
      WHERE company_id=:companyId AND project_id=:projectId
      ORDER BY effective_from DESC,id DESC`, { companyId, projectId: positiveId(projectId) });
    const geofences = await query(client, `SELECT geofence_id AS geofenceId
      FROM attendance_project_geofence
      WHERE company_id=:companyId AND project_id=:projectId AND status=1
      ORDER BY geofence_id`, { companyId, projectId: positiveId(projectId) });
    const shifts = await query(client, `SELECT project_rule_id AS projectRuleId,shift_type AS shiftType,
        work_start_time AS workStartTime,work_end_time AS workEndTime,rest_start_time AS restStartTime,
        rest_end_time AS restEndTime,standard_minutes AS standardMinutes,hourly_rate AS hourlyRate,status
      FROM attendance_project_shift_rules
      WHERE company_id=:companyId AND project_id=:projectId
      ORDER BY project_rule_id,FIELD(shift_type,'DAY','NIGHT')`, { companyId, projectId: positiveId(projectId) });
    const allowances = await query(client, `SELECT project_rule_id AS projectRuleId,allowance_name AS allowanceName,
        shift_scope AS shiftScope,calculation_type AS calculationType,unit_amount AS unitAmount,sort_order AS sortOrder,status
      FROM attendance_allowance_rules
      WHERE company_id=:companyId AND project_id=:projectId
      ORDER BY project_rule_id,sort_order,id`, { companyId, projectId: positiveId(projectId) });
    const shiftsByRule = new Map();
    for (const shift of shifts) {
      const key = Number(shift.projectRuleId);
      if (!shiftsByRule.has(key)) shiftsByRule.set(key, []);
      shiftsByRule.get(key).push({ ...shift, standardHours: Number(shift.standardMinutes) / 60 });
    }
    const allowancesByRule = new Map();
    for (const allowance of allowances) {
      const key = Number(allowance.projectRuleId);
      if (!allowancesByRule.has(key)) allowancesByRule.set(key, []);
      allowancesByRule.get(key).push(allowance);
    }
    return {
      project: { projectId: project.id, projectName: project.projectName, customerId: project.customerId },
      rules: rules.map(rule => {
        const configuredShifts = shiftsByRule.get(Number(rule.ruleId)) || [{
          projectRuleId: Number(rule.ruleId), shiftType: 'DAY', workStartTime: rule.workStartTime,
          workEndTime: rule.workEndTime, restStartTime: rule.restStartTime, restEndTime: rule.restEndTime,
          standardMinutes: Number(rule.standardMinutes), standardHours: Number(rule.standardMinutes) / 60,
          hourlyRate: null, status: rule.status
        }];
        return {
          ...rule,
          workWeekdays: String(rule.workWeekdays).split(',').map(Number),
          shifts: configuredShifts,
          allowances: allowancesByRule.get(Number(rule.ruleId)) || []
        };
      }),
      geofenceIds: geofences.map(item => Number(item.geofenceId))
    };
  });
}

async function saveProjectSettings(companyId, user, operatorId, projectId, body = {}) {
  const shifts = body.shifts == null ? null : validateShiftRules(body.shifts);
  const allowances = body.allowances == null ? [] : validateAllowances(body.allowances);
  const dayShift = shifts?.find(item => item.shiftType === 'DAY');
  const values = validateRule(dayShift ? {
    ...body,
    workStartTime: dayShift.workStartTime,
    workEndTime: dayShift.workEndTime,
    restStartTime: dayShift.restStartTime,
    restEndTime: dayShift.restEndTime,
    standardMinutes: dayShift.standardMinutes
  } : body);
  return db.transaction(async client => {
    await assertProject(client, companyId, user, projectId);
    const existingRules = await query(client, `SELECT id,effective_from AS effectiveFrom
      FROM attendance_project_rules
      WHERE company_id=:companyId AND project_id=:projectId AND effective_from=:effectiveFrom
      LIMIT 1 FOR UPDATE`, {
      companyId, projectId: positiveId(projectId), effectiveFrom: values.effectiveFrom
    });
    if (existingRules[0]) {
      const existingRule = existingRules[0];
      const referenced = await query(client, `SELECT 1 AS referenced FROM attendance_schedules
        WHERE company_id=:companyId AND project_id=:projectId AND project_rule_id=:ruleId LIMIT 1`, {
        companyId, projectId: positiveId(projectId), ruleId: Number(existingRule.id)
      });
      if (String(existingRule.effectiveFrom) <= shanghaiDate() || referenced[0]) {
        throw createError('已生效或已用于排班的规则不可修改，请新增规则版本', 409, 'PROJECT_RULE_IMMUTABLE');
      }
    }
    const result = await query(client, `INSERT INTO attendance_project_rules
      (company_id,project_id,rule_name,work_start_time,work_end_time,rest_start_time,rest_end_time,
       standard_minutes,late_grace_minutes,early_grace_minutes,overtime_min_minutes,work_weekdays,
       effective_from,status,created_by,updated_by)
      VALUES (:companyId,:projectId,:ruleName,:workStartTime,:workEndTime,:restStartTime,:restEndTime,
       :standardMinutes,:lateGraceMinutes,:earlyGraceMinutes,:overtimeMinMinutes,:workWeekdays,
       :effectiveFrom,1,:operatorId,:operatorId)
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),rule_name=VALUES(rule_name),
       work_start_time=VALUES(work_start_time),work_end_time=VALUES(work_end_time),
       rest_start_time=VALUES(rest_start_time),rest_end_time=VALUES(rest_end_time),
       standard_minutes=VALUES(standard_minutes),late_grace_minutes=VALUES(late_grace_minutes),
       early_grace_minutes=VALUES(early_grace_minutes),overtime_min_minutes=VALUES(overtime_min_minutes),
       work_weekdays=VALUES(work_weekdays),status=1,updated_by=VALUES(updated_by)`, {
      companyId,
      projectId: positiveId(projectId),
      operatorId: positiveId(operatorId),
      ...values,
      workWeekdays: values.workWeekdays.join(',')
    });
    const ruleId = Number(result.insertId);
    const summary = { projectId: positiveId(projectId), ruleId, effectiveFrom: values.effectiveFrom };
    if (shifts) {
      await query(client, `UPDATE attendance_project_shift_rules SET status=0,updated_by=:operatorId
        WHERE company_id=:companyId AND project_id=:projectId AND project_rule_id=:ruleId`, {
        companyId, projectId: positiveId(projectId), ruleId, operatorId: positiveId(operatorId)
      });
      await query(client, `UPDATE attendance_allowance_rules SET status=0,updated_by=:operatorId
        WHERE company_id=:companyId AND project_id=:projectId AND project_rule_id=:ruleId`, {
        companyId, projectId: positiveId(projectId), ruleId, operatorId: positiveId(operatorId)
      });
      for (const shift of shifts) {
        await query(client, `INSERT INTO attendance_project_shift_rules
          (company_id,project_id,project_rule_id,shift_type,work_start_time,work_end_time,rest_start_time,
           rest_end_time,standard_minutes,hourly_rate,status,created_by,updated_by)
          VALUES (:companyId,:projectId,:ruleId,:shiftType,:workStartTime,:workEndTime,:restStartTime,
           :restEndTime,:standardMinutes,:hourlyRate,1,:operatorId,:operatorId)
          ON DUPLICATE KEY UPDATE work_start_time=VALUES(work_start_time),work_end_time=VALUES(work_end_time),
           rest_start_time=VALUES(rest_start_time),rest_end_time=VALUES(rest_end_time),
           standard_minutes=VALUES(standard_minutes),hourly_rate=VALUES(hourly_rate),status=1,
           updated_by=VALUES(updated_by)`, {
          companyId, projectId: positiveId(projectId), ruleId, operatorId: positiveId(operatorId), ...shift
        });
      }
      for (const allowance of allowances) {
        await query(client, `INSERT INTO attendance_allowance_rules
          (company_id,project_id,project_rule_id,allowance_name,shift_scope,calculation_type,unit_amount,
           sort_order,status,created_by,updated_by)
          VALUES (:companyId,:projectId,:ruleId,:allowanceName,:shiftScope,:calculationType,:unitAmount,
           :sortOrder,1,:operatorId,:operatorId)
          ON DUPLICATE KEY UPDATE calculation_type=VALUES(calculation_type),unit_amount=VALUES(unit_amount),
           sort_order=VALUES(sort_order),status=1,updated_by=VALUES(updated_by)`, {
          companyId, projectId: positiveId(projectId), ruleId, operatorId: positiveId(operatorId), ...allowance
        });
      }
    }
    if (Array.isArray(body.geofenceIds)) {
      const association = await replaceProjectGeofences(client, companyId, user, operatorId, projectId, body.geofenceIds);
      summary.geofenceIds = association.geofenceIds;
    }
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'项目考勤','attendance_project_rule',:ruleId,'upsert',:afterData)`, {
      companyId,
      operatorId: positiveId(operatorId),
      ruleId,
      afterData: JSON.stringify(shifts
        ? { ...summary, shiftCount: shifts.length, allowanceCount: allowances.length }
        : summary)
    });
    return summary;
  });
}

async function listCalendar(companyId, user, projectId, month) {
  if (!validMonth(month)) throw createError('月份参数无效', 400, 'INVALID_MONTH');
  return db.transaction(async client => {
    await assertProject(client, companyId, user, projectId);
    return query(client, `SELECT id,calendar_date AS calendarDate,day_type AS dayType,remark,status
      FROM attendance_project_calendar
      WHERE company_id=:companyId AND project_id=:projectId
        AND calendar_date>=:monthStart AND calendar_date<DATE_ADD(:monthStart,INTERVAL 1 MONTH)
      ORDER BY calendar_date`, { companyId, projectId: positiveId(projectId), monthStart: `${month}-01` });
  });
}

async function saveCalendarDay(companyId, user, operatorId, projectId, body = {}) {
  const calendarDate = String(body.calendarDate || '');
  const dayType = String(body.dayType || '');
  const remark = String(body.remark || '').trim().slice(0, 255) || null;
  if (!validDate(calendarDate) || !['WORKDAY', 'REST_DAY'].includes(dayType)) {
    throw createError('特殊日期参数无效', 400, 'INVALID_CALENDAR_DAY');
  }
  return db.transaction(async client => {
    await assertProject(client, companyId, user, projectId);
    const result = await query(client, `INSERT INTO attendance_project_calendar
      (company_id,project_id,calendar_date,day_type,remark,status,created_by,updated_by)
      VALUES (:companyId,:projectId,:calendarDate,:dayType,:remark,1,:operatorId,:operatorId)
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),day_type=VALUES(day_type),remark=VALUES(remark),
       status=1,updated_by=VALUES(updated_by)`, {
      companyId, projectId: positiveId(projectId), calendarDate, dayType, remark, operatorId: positiveId(operatorId)
    });
    const calendarId = Number(result.insertId);
    const summary = { projectId: positiveId(projectId), calendarDate, dayType };
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'项目考勤','attendance_project_calendar',:calendarId,'upsert',:afterData)`, {
      companyId, operatorId: positiveId(operatorId), calendarId, afterData: JSON.stringify(summary)
    });
    return summary;
  });
}

async function resolveProjectRule(client, companyId, projectId, shiftDate) {
  if (!positiveId(projectId) || !validDate(shiftDate)) throw createError('规则查询参数无效', 400, 'INVALID_PROJECT_RULE_QUERY');
  const rules = await query(client, `SELECT id,project_id AS projectId,rule_name AS ruleName,
      work_start_time AS workStartTime,work_end_time AS workEndTime,rest_start_time AS restStartTime,
      rest_end_time AS restEndTime,standard_minutes AS standardMinutes,late_grace_minutes AS lateGraceMinutes,
      early_grace_minutes AS earlyGraceMinutes,overtime_min_minutes AS overtimeMinMinutes,
      work_weekdays AS workWeekdays,effective_from AS effectiveFrom
    FROM attendance_project_rules
    WHERE company_id=:companyId AND project_id=:projectId AND status=1 AND effective_from<=:shiftDate
    ORDER BY effective_from DESC,id DESC LIMIT 1`, { companyId, projectId: positiveId(projectId), shiftDate });
  if (!rules[0]) return null;
  const calendar = await query(client, `SELECT day_type AS dayType FROM attendance_project_calendar
    WHERE company_id=:companyId AND project_id=:projectId AND calendar_date=:shiftDate AND status=1 LIMIT 1`, {
    companyId, projectId: positiveId(projectId), shiftDate
  });
  const workWeekdays = String(rules[0].workWeekdays).split(',').map(Number);
  const isoWeekday = new Date(`${shiftDate}T00:00:00Z`).getUTCDay() || 7;
  const scheduleStatus = calendar[0]
    ? (calendar[0].dayType === 'WORKDAY' ? 'WORK' : 'REST')
    : (workWeekdays.includes(isoWeekday) ? 'WORK' : 'REST');
  return { ...rules[0], workWeekdays, scheduleStatus };
}

module.exports = {
  listProjects,
  getProjectSettings,
  saveProjectSettings,
  listCalendar,
  saveCalendarDay,
  resolveProjectRule,
  validateRule,
  validateShiftRules,
  validateAllowances
};
