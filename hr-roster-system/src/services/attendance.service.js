const database = require('../db');
const { createError } = require('../utils/response');
const { employeeScope } = require('../utils/data-scope');
const { calculateDailyAttendance } = require('./attendance-calculator.service');
async function query(client, sql, params) { const [rows] = await client.execute(sql, params); return rows; }

function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

async function loadSchedule(client, companyId, employeeId, shiftDate) {
  return query(client, `SELECT s.id, s.shift_date AS shiftDate, s.schedule_status AS scheduleStatus,
      r.work_start_time AS workStartTime, r.work_end_time AS workEndTime, r.rest_start_time AS restStartTime,
      r.rest_end_time AS restEndTime, r.standard_minutes AS standardMinutes, r.late_grace_minutes AS lateGraceMinutes,
      r.early_grace_minutes AS earlyGraceMinutes, r.overtime_min_minutes AS overtimeMinMinutes
    FROM attendance_schedules s JOIN attendance_shift_rules r ON r.id=s.shift_rule_id AND r.company_id=s.company_id
    WHERE s.company_id=:companyId AND s.employee_id=:employeeId AND s.shift_date=:shiftDate`, { companyId, employeeId, shiftDate }).then(rows => rows[0] || null);
}

async function recalculateDaily(client, companyId, employeeId, shiftDate, schedule) {
  const punches = await query(client, `SELECT punch_type AS punchType, punch_time AS punchTime FROM attendance_punches
    WHERE company_id=:companyId AND employee_id=:employeeId AND shift_date=:shiftDate ORDER BY punch_time`, { companyId, employeeId, shiftDate });
  const result = calculateDailyAttendance({ schedule, punches });
  await query(client, `INSERT INTO attendance_daily_results
    (company_id, employee_id, shift_date, schedule_id, first_in_at, last_out_at, worked_minutes, approved_normal_minutes,
     overtime_candidate_minutes, approved_overtime_minutes, late_minutes, early_leave_minutes, result_status, review_status, calculation_version, calculated_at)
    VALUES (:companyId,:employeeId,:shiftDate,:scheduleId,:firstInAt,:lastOutAt,:workedMinutes,:approvedNormalMinutes,
      :overtimeCandidateMinutes,0,:lateMinutes,:earlyLeaveMinutes,:resultStatus,'NONE','v1',CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE schedule_id=VALUES(schedule_id), first_in_at=VALUES(first_in_at), last_out_at=VALUES(last_out_at),
      worked_minutes=VALUES(worked_minutes), approved_normal_minutes=VALUES(approved_normal_minutes), overtime_candidate_minutes=VALUES(overtime_candidate_minutes),
      late_minutes=VALUES(late_minutes), early_leave_minutes=VALUES(early_leave_minutes), result_status=VALUES(result_status), calculated_at=CURRENT_TIMESTAMP`,
  { companyId, employeeId, shiftDate, scheduleId: schedule?.id || null, ...result });
  return result;
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
    const inserted = await query(client, `INSERT INTO attendance_punches (company_id,employee_id,shift_date,punch_type,punch_time,source,client_request_id)
      VALUES (:companyId,:employeeId,:shiftDate,:punchType,CURRENT_TIMESTAMP(3),:source,:clientRequestId)`, { companyId, employeeId, shiftDate, punchType: body.punchType, source: body.source === 'WEB' ? 'WEB' : 'WECHAT', clientRequestId: body.clientRequestId });
    const result = await recalculateDaily(client, companyId, employeeId, shiftDate, schedule);
    return { punchId: inserted.insertId, punchType: body.punchType, shiftDate, dailyStatus: result.resultStatus };
  });
}

async function createCorrection(companyId, employeeId, body = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.shiftDate || '')) || !body.reason || !['MISSING_IN', 'MISSING_OUT', 'TIME_CORRECTION', 'OVERTIME'].includes(body.requestType)) throw createError('补卡申请信息不完整', 400, 'INVALID_CORRECTION');
  const result = await database.query(`INSERT INTO attendance_correction_requests (company_id,employee_id,shift_date,request_type,requested_time,reason,submitted_by_employee_id)
    VALUES (:companyId,:employeeId,:shiftDate,:requestType,:requestedTime,:reason,:employeeId)`, { companyId, employeeId, shiftDate: body.shiftDate, requestType: body.requestType, requestedTime: body.requestedTime || null, reason: String(body.reason).slice(0, 500) });
  return { id: result.insertId, status: 'PENDING' };
}

