const database = require('../db');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');

const STATUS_FILTERS = new Set([
  'ALL',
  'PENDING',
  'NORMAL',
  'LATE',
  'EARLY_LEAVE',
  'MISSING_PUNCH',
  'ABSENT',
  'GEOFENCE'
]);

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

function geofenceException(alias = 'd') {
  return `EXISTS (SELECT 1 FROM attendance_punches punch
    WHERE punch.company_id=${alias}.company_id AND punch.project_id=${alias}.project_id
      AND punch.employee_id=${alias}.employee_id AND punch.shift_date=${alias}.shift_date
      AND punch.geofence_status IN ('OUTSIDE','LOW_ACCURACY','LOCATION_FAILED'))`;
}

function pendingCorrection(alias = 'd') {
  return `EXISTS (SELECT 1 FROM attendance_correction_requests correction
    LEFT JOIN attendance_punches correction_punch
      ON correction_punch.id=correction.punch_id AND correction_punch.company_id=correction.company_id
    WHERE correction.company_id=${alias}.company_id AND correction.employee_id=${alias}.employee_id
      AND correction.shift_date=${alias}.shift_date AND correction.status='PENDING'
      AND COALESCE(correction_punch.project_id,${alias}.project_id)=${alias}.project_id)`;
}

function statusCondition(status) {
  const fence = geofenceException('d');
  const correction = pendingCorrection('d');
  const conditions = {
    PENDING: `((d.review_status<>'APPROVED' AND (d.result_status='MISSING_PUNCH' OR ${fence})) OR ${correction})`,
    NORMAL: "d.result_status='NORMAL'",
    LATE: "(d.result_status='LATE' OR d.late_minutes>0)",
    EARLY_LEAVE: "(d.result_status='EARLY_LEAVE' OR d.early_leave_minutes>0)",
    MISSING_PUNCH: "d.result_status='MISSING_PUNCH'",
    ABSENT: "d.result_status='ABSENT'",
    GEOFENCE: fence
  };
  return conditions[status] ? ` AND ${conditions[status]}` : '';
}

function numericSummary(row) {
  return {
    scheduled: Number(row.scheduled || 0),
    present: Number(row.present || 0),
    normal: Number(row.normal || 0),
    late: Number(row.late || 0),
    earlyLeave: Number(row.earlyLeave || 0),
    missingPunch: Number(row.missingPunch || 0),
    absent: Number(row.absent || 0),
    geofenceException: Number(row.geofenceException || 0),
    pendingReview: Number(row.pendingReview || 0)
  };
}

async function getWorkbench(companyId, user, query = {}) {
  const projectId = positiveId(query.projectId);
  const date = String(query.date || '');
  const status = String(query.status || 'PENDING').toUpperCase();
  const keywordText = String(query.keyword || '').trim();
  if (!projectId || !validDate(date) || !STATUS_FILTERS.has(status) || keywordText.length > 50) {
    throw createError('考勤工作台查询参数无效', 400, 'INVALID_WORKBENCH_QUERY');
  }

  const aggregateParams = { companyId, projectId, date };
  const aggregateScope = projectScope(user, aggregateParams, 'p');
  const fence = geofenceException('d');
  const correction = pendingCorrection('d');
  const aggregateRows = await database.query(`SELECT p.id AS projectId,
      COALESCE(closure.status,'OPEN') AS closureStatus,
      COALESCE(closure.version_no,0) AS closureVersionNo,closure.confirmed_at AS confirmedAt,
      COUNT(DISTINCT CASE WHEN s.schedule_status<>'REST' THEN s.employee_id END) AS scheduled,
      COUNT(DISTINCT CASE WHEN d.first_in_at IS NOT NULL OR d.last_out_at IS NOT NULL THEN d.employee_id END) AS present,
      COUNT(DISTINCT CASE WHEN d.result_status='NORMAL' THEN d.employee_id END) AS normal,
      COUNT(DISTINCT CASE WHEN d.result_status='LATE' OR d.late_minutes>0 THEN d.employee_id END) AS late,
      COUNT(DISTINCT CASE WHEN d.result_status='EARLY_LEAVE' OR d.early_leave_minutes>0 THEN d.employee_id END) AS earlyLeave,
      COUNT(DISTINCT CASE WHEN d.result_status='MISSING_PUNCH' THEN d.employee_id END) AS missingPunch,
      COUNT(DISTINCT CASE WHEN d.result_status='ABSENT' THEN d.employee_id END) AS absent,
      COUNT(DISTINCT CASE WHEN ${fence} THEN d.employee_id END) AS geofenceException,
      COUNT(DISTINCT CASE WHEN (d.review_status<>'APPROVED'
        AND (d.result_status='MISSING_PUNCH' OR ${fence})) OR ${correction} THEN d.employee_id END) AS pendingReview
    FROM labor_project p
    LEFT JOIN attendance_schedules s ON s.company_id=p.company_id AND s.project_id=p.id AND s.shift_date=:date
    LEFT JOIN attendance_daily_results d ON d.company_id=s.company_id AND d.project_id=s.project_id
      AND d.employee_id=s.employee_id AND d.shift_date=s.shift_date
    LEFT JOIN attendance_daily_closures closure ON closure.company_id=p.company_id
      AND closure.project_id=p.id AND closure.shift_date=:date
    WHERE p.company_id=:companyId AND p.id=:projectId${aggregateScope}
    GROUP BY p.id,closure.status,closure.version_no,closure.confirmed_at`, aggregateParams);
  const aggregate = aggregateRows[0];
  if (!aggregate) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');

  const detailParams = { companyId, projectId, date };
  const detailScope = projectScope(user, detailParams, 'p');
  let keywordCondition = '';
  if (keywordText) {
    detailParams.keyword = `%${keywordText}%`;
    keywordCondition = ' AND e.name LIKE :keyword';
  }
  const list = await database.query(`SELECT d.id AS resultId,d.employee_id AS employeeId,e.name,
      d.first_in_at AS firstInAt,d.last_out_at AS lastOutAt,d.worked_minutes AS workedMinutes,
      (d.approved_normal_minutes+d.approved_overtime_minutes) AS approvedMinutes,d.result_status AS resultStatus,
      (SELECT punch.geofence_status FROM attendance_punches punch
        WHERE punch.company_id=d.company_id AND punch.project_id=d.project_id
          AND punch.employee_id=d.employee_id AND punch.shift_date=d.shift_date
        ORDER BY punch.punch_time DESC LIMIT 1) AS geofenceStatus,
      CASE
        WHEN ${pendingCorrection('d')} THEN '存在待审核申请'
        WHEN d.result_status='MISSING_PUNCH' THEN '缺少打卡'
        WHEN ${geofenceException('d')} THEN '定位异常待核实'
        ELSE NULL
      END AS pendingReason
    FROM attendance_daily_results d
    JOIN labor_project p ON p.id=d.project_id AND p.company_id=d.company_id
    JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
    WHERE d.company_id=:companyId AND d.project_id=:projectId AND d.shift_date=:date${detailScope}
      ${statusCondition(status)}${keywordCondition}
    ORDER BY e.name,d.employee_id`, detailParams);

  return {
    closure: {
      status: aggregate.closureStatus || 'OPEN',
      versionNo: Number(aggregate.closureVersionNo || 0),
      confirmedAt: aggregate.confirmedAt || null
    },
    summary: numericSummary(aggregate),
    list
  };
}

module.exports = { getWorkbench, validDate, statusCondition };
