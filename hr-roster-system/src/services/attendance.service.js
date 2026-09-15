const database = require('../db');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');
const { calculateDailyAttendance } = require('./attendance-calculator.service');
const { evaluateGeofence } = require('./attendance-geofence.service');
const { assertEmployeeScope } = require('./employee.service');
const { resolveProjectRule } = require('./attendance-project.service');
async function query(client, sql, params) { const [rows] = await client.execute(sql, params); return rows; }

function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function shanghaiDateTime(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(value);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}.${String(value.getMilliseconds()).padStart(3, '0')}`;
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validMonth(value) {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(value || ''));
}

function isJobEffectiveOnDate(job, shiftDate) {
  if (!validDate(shiftDate) || !validDate(job?.hireDate) || job.hireDate > shiftDate) return false;
  if (validDate(job.nextHireDate) && shiftDate >= job.nextHireDate) return false;
  if (validDate(job.leaveDate) && job.leaveDate >= job.hireDate
    && (!validDate(job.nextHireDate) || job.leaveDate < job.nextHireDate)
    && shiftDate > job.leaveDate) return false;
  const deletedDate = String(job.deletedAt || '').slice(0, 10);
  if (validDate(deletedDate) && deletedDate <= shiftDate && job.hireDate <= deletedDate) return false;
  return true;
}

async function loadSchedule(client, companyId, employeeId, shiftDate) {
  return query(client, `SELECT s.id,s.project_id AS projectId,s.shift_date AS shiftDate,s.schedule_status AS scheduleStatus,
      s.shift_rule_id AS shiftRuleId,s.project_rule_id AS projectRuleId,
      COALESCE(sr.work_start_time,pr.work_start_time) AS workStartTime,
      COALESCE(sr.work_end_time,pr.work_end_time) AS workEndTime,
      COALESCE(sr.rest_start_time,pr.rest_start_time) AS restStartTime,
      COALESCE(sr.rest_end_time,pr.rest_end_time) AS restEndTime,
      COALESCE(sr.standard_minutes,pr.standard_minutes) AS standardMinutes,
      COALESCE(sr.late_grace_minutes,pr.late_grace_minutes) AS lateGraceMinutes,
      COALESCE(sr.early_grace_minutes,pr.early_grace_minutes) AS earlyGraceMinutes,
      COALESCE(sr.overtime_min_minutes,pr.overtime_min_minutes) AS overtimeMinMinutes
    FROM attendance_schedules s
    LEFT JOIN attendance_shift_rules sr ON sr.id=s.shift_rule_id AND sr.company_id=s.company_id
    LEFT JOIN attendance_project_rules pr ON pr.id=s.project_rule_id AND pr.company_id=s.company_id
    WHERE s.company_id=:companyId AND s.employee_id=:employeeId AND s.shift_date=:shiftDate`, { companyId, employeeId, shiftDate }).then(rows => rows[0] || null);
}

async function recalculateDaily(client, companyId, employeeId, shiftDate, schedule) {
  const punches = await query(client, `SELECT punch_type AS punchType, punch_time AS punchTime FROM attendance_punches
    WHERE company_id=:companyId AND employee_id=:employeeId AND shift_date=:shiftDate ORDER BY punch_time`, { companyId, employeeId, shiftDate });
  const result = calculateDailyAttendance({ schedule, punches });
  await query(client, `INSERT INTO attendance_daily_results
    (company_id, employee_id, project_id, shift_date, schedule_id, first_in_at, last_out_at, worked_minutes, approved_normal_minutes,
     overtime_candidate_minutes, approved_overtime_minutes, late_minutes, early_leave_minutes, result_status, review_status, calculation_version, calculated_at)
    VALUES (:companyId,:employeeId,:projectId,:shiftDate,:scheduleId,:firstInAt,:lastOutAt,:workedMinutes,:approvedNormalMinutes,
      :overtimeCandidateMinutes,0,:lateMinutes,:earlyLeaveMinutes,:resultStatus,'NONE','v1',CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE project_id=COALESCE(project_id,VALUES(project_id)),schedule_id=VALUES(schedule_id), first_in_at=VALUES(first_in_at), last_out_at=VALUES(last_out_at),
      worked_minutes=VALUES(worked_minutes), approved_normal_minutes=VALUES(approved_normal_minutes), overtime_candidate_minutes=VALUES(overtime_candidate_minutes),
      late_minutes=VALUES(late_minutes), early_leave_minutes=VALUES(early_leave_minutes), result_status=VALUES(result_status), calculated_at=CURRENT_TIMESTAMP`,
  { companyId, employeeId, projectId: schedule?.projectId || null, shiftDate, scheduleId: schedule?.id || null, ...result });
  return result;
}

async function evaluateEmployeeLocation(client, companyId, employeeId, projectId, location) {
  if (!Number(projectId)) return { geofenceId: null, status: 'NO_FENCE', distanceMeters: null, radiusSnapshot: null, reason: '' };
  const fences = await query(client, `SELECT g.id, g.latitude, g.longitude, g.radius_meters AS radiusMeters,
      g.max_accuracy_meters AS maxAccuracyMeters
    FROM attendance_project_geofence pg
    JOIN attendance_geofences g ON g.id=pg.geofence_id AND g.company_id=pg.company_id AND g.status=1
    WHERE pg.company_id=:companyId AND pg.project_id=:projectId AND pg.status=1 ORDER BY g.id`, { companyId, employeeId, projectId: Number(projectId) });
  if (!fences.length) return { geofenceId: null, status: 'NO_FENCE', distanceMeters: null, radiusSnapshot: null, reason: '' };
  const evaluations = fences.map(geofence => ({ geofence, ...evaluateGeofence(location || { failed: true, reason: '未提供定位' }, geofence) }));
  const selected = evaluations.find(item => item.status === 'INSIDE')
    || evaluations.find(item => item.status === 'LOW_ACCURACY')
    || evaluations.find(item => item.status === 'LOCATION_FAILED')
    || evaluations.reduce((nearest, item) => nearest === null || item.distanceMeters < nearest.distanceMeters ? item : nearest, null);
  return { geofenceId: selected.geofence.id, status: selected.status, distanceMeters: selected.distanceMeters, radiusSnapshot: Number(selected.geofence.radiusMeters), reason: selected.reason };
}

async function punchEmployee(companyId, employeeId, body = {}) {
  if (!['IN', 'OUT'].includes(body.punchType)) throw createError('打卡类型无效', 400, 'INVALID_PUNCH_TYPE');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(body.clientRequestId || ''))) throw createError('缺少有效的请求编号', 400, 'INVALID_REQUEST_ID');
  return database.transaction(async client => {
    const employee = await query(client, 'SELECT id FROM hr_employee WHERE id=:employeeId AND company_id=:companyId AND employee_status IN (1,2) LIMIT 1', { companyId, employeeId });
    if (!employee[0]) throw createError('员工不存在或已离职', 403, 'EMPLOYEE_INACTIVE');
    const shiftDate = shanghaiDate();
    const schedule = await loadSchedule(client, companyId, employeeId, shiftDate);
    if (!schedule) throw createError('今日暂无排班，请联系 HR', 400, 'NO_SCHEDULE');
    const existing = await query(client, 'SELECT id, punch_type AS punchType, punch_time AS punchTime FROM attendance_punches WHERE company_id=:companyId AND employee_id=:employeeId AND client_request_id=:clientRequestId LIMIT 1', { companyId, employeeId, clientRequestId: body.clientRequestId });
    if (existing[0]) return { punchId: existing[0].id, punchType: existing[0].punchType, punchTime: existing[0].punchTime, shiftDate, duplicate: true };
    let projectId = Number(schedule.projectId || 0) || null;
    if (!projectId) {
      const jobs = await query(client, `SELECT project_id AS projectId FROM hr_employee_job
        WHERE company_id=:companyId AND employee_id=:employeeId AND job_status=1 AND project_id IS NOT NULL
          AND (hire_date IS NULL OR hire_date<=:shiftDate)
        ORDER BY hire_date DESC,updated_at DESC,id DESC LIMIT 1`, { companyId, employeeId, shiftDate });
      projectId = Number(jobs[0]?.projectId || 0) || null;
      if (projectId) {
        await query(client, `UPDATE attendance_schedules SET project_id=:projectId,updated_at=CURRENT_TIMESTAMP
          WHERE id=:scheduleId AND company_id=:companyId AND project_id IS NULL`, { projectId, scheduleId: schedule.id, companyId });
        schedule.projectId = projectId;
      }
    }
    const fence = await evaluateEmployeeLocation(client, companyId, employeeId, projectId, body.location);
    const location = body.location && !body.location.failed ? body.location : {};
    const inserted = await query(client, `INSERT INTO attendance_punches (company_id,employee_id,project_id,shift_date,punch_type,punch_time,source,geofence_id,latitude,longitude,location_accuracy,distance_meters,geofence_radius_snapshot,geofence_status,location_reason,client_request_id)
      VALUES (:companyId,:employeeId,:projectId,:shiftDate,:punchType,:punchTime,:source,:geofenceId,:latitude,:longitude,:accuracy,:distanceMeters,:radiusSnapshot,:geofenceStatus,:locationReason,:clientRequestId)`, { companyId, employeeId, projectId, shiftDate, punchType: body.punchType, punchTime: shanghaiDateTime(), source: body.source === 'WEB' ? 'WEB' : 'WECHAT', clientRequestId: body.clientRequestId, geofenceId: fence.geofenceId, latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null, longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null, accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null, distanceMeters: fence.distanceMeters, radiusSnapshot: fence.radiusSnapshot, geofenceStatus: fence.status, locationReason: fence.reason || null });
    if (['OUTSIDE', 'LOW_ACCURACY', 'LOCATION_FAILED'].includes(fence.status)) {
      await query(client, `INSERT INTO attendance_correction_requests (company_id,employee_id,shift_date,request_type,punch_id,reason,status,submitted_by_employee_id)
        VALUES (:companyId,:employeeId,:shiftDate,'GEOFENCE_EXCEPTION',:punchId,:reason,'PENDING',:employeeId)`, { companyId, employeeId, shiftDate, punchId: inserted.insertId, reason: `电子围栏异常：${fence.status}${fence.reason ? `，${fence.reason}` : ''}` });
    }
    const result = await recalculateDaily(client, companyId, employeeId, shiftDate, schedule);
    return { punchId: inserted.insertId, punchType: body.punchType, shiftDate, dailyStatus: result.resultStatus, geofenceStatus: fence.status, distanceMeters: fence.distanceMeters };
  });
}

async function createCorrection(companyId, employeeId, body = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.shiftDate || '')) || !body.reason || !['MISSING_IN', 'MISSING_OUT', 'TIME_CORRECTION', 'OVERTIME'].includes(body.requestType)) throw createError('补卡申请信息不完整', 400, 'INVALID_CORRECTION');
  const result = await database.query(`INSERT INTO attendance_correction_requests (company_id,employee_id,shift_date,request_type,requested_time,reason,submitted_by_employee_id)
    VALUES (:companyId,:employeeId,:shiftDate,:requestType,:requestedTime,:reason,:employeeId)`, { companyId, employeeId, shiftDate: body.shiftDate, requestType: body.requestType, requestedTime: body.requestedTime || null, reason: String(body.reason).slice(0, 500) });
  return { id: result.insertId, status: 'PENDING' };
}

async function listCorrections(companyId, user, params = {}) {
  const projectId = requiredProjectId(params.projectId);
  await assertProjectAccess(database, companyId, user, projectId);
  const queryParams = { companyId, projectId, status: params.status || 'PENDING' };
  return database.query(`SELECT c.id,c.employee_id AS employeeId,e.name,c.shift_date AS shiftDate,c.request_type AS requestType,
    c.reason,c.status,c.created_at AS createdAt,
    p.geofence_status AS geofenceStatus,p.distance_meters AS distanceMeters
    FROM attendance_correction_requests c JOIN hr_employee e ON e.id=c.employee_id AND e.company_id=c.company_id
    LEFT JOIN attendance_punches p ON c.punch_id=p.id AND p.company_id=c.company_id
    LEFT JOIN attendance_daily_results d ON d.company_id=c.company_id AND d.employee_id=c.employee_id AND d.shift_date=c.shift_date
    WHERE c.company_id=:companyId AND c.status=:status AND COALESCE(p.project_id,d.project_id)=:projectId
    ORDER BY c.created_at DESC`, queryParams);
}

async function reviewCorrection(companyId, user, id, body = {}) {
  if (!['APPROVE', 'REJECT'].includes(body.action)) throw createError('审核动作无效', 400, 'INVALID_REVIEW_ACTION');
  return database.transaction(async client => {
    const rows = await query(client, `SELECT c.*,COALESCE(p.project_id,d.project_id) AS projectId
      FROM attendance_correction_requests c
      LEFT JOIN attendance_punches p ON p.id=c.punch_id AND p.company_id=c.company_id
      LEFT JOIN attendance_daily_results d ON d.company_id=c.company_id AND d.employee_id=c.employee_id AND d.shift_date=c.shift_date
      WHERE c.id=:id AND c.company_id=:companyId AND c.status='PENDING' FOR UPDATE`, { id, companyId });
    if (!rows[0]) throw createError('补卡申请不存在或已处理', 404, 'CORRECTION_NOT_FOUND');
    const request = rows[0];
    if (!request.projectId) throw createError('历史项目归属待核查', 409, 'PROJECT_HISTORY_UNRESOLVED');
    await assertProjectAccess(client, companyId, user, Number(request.projectId));
    const status = body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await query(client, 'UPDATE attendance_correction_requests SET status=:status, reviewed_by=:reviewedBy, review_comment=:comment, reviewed_at=CURRENT_TIMESTAMP WHERE id=:id AND company_id=:companyId', { status, reviewedBy: user.id, comment: String(body.reviewComment || '').slice(0, 500), id, companyId });
    if (status === 'APPROVED' && request.requested_time) {
      const type = request.request_type === 'MISSING_OUT' ? 'OUT' : 'IN';
      await query(client, `INSERT IGNORE INTO attendance_punches (company_id,employee_id,project_id,shift_date,punch_type,punch_time,source,client_request_id)
        VALUES (:companyId,:employeeId,:projectId,:shiftDate,:punchType,:requestedTime,'MANUAL_APPROVED',:requestId)`, { companyId, employeeId: request.employee_id, projectId: request.projectId || null, shiftDate: request.shift_date, punchType: type, requestedTime: request.requested_time, requestId: `correction-${id}` });
      const schedule = await loadSchedule(client, companyId, request.employee_id, request.shift_date);
      if (schedule) await recalculateDaily(client, companyId, request.employee_id, request.shift_date, schedule);
    }
    return { id, status };
  });
}

function monthRange(month) {
  if (!validMonth(month)) throw createError('月份格式应为 YYYY-MM', 400, 'INVALID_MONTH');
  return { start: `${month}-01`, end: `${month}-31` };
}

async function getEmployeeMonth(companyId, employeeId, month) {
  monthRange(month);
  const rows = await database.query(`SELECT shift_date AS shiftDate, first_in_at AS firstInAt, last_out_at AS lastOutAt,
      worked_minutes AS workedMinutes, approved_normal_minutes AS approvedNormalMinutes,
      overtime_candidate_minutes AS overtimeCandidateMinutes, approved_overtime_minutes AS approvedOvertimeMinutes,
      late_minutes AS lateMinutes, early_leave_minutes AS earlyLeaveMinutes, result_status AS resultStatus, review_status AS reviewStatus
    FROM attendance_daily_results WHERE company_id=:companyId AND employee_id=:employeeId
      AND DATE_FORMAT(shift_date, '%Y-%m')=:month ORDER BY shift_date`, { companyId, employeeId, month });
  const summary = rows.reduce((acc, row) => {
    acc.workedMinutes += Number(row.workedMinutes || 0); acc.approvedNormalMinutes += Number(row.approvedNormalMinutes || 0);
    acc.approvedOvertimeMinutes += Number(row.approvedOvertimeMinutes || 0); return acc;
  }, { workedMinutes: 0, approvedNormalMinutes: 0, approvedOvertimeMinutes: 0 });
  return { month, list: rows, summary };
}
async function getEmployeeToday(companyId, employeeId) {
  const date = shanghaiDate();
  const rows = await database.query(`SELECT d.shift_date AS shiftDate, d.first_in_at AS firstInAt, d.last_out_at AS lastOutAt,
    worked_minutes AS workedMinutes, approved_normal_minutes AS approvedNormalMinutes, overtime_candidate_minutes AS overtimeCandidateMinutes,
    result_status AS resultStatus, review_status AS reviewStatus,
    (SELECT p.geofence_status FROM attendance_punches p WHERE p.company_id=d.company_id AND p.employee_id=d.employee_id AND p.shift_date=d.shift_date ORDER BY p.punch_time DESC LIMIT 1) AS geofenceStatus,
    (SELECT p.distance_meters FROM attendance_punches p WHERE p.company_id=d.company_id AND p.employee_id=d.employee_id AND p.shift_date=d.shift_date ORDER BY p.punch_time DESC LIMIT 1) AS distanceMeters
    FROM attendance_daily_results d WHERE d.company_id=:companyId AND d.employee_id=:employeeId AND d.shift_date=:date LIMIT 1`, { companyId, employeeId, date });
  return rows[0] || { shiftDate: date, resultStatus: 'NOT_CALCULATED', workedMinutes: 0 };
}

async function listDaily(companyId, user, params = {}) {
  const date = params.date || shanghaiDate();
  if (!validDate(date)) throw createError('日期格式应为 YYYY-MM-DD', 400, 'INVALID_DATE');
  const projectId = requiredProjectId(params.projectId);
  const queryParams = { companyId, projectId, date };
  const project = await assertProjectAccess(database, companyId, user, projectId);
  await ensureProjectSchedules(companyId, user, projectId, date);
  const list = await database.query(`SELECT d.id, d.employee_id AS employeeId, e.name, d.shift_date AS shiftDate,
      d.first_in_at AS firstInAt, d.last_out_at AS lastOutAt, d.worked_minutes AS workedMinutes,
      d.approved_normal_minutes AS approvedNormalMinutes, d.approved_overtime_minutes AS approvedOvertimeMinutes,
      d.late_minutes AS lateMinutes, d.early_leave_minutes AS earlyLeaveMinutes, d.result_status AS resultStatus, d.review_status AS reviewStatus,
      (SELECT p.geofence_status FROM attendance_punches p WHERE p.company_id=d.company_id AND p.project_id=d.project_id AND p.employee_id=d.employee_id AND p.shift_date=d.shift_date ORDER BY p.punch_time DESC LIMIT 1) AS geofenceStatus,
      (SELECT p.distance_meters FROM attendance_punches p WHERE p.company_id=d.company_id AND p.project_id=d.project_id AND p.employee_id=d.employee_id AND p.shift_date=d.shift_date ORDER BY p.punch_time DESC LIMIT 1) AS distanceMeters
    FROM attendance_daily_results d JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
    WHERE d.company_id=:companyId AND d.project_id=:projectId AND d.shift_date=:date ORDER BY e.name`, queryParams);
  const unresolved = await unresolvedHistoryCount(companyId, { date: queryParams.date });
  const summary = list.reduce((value, row) => {
    if (row.resultStatus === 'REST') return value;
    value.scheduled += 1;
    if (row.resultStatus === 'NORMAL') value.normal += 1;
    if (Number(row.lateMinutes || 0) > 0 || row.resultStatus === 'LATE') value.late += 1;
    if (Number(row.earlyLeaveMinutes || 0) > 0 || row.resultStatus === 'EARLY_LEAVE') value.earlyLeave += 1;
    if (row.resultStatus === 'MISSING_PUNCH') value.missingPunch += 1;
    if (row.resultStatus === 'ABSENT') value.absent += 1;
    if (['OUTSIDE', 'LOW_ACCURACY', 'LOCATION_FAILED'].includes(row.geofenceStatus)) value.geofenceException += 1;
    return value;
  }, { scheduled: 0, normal: 0, late: 0, earlyLeave: 0, missingPunch: 0, absent: 0, geofenceException: 0 });
  return { project, summary, list, unresolvedHistoryCount: unresolved };
}

async function listMonthly(companyId, user, params = {}) {
  monthRange(params.month);
  const projectId = requiredProjectId(params.projectId);
  const queryParams = { companyId, projectId, month: params.month };
  const project = await assertProjectAccess(database, companyId, user, projectId);
  const dates = monthDatesThroughToday(params.month);
  if (dates.length) {
    await database.transaction(async client => {
      await assertProjectAccess(client, companyId, user, projectId);
      for (const date of dates) await generateProjectSchedules(client, companyId, user, projectId, date);
    });
  }
  const list = await database.query(`SELECT d.employee_id AS employeeId, e.name,SUM(d.result_status<>'REST') AS scheduledDays,
      SUM(d.first_in_at IS NOT NULL OR d.last_out_at IS NOT NULL) AS attendanceDays,
      SUM(d.approved_normal_minutes) AS approvedNormalMinutes, SUM(d.approved_overtime_minutes) AS approvedOvertimeMinutes,
      SUM(d.late_minutes) AS lateMinutes, SUM(d.early_leave_minutes) AS earlyLeaveMinutes,
      SUM(d.result_status='MISSING_PUNCH') AS missingPunchDays, SUM(d.result_status='ABSENT') AS absentDays,
      (SELECT COUNT(*) FROM attendance_punches p WHERE p.company_id=d.company_id AND p.project_id=d.project_id
        AND p.employee_id=d.employee_id AND DATE_FORMAT(p.shift_date,'%Y-%m')=:month
        AND p.geofence_status IN ('OUTSIDE','LOW_ACCURACY','LOCATION_FAILED')) AS geofenceExceptionCount
    FROM attendance_daily_results d JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
    WHERE d.company_id=:companyId AND d.project_id=:projectId AND DATE_FORMAT(d.shift_date, '%Y-%m')=:month
    GROUP BY d.employee_id,e.name,d.company_id,d.project_id ORDER BY e.name`, queryParams);
  const unresolved = await unresolvedHistoryCount(companyId, { month: params.month });
  const summary = list.reduce((value, row) => {
    value.approvedNormalMinutes += Number(row.approvedNormalMinutes || 0);
    value.approvedOvertimeMinutes += Number(row.approvedOvertimeMinutes || 0);
    return value;
  }, { employeeCount: list.length, approvedNormalMinutes: 0, approvedOvertimeMinutes: 0 });
  return { project, summary, list, unresolvedHistoryCount: unresolved };
}

function requiredProjectId(value) {
  const projectId = Number(value);
  if (!Number.isInteger(projectId) || projectId <= 0) throw createError('请选择项目', 400, 'PROJECT_REQUIRED');
  return projectId;
}

async function assertProjectAccess(client, companyId, user, projectId) {
  const params = { companyId, projectId };
  const scope = projectScope(user, params, 'p');
  const sql = `SELECT p.id AS projectId,p.project_name AS projectName,p.customer_id AS customerId
    FROM labor_project p WHERE p.company_id=:companyId AND p.id=:projectId ${scope} LIMIT 1`;
  const rows = client === database ? await database.query(sql, params) : await query(client, sql, params);
  if (!rows[0]) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
  return rows[0];
}

async function unresolvedHistoryCount(companyId, filter) {
  const params = { companyId, ...filter };
  const dateFilter = filter.date ? 'shift_date=:date' : "DATE_FORMAT(shift_date,'%Y-%m')=:month";
  const rows = await database.query(`SELECT COUNT(*) AS unresolvedHistoryCount FROM attendance_daily_results
    WHERE company_id=:companyId AND project_id IS NULL AND ${dateFilter}`, params);
  return Number(rows[0]?.unresolvedHistoryCount || 0);
}

async function ensureProjectSchedules(companyId, user, projectIdValue, shiftDate) {
  const projectId = requiredProjectId(projectIdValue);
  if (!validDate(shiftDate)) throw createError('日期格式应为 YYYY-MM-DD', 400, 'INVALID_DATE');
  return database.transaction(async client => {
    await assertProjectAccess(client, companyId, user, projectId);
    return generateProjectSchedules(client, companyId, user, projectId, shiftDate);
  });
}

function monthDatesThroughToday(month) {
  if (!validMonth(month)) return [];
  const today = shanghaiDate();
  const first = `${month}-01`;
  if (first > today) return [];
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const endDay = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : lastDay;
  return Array.from({ length: endDay }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

async function generateProjectSchedules(client, companyId, user, projectId, shiftDate) {
  const jobRows = await query(client, `SELECT j.employee_id AS employeeId,j.hire_date AS hireDate,e.deleted_at AS deletedAt,
      (SELECT MIN(next_job.hire_date) FROM hr_employee_job next_job
        WHERE next_job.company_id=j.company_id AND next_job.employee_id=j.employee_id
          AND next_job.hire_date>j.hire_date) AS nextHireDate,
      (SELECT MIN(resignation.leave_date) FROM hr_resignation resignation
        WHERE resignation.company_id=j.company_id AND resignation.employee_id=j.employee_id
          AND resignation.leave_date>=j.hire_date
          AND resignation.leave_date<(SELECT COALESCE(MIN(next_job.hire_date),'9999-12-31') FROM hr_employee_job next_job
            WHERE next_job.company_id=j.company_id AND next_job.employee_id=j.employee_id
              AND next_job.hire_date>j.hire_date)) AS leaveDate
      FROM hr_employee_job j
      JOIN hr_employee e ON e.id=j.employee_id AND e.company_id=j.company_id
      WHERE j.company_id=:companyId AND j.project_id=:projectId AND j.hire_date IS NOT NULL AND j.hire_date<=:shiftDate
        AND NOT EXISTS (SELECT 1 FROM hr_employee_job newer_j WHERE newer_j.company_id=j.company_id
          AND newer_j.employee_id=j.employee_id AND newer_j.hire_date IS NOT NULL
          AND newer_j.hire_date<=:shiftDate AND (newer_j.hire_date>j.hire_date OR (newer_j.hire_date=j.hire_date AND newer_j.id>j.id)))`,
  { companyId, projectId, shiftDate });
  const employees = jobRows.filter(job => isJobEffectiveOnDate(job, shiftDate));
  const rule = await resolveProjectRule(client, companyId, projectId, shiftDate);
  if (!rule) return { projectId, shiftDate, generated: 0, status: 'NO_PROJECT_RULE' };
  for (const employee of employees) {
    await query(client, `INSERT INTO attendance_schedules
      (company_id,employee_id,project_id,shift_date,project_rule_id,shift_rule_id,schedule_status,created_by)
      VALUES (:companyId,:employeeId,:projectId,:shiftDate,:projectRuleId,NULL,:scheduleStatus,:operatorId)
      ON DUPLICATE KEY UPDATE project_id=COALESCE(project_id,VALUES(project_id)),updated_at=CURRENT_TIMESTAMP`, {
      companyId, employeeId: employee.employeeId, projectId, shiftDate, projectRuleId: rule.id,
      scheduleStatus: rule.scheduleStatus, operatorId: Number(user.id || 0)
    });
    if (shiftDate <= shanghaiDate()) {
      const schedule = await loadSchedule(client, companyId, employee.employeeId, shiftDate);
      if (schedule) await recalculateDaily(client, companyId, employee.employeeId, shiftDate, schedule);
    }
  }
  return { projectId, shiftDate, generated: employees.length, status: rule.scheduleStatus };
}

function validateShiftRule(body = {}) {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
  const integers = ['standardMinutes', 'lateGraceMinutes', 'earlyGraceMinutes', 'overtimeMinMinutes'];
  const values = {
    standardMinutes: body.standardMinutes == null || body.standardMinutes === '' ? 480 : Number(body.standardMinutes),
    lateGraceMinutes: body.lateGraceMinutes == null || body.lateGraceMinutes === '' ? 0 : Number(body.lateGraceMinutes),
    earlyGraceMinutes: body.earlyGraceMinutes == null || body.earlyGraceMinutes === '' ? 0 : Number(body.earlyGraceMinutes),
    overtimeMinMinutes: body.overtimeMinMinutes == null || body.overtimeMinMinutes === '' ? 30 : Number(body.overtimeMinMinutes)
  };
  const restTimesValid = (!body.restStartTime && !body.restEndTime)
    || (timePattern.test(String(body.restStartTime)) && timePattern.test(String(body.restEndTime)));
  if (!String(body.ruleName || '').trim() || !timePattern.test(String(body.workStartTime || ''))
    || !timePattern.test(String(body.workEndTime || '')) || !restTimesValid
    || integers.some(key => !Number.isInteger(values[key]) || values[key] < 0 || values[key] > 1440)
    || values.standardMinutes === 0) throw createError('班次参数无效', 400, 'INVALID_SHIFT_RULE');
  return values;
}

async function createShiftRule(companyId, operatorId, body = {}) {
  const values = validateShiftRule(body);
  const result = await database.query(`INSERT INTO attendance_shift_rules (company_id,rule_name,work_start_time,work_end_time,rest_start_time,rest_end_time,standard_minutes,late_grace_minutes,early_grace_minutes,overtime_min_minutes,created_by)
    VALUES (:companyId,:ruleName,:workStartTime,:workEndTime,:restStartTime,:restEndTime,:standardMinutes,:lateGraceMinutes,:earlyGraceMinutes,:overtimeMinMinutes,:operatorId)`, { companyId, operatorId, ruleName: String(body.ruleName).trim().slice(0, 100), workStartTime: body.workStartTime, workEndTime: body.workEndTime, restStartTime: body.restStartTime || null, restEndTime: body.restEndTime || null, ...values });
  return { id: result.insertId, ruleName: body.ruleName };
}

async function upsertSchedule(companyId, user, operatorId, body = {}) {
  if (!Number(body.employeeId) || !Number(body.shiftRuleId) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.shiftDate || ''))) throw createError('排班信息不完整', 400, 'INVALID_SCHEDULE');
  await database.transaction(async client => {
    await assertEmployeeScope(companyId, Number(body.employeeId), user, client);
    const rules = await query(client, 'SELECT id FROM attendance_shift_rules WHERE id=:shiftRuleId AND company_id=:companyId AND status=1 LIMIT 1', { companyId, shiftRuleId: Number(body.shiftRuleId) });
    if (!rules[0]) throw createError('班次不存在或已停用', 404, 'SHIFT_RULE_NOT_FOUND');
    await query(client, `INSERT INTO attendance_schedules (company_id,employee_id,shift_date,shift_rule_id,schedule_status,created_by)
      VALUES (:companyId,:employeeId,:shiftDate,:shiftRuleId,:scheduleStatus,:operatorId)
      ON DUPLICATE KEY UPDATE shift_rule_id=VALUES(shift_rule_id),project_rule_id=NULL,schedule_status=VALUES(schedule_status),updated_at=CURRENT_TIMESTAMP`, { companyId, operatorId, employeeId: Number(body.employeeId), shiftDate: body.shiftDate, shiftRuleId: Number(body.shiftRuleId), scheduleStatus: body.scheduleStatus === 'REST' ? 'REST' : 'WORK' });
  });
  return { employeeId: Number(body.employeeId), shiftDate: body.shiftDate, shiftRuleId: Number(body.shiftRuleId), scheduleStatus: body.scheduleStatus === 'REST' ? 'REST' : 'WORK' };
}

async function attendanceSummaryForPayroll(companyId, user, params = {}) {
  if (params.projectId) {
    const report = await listMonthly(companyId, user, params);
    return { month: params.month, list: report.list.map(row => ({ employeeId: row.employeeId, name: row.name, normalMinutes: Number(row.approvedNormalMinutes || 0), overtimeMinutes: Number(row.approvedOvertimeMinutes || 0) })) };
  }
  monthRange(params.month);
  const queryParams = { companyId, month: params.month };
  const scope = projectScope(user, queryParams, 'history_project');
  const rows = await database.query(`SELECT d.employee_id AS employeeId,e.name,
      SUM(d.approved_normal_minutes) AS approvedNormalMinutes,SUM(d.approved_overtime_minutes) AS approvedOvertimeMinutes
    FROM attendance_daily_results d JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
    LEFT JOIN labor_project history_project ON history_project.id=d.project_id AND history_project.company_id=d.company_id
    WHERE d.company_id=:companyId AND DATE_FORMAT(d.shift_date,'%Y-%m')=:month ${scope}
    GROUP BY d.employee_id,e.name ORDER BY e.name`, queryParams);
  return { month: params.month, list: rows.map(row => ({ employeeId: row.employeeId, name: row.name, normalMinutes: Number(row.approvedNormalMinutes || 0), overtimeMinutes: Number(row.approvedOvertimeMinutes || 0) })) };
}

module.exports = { getEmployeeToday, getEmployeeMonth, listDaily, listMonthly, monthRange, punchEmployee, evaluateEmployeeLocation, createCorrection, listCorrections, reviewCorrection, validateShiftRule, createShiftRule, upsertSchedule, attendanceSummaryForPayroll, ensureProjectSchedules, loadSchedule, recalculateDaily, validDate, validMonth, isJobEffectiveOnDate, monthDatesThroughToday };