async function reviewCorrection(companyId, user, id, body = {}) {
  if (!['APPROVE', 'REJECT'].includes(body.action)) throw createError('审核动作无效', 400, 'INVALID_REVIEW_ACTION');
  return database.transaction(async client => {
    const rows = await query(client, 'SELECT * FROM attendance_correction_requests WHERE id=:id AND company_id=:companyId AND status=\'PENDING\' FOR UPDATE', { id, companyId });
    if (!rows[0]) throw createError('补卡申请不存在或已处理', 404, 'CORRECTION_NOT_FOUND');
    const request = rows[0];
    const status = body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await query(client, 'UPDATE attendance_correction_requests SET status=:status, reviewed_by=:reviewedBy, review_comment=:comment, reviewed_at=CURRENT_TIMESTAMP WHERE id=:id AND company_id=:companyId', { status, reviewedBy: user.id, comment: String(body.reviewComment || '').slice(0, 500), id, companyId });
    if (status === 'APPROVED' && request.requested_time) {
      const type = request.request_type === 'MISSING_OUT' ? 'OUT' : 'IN';
      await query(client, `INSERT IGNORE INTO attendance_punches (company_id,employee_id,shift_date,punch_type,punch_time,source,client_request_id)
        VALUES (:companyId,:employeeId,:shiftDate,:punchType,:requestedTime,'MANUAL_APPROVED',:requestId)`, { companyId, employeeId: request.employee_id, shiftDate: request.shift_date, punchType: type, requestedTime: request.requested_time, requestId: `correction-${id}` });
      const schedule = await loadSchedule(client, companyId, request.employee_id, request.shift_date);
      if (schedule) await recalculateDaily(client, companyId, request.employee_id, request.shift_date, schedule);
    }
    return { id, status };
  });
}

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw createError('月份格式应为 YYYY-MM', 400, 'INVALID_MONTH');
  return { start: `${month}-01`, end: `${month}-31` };
}

async function getEmployeeMonth(companyId, employeeId, month) {
  const range = monthRange(month);
  const rows = await database.query(`SELECT shift_date AS shiftDate, first_in_at AS firstInAt, last_out_at AS lastOutAt,
      worked_minutes AS workedMinutes, approved_normal_minutes AS approvedNormalMinutes,
      overtime_candidate_minutes AS overtimeCandidateMinutes, approved_overtime_minutes AS approvedOvertimeMinutes,
      late_minutes AS lateMinutes, early_leave_minutes AS earlyLeaveMinutes, result_status AS resultStatus, review_status AS reviewStatus
    FROM attendance_daily_results WHERE company_id=:companyId AND employee_id=:employeeId
      AND shift_date BETWEEN :start AND :end ORDER BY shift_date`, { companyId, employeeId, ...range });
  const summary = rows.reduce((acc, row) => {
    acc.workedMinutes += Number(row.workedMinutes || 0); acc.approvedNormalMinutes += Number(row.approvedNormalMinutes || 0);
    acc.approvedOvertimeMinutes += Number(row.approvedOvertimeMinutes || 0); return acc;
  }, { workedMinutes: 0, approvedNormalMinutes: 0, approvedOvertimeMinutes: 0 });
  return { month, list: rows, summary };
}
async function getEmployeeToday(companyId, employeeId) {
  const date = shanghaiDate();
  const rows = await database.query(`SELECT shift_date AS shiftDate, first_in_at AS firstInAt, last_out_at AS lastOutAt,
    worked_minutes AS workedMinutes, approved_normal_minutes AS approvedNormalMinutes, overtime_candidate_minutes AS overtimeCandidateMinutes,
    result_status AS resultStatus, review_status AS reviewStatus FROM attendance_daily_results
    WHERE company_id=:companyId AND employee_id=:employeeId AND shift_date=:date LIMIT 1`, { companyId, employeeId, date });
  return rows[0] || { shiftDate: date, resultStatus: 'NOT_CALCULATED', workedMinutes: 0 };
}

async function listDaily(companyId, user, params = {}) {
  const queryParams = { companyId, date: params.date || new Date().toISOString().slice(0, 10) };
  const scope = employeeScope(user, queryParams, 'e', 'j');
  return database.query(`SELECT d.id, d.employee_id AS employeeId, e.name, d.shift_date AS shiftDate,
      d.first_in_at AS firstInAt, d.last_out_at AS lastOutAt, d.worked_minutes AS workedMinutes,
      d.approved_normal_minutes AS approvedNormalMinutes, d.approved_overtime_minutes AS approvedOvertimeMinutes,
      d.late_minutes AS lateMinutes, d.early_leave_minutes AS earlyLeaveMinutes, d.result_status AS resultStatus, d.review_status AS reviewStatus
    FROM attendance_daily_results d JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
    LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
    WHERE d.company_id=:companyId AND d.shift_date=:date ${scope} ORDER BY e.name`, queryParams);
}

