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
    return {
      project: { projectId: project.id, projectName: project.projectName, customerId: project.customerId },
      rules: rules.map(rule => ({ ...rule, workWeekdays: String(rule.workWeekdays).split(',').map(Number) })),
      geofenceIds: geofences.map(item => Number(item.geofenceId))
    };
  });
}

async function saveProjectSettings(companyId, user, operatorId, projectId, body = {}) {
  const values = validateRule(body);
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
    if (Array.isArray(body.geofenceIds)) {
      const association = await replaceProjectGeofences(client, companyId, user, operatorId, projectId, body.geofenceIds);
      summary.geofenceIds = association.geofenceIds;
    }
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'项目考勤','attendance_project_rule',:ruleId,'upsert',:afterData)`, {
      companyId, operatorId: positiveId(operatorId), ruleId, afterData: JSON.stringify(summary)
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
  validateRule
};
