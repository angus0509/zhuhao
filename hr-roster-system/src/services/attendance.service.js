const database = require('../db');
const { createError } = require('../utils/response');
const { employeeScope } = require('../utils/data-scope');

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

module.exports = { getEmployeeMonth, listDaily, listMonthly, monthRange };