async function listMonthly(companyId, user, params = {}) {
  const { start, end } = monthRange(params.month);
  const queryParams = { companyId, start, end };
  const scope = employeeScope(user, queryParams, 'e', 'j');
  return database.query(`SELECT d.employee_id AS employeeId, e.name,
      SUM(d.approved_normal_minutes) AS approvedNormalMinutes, SUM(d.approved_overtime_minutes) AS approvedOvertimeMinutes,
      SUM(d.late_minutes) AS lateMinutes, SUM(d.early_leave_minutes) AS earlyLeaveMinutes,
      SUM(d.result_status='MISSING_PUNCH') AS missingPunchDays, SUM(d.result_status='ABSENT') AS absentDays
    FROM attendance_daily_results d JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
    LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
    WHERE d.company_id=:companyId AND d.shift_date BETWEEN :start AND :end ${scope}
    GROUP BY d.employee_id, e.name ORDER BY e.name`, queryParams);
}

async function createShiftRule(companyId, operatorId, body = {}) {
  if (!body.ruleName || !/^\d{2}:\d{2}/.test(String(body.workStartTime || '')) || !/^\d{2}:\d{2}/.test(String(body.workEndTime || ''))) throw createError('班次信息不完整', 400, 'INVALID_SHIFT_RULE');
  const result = await database.query(`INSERT INTO attendance_shift_rules (company_id,rule_name,work_start_time,work_end_time,rest_start_time,rest_end_time,standard_minutes,late_grace_minutes,early_grace_minutes,overtime_min_minutes,created_by)
    VALUES (:companyId,:ruleName,:workStartTime,:workEndTime,:restStartTime,:restEndTime,:standardMinutes,:lateGraceMinutes,:earlyGraceMinutes,:overtimeMinMinutes,:operatorId)`, { companyId, operatorId, ruleName: String(body.ruleName).slice(0, 100), workStartTime: body.workStartTime, workEndTime: body.workEndTime, restStartTime: body.restStartTime || null, restEndTime: body.restEndTime || null, standardMinutes: Number(body.standardMinutes || 480), lateGraceMinutes: Number(body.lateGraceMinutes || 0), earlyGraceMinutes: Number(body.earlyGraceMinutes || 0), overtimeMinMinutes: Number(body.overtimeMinMinutes || 30) });
  return { id: result.insertId, ruleName: body.ruleName };
}

async function upsertSchedule(companyId, operatorId, body = {}) {
  if (!Number(body.employeeId) || !Number(body.shiftRuleId) || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.shiftDate || ''))) throw createError('排班信息不完整', 400, 'INVALID_SCHEDULE');
  await database.query(`INSERT INTO attendance_schedules (company_id,employee_id,shift_date,shift_rule_id,schedule_status,created_by)
    VALUES (:companyId,:employeeId,:shiftDate,:shiftRuleId,:scheduleStatus,:operatorId)
    ON DUPLICATE KEY UPDATE shift_rule_id=VALUES(shift_rule_id), schedule_status=VALUES(schedule_status), updated_at=CURRENT_TIMESTAMP`, { companyId, operatorId, employeeId: Number(body.employeeId), shiftDate: body.shiftDate, shiftRuleId: Number(body.shiftRuleId), scheduleStatus: body.scheduleStatus === 'REST' ? 'REST' : 'WORK' });
  return { employeeId: Number(body.employeeId), shiftDate: body.shiftDate, shiftRuleId: Number(body.shiftRuleId), scheduleStatus: body.scheduleStatus === 'REST' ? 'REST' : 'WORK' };
}

async function attendanceSummaryForPayroll(companyId, user, params = {}) {
  const rows = await listMonthly(companyId, user, params);
  return { month: params.month, list: rows.map(row => ({ employeeId: row.employeeId, name: row.name, normalMinutes: Number(row.approvedNormalMinutes || 0), overtimeMinutes: Number(row.approvedOvertimeMinutes || 0) })) };
}

module.exports = { getEmployeeToday, getEmployeeMonth, listDaily, listMonthly, monthRange, punchEmployee, createCorrection, reviewCorrection, createShiftRule, upsertSchedule, attendanceSummaryForPayroll };
