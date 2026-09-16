const db = require('../db');
const { projectScope } = require('../utils/data-scope');
const { createError } = require('../utils/response');
const {
  calculateDailyWage,
  parseMoneyToCents,
  formatCents
} = require('./hourly-wage-calculator.service');

async function query(client, sql, params = {}) {
  const [rows] = await client.execute(sql, params);
  return rows;
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

function dateKey(employeeId, shiftDate) {
  return `${Number(employeeId)}:${String(shiftDate).slice(0, 10)}`;
}

function blockedResult(reason, dailyPaidAmount = '0.00') {
  return {
    payableMinutes: 0,
    baseAmount: '0.00',
    allowanceAmount: '0.00',
    earnedAmount: '0.00',
    dailyPaidAmount,
    payableAmount: '0.00',
    allowanceItems: [],
    calculationStatus: 'BLOCKED',
    blockedReason: reason
  };
}

function calculateLine(row, allowances, dailyPaidAmount) {
  if (Number(row.pendingExceptionCount || 0) > 0) return blockedResult('考勤异常待处理', dailyPaidAmount);
  if (!row.settlementMode) return blockedResult('未设置员工计薪方式', dailyPaidAmount);
  if (!row.shiftType || !row.projectShiftRuleId) return blockedResult('未设置员工班次', dailyPaidAmount);
  if (row.hourlyRate == null || String(row.hourlyRate).trim() === '') {
    return blockedResult('班次未设置时薪', dailyPaidAmount);
  }
  return calculateDailyWage({
    approvedMinutes: Number(row.approvedNormalMinutes || 0) + Number(row.approvedOvertimeMinutes || 0),
    shiftType: row.shiftType,
    hourlyRate: row.hourlyRate,
    allowances,
    settlementMode: row.settlementMode,
    dailyPaidAmount,
    attendanceStatus: row.resultStatus
  });
}

async function assertProject(client, companyId, user, projectId) {
  const params = { companyId, projectId };
  const scope = projectScope(user, params, 'p');
  const rows = await query(client, `SELECT p.id AS projectId,p.project_name AS projectName
    FROM labor_project p
    WHERE p.company_id=:companyId AND p.id=:projectId ${scope} LIMIT 1 FOR UPDATE`, params);
  if (!rows[0]) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
  return rows[0];
}

async function loadAttendanceRows(client, companyId, projectId, salaryMonth) {
  return query(client, `SELECT d.id AS attendanceResultId,d.employee_id AS employeeId,e.name,
      d.shift_date AS shiftDate,d.worked_minutes AS workedMinutes,
      d.approved_normal_minutes AS approvedNormalMinutes,
      d.approved_overtime_minutes AS approvedOvertimeMinutes,
      d.result_status AS resultStatus,d.review_status AS reviewStatus,
      COALESCE(s.project_rule_id,
        (SELECT pr.id FROM attendance_project_rules pr
          WHERE pr.company_id=d.company_id AND pr.project_id=d.project_id AND pr.status=1
            AND pr.effective_from<=d.shift_date
          ORDER BY pr.effective_from DESC,pr.id DESC LIMIT 1)) AS projectRuleId,
      COALESCE(s.shift_type,profile.default_shift_type) AS shiftType,
      shift_rule.id AS projectShiftRuleId,shift_rule.hourly_rate AS hourlyRate,
      profile.settlement_mode AS settlementMode,
      (SELECT COUNT(*) FROM attendance_correction_requests correction
        WHERE correction.company_id=d.company_id AND correction.employee_id=d.employee_id
          AND correction.shift_date=d.shift_date AND correction.status='PENDING') AS pendingExceptionCount
    FROM attendance_daily_results d
    JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
    LEFT JOIN attendance_schedules s ON s.id=d.schedule_id AND s.company_id=d.company_id
    LEFT JOIN employee_pay_profiles profile ON profile.id=(
      SELECT profile_lookup.id FROM employee_pay_profiles profile_lookup
      WHERE profile_lookup.company_id=d.company_id AND profile_lookup.project_id=d.project_id
        AND profile_lookup.employee_id=d.employee_id AND profile_lookup.status=1
        AND profile_lookup.effective_from<=d.shift_date
      ORDER BY profile_lookup.effective_from DESC,profile_lookup.id DESC LIMIT 1)
    LEFT JOIN attendance_project_shift_rules shift_rule ON shift_rule.id=COALESCE(
      s.project_shift_rule_id,
      (SELECT shift_lookup.id FROM attendance_project_shift_rules shift_lookup
        WHERE shift_lookup.company_id=d.company_id AND shift_lookup.project_id=d.project_id
          AND shift_lookup.project_rule_id=COALESCE(s.project_rule_id,
            (SELECT rule_lookup.id FROM attendance_project_rules rule_lookup
              WHERE rule_lookup.company_id=d.company_id AND rule_lookup.project_id=d.project_id
                AND rule_lookup.status=1 AND rule_lookup.effective_from<=d.shift_date
              ORDER BY rule_lookup.effective_from DESC,rule_lookup.id DESC LIMIT 1))
          AND shift_lookup.shift_type=COALESCE(s.shift_type,profile.default_shift_type)
          AND shift_lookup.status=1 LIMIT 1))
      AND shift_rule.company_id=d.company_id AND shift_rule.project_id=d.project_id
    WHERE d.company_id=:companyId AND d.project_id=:projectId
      AND d.shift_date>=CONCAT(:salaryMonth,'-01')
      AND d.shift_date<DATE_ADD(CONCAT(:salaryMonth,'-01'),INTERVAL 1 MONTH)
      AND EXISTS (SELECT 1 FROM hr_employee_job wage_job
        WHERE wage_job.company_id=d.company_id AND wage_job.employee_id=d.employee_id
          AND wage_job.project_id=d.project_id
          AND (wage_job.hire_date IS NULL OR wage_job.hire_date<=d.shift_date)
          AND NOT EXISTS (SELECT 1 FROM hr_employee_job newer_wage_job
            WHERE newer_wage_job.company_id=wage_job.company_id
              AND newer_wage_job.employee_id=wage_job.employee_id
              AND newer_wage_job.hire_date IS NOT NULL AND newer_wage_job.hire_date<=d.shift_date
              AND (wage_job.hire_date IS NULL OR newer_wage_job.hire_date>wage_job.hire_date
                OR (newer_wage_job.hire_date=wage_job.hire_date AND newer_wage_job.id>wage_job.id))))
    ORDER BY d.shift_date,d.employee_id`, { companyId, projectId, salaryMonth });
}

async function loadAllowances(client, companyId, projectId) {
  return query(client, `SELECT project_rule_id AS projectRuleId,allowance_name AS allowanceName,
      shift_scope AS shiftScope,calculation_type AS calculationType,unit_amount AS unitAmount
    FROM attendance_allowance_rules
    WHERE company_id=:companyId AND project_id=:projectId AND status=1
    ORDER BY project_rule_id,sort_order,id`, { companyId, projectId });
}

async function loadDailyPayments(client, companyId, projectId, salaryMonth) {
  return query(client, `SELECT employee_id AS employeeId,shift_date AS shiftDate,amount
    FROM wage_daily_payments
    WHERE company_id=:companyId AND project_id=:projectId AND status='PAID'
      AND shift_date>=CONCAT(:salaryMonth,'-01')
      AND shift_date<DATE_ADD(CONCAT(:salaryMonth,'-01'),INTERVAL 1 MONTH)`, {
    companyId, projectId, salaryMonth
  });
}

async function insertDailyLine(client, companyId, runId, projectId, row, result) {
  return query(client, `INSERT INTO wage_calculation_daily_lines
    (company_id,run_id,project_id,employee_id,shift_date,attendance_result_id,project_rule_id,
     project_shift_rule_id,shift_type,settlement_mode,worked_minutes,approved_minutes,payable_minutes,
     hourly_rate,base_amount,allowance_amount,earned_amount,daily_paid_amount,payable_amount,
     allowance_snapshot,calculation_status,blocked_reason)
    VALUES (:companyId,:runId,:projectId,:employeeId,:shiftDate,:attendanceResultId,:projectRuleId,
      :projectShiftRuleId,:shiftType,:settlementMode,:workedMinutes,:approvedMinutes,:payableMinutes,
      :hourlyRate,:baseAmount,:allowanceAmount,:earnedAmount,:dailyPaidAmount,:payableAmount,
      :allowanceSnapshot,:calculationStatus,:blockedReason)`, {
    companyId,
    runId,
    projectId,
    employeeId: Number(row.employeeId),
    shiftDate: String(row.shiftDate).slice(0, 10),
    attendanceResultId: positiveId(row.attendanceResultId) || null,
    projectRuleId: positiveId(row.projectRuleId) || null,
    projectShiftRuleId: positiveId(row.projectShiftRuleId) || null,
    shiftType: row.shiftType || null,
    settlementMode: row.settlementMode || 'MONTHLY',
    workedMinutes: Number(row.workedMinutes || 0),
    approvedMinutes: Number(row.approvedNormalMinutes || 0) + Number(row.approvedOvertimeMinutes || 0),
    payableMinutes: result.payableMinutes,
    hourlyRate: row.hourlyRate == null ? '0.00' : String(row.hourlyRate),
    baseAmount: result.baseAmount,
    allowanceAmount: result.allowanceAmount,
    earnedAmount: result.earnedAmount,
    dailyPaidAmount: result.dailyPaidAmount,
    payableAmount: result.payableAmount,
    allowanceSnapshot: JSON.stringify(result.allowanceItems),
    calculationStatus: result.calculationStatus,
    blockedReason: result.blockedReason
  });
}

async function createPreview(companyIdValue, user, operatorIdValue, body = {}) {
  const companyId = positiveId(companyIdValue);
  const operatorId = positiveId(operatorIdValue);
  const projectId = positiveId(body.projectId);
  const salaryMonth = String(body.salaryMonth || '');
  if (!companyId || !operatorId || !projectId || !validMonth(salaryMonth)) {
    throw createError('工资计算参数无效', 400, 'INVALID_WAGE_CALCULATION');
  }
  return db.transaction(async client => {
    await assertProject(client, companyId, user, projectId);
    const runs = await query(client, `SELECT id,revision_no AS revisionNo,status
      FROM wage_calculation_runs
      WHERE company_id=:companyId AND project_id=:projectId AND salary_month=:salaryMonth
      ORDER BY revision_no DESC FOR UPDATE`, { companyId, projectId, salaryMonth });
    const attendanceRows = await loadAttendanceRows(client, companyId, projectId, salaryMonth);
    const allowanceRows = await loadAllowances(client, companyId, projectId);
    const paymentRows = await loadDailyPayments(client, companyId, projectId, salaryMonth);
    const allowancesByRule = new Map();
    for (const allowance of allowanceRows) {
      const ruleId = Number(allowance.projectRuleId);
      if (!allowancesByRule.has(ruleId)) allowancesByRule.set(ruleId, []);
      allowancesByRule.get(ruleId).push(allowance);
    }
    const payments = new Map(paymentRows.map(item => [dateKey(item.employeeId, item.shiftDate), String(item.amount)]));
    let totalEarnedCents = 0;
    let totalDailyPaidCents = 0;
    let totalPayableCents = 0;
    let blockedCount = 0;
    const lines = attendanceRows.map(row => {
      const dailyPaidAmount = payments.get(dateKey(row.employeeId, row.shiftDate)) || '0.00';
      const result = calculateLine(row, allowancesByRule.get(Number(row.projectRuleId)) || [], dailyPaidAmount);
      totalEarnedCents += parseMoneyToCents(result.earnedAmount);
      totalDailyPaidCents += parseMoneyToCents(result.dailyPaidAmount);
      totalPayableCents += parseMoneyToCents(result.payableAmount);
      if (result.calculationStatus === 'BLOCKED') blockedCount += 1;
      return { row, result };
    });
    const revisionNo = Math.max(0, ...runs.map(item => Number(item.revisionNo || 0))) + 1;
    await query(client, `UPDATE wage_calculation_runs SET status='CANCELLED'
      WHERE company_id=:companyId AND project_id=:projectId AND salary_month=:salaryMonth AND status='PREVIEW'`, {
      companyId, projectId, salaryMonth
    });
    const totals = {
      totalEarned: formatCents(totalEarnedCents),
      totalDailyPaid: formatCents(totalDailyPaidCents),
      totalPayable: formatCents(totalPayableCents)
    };
    const inserted = await query(client, `INSERT INTO wage_calculation_runs
      (company_id,project_id,salary_month,revision_no,status,total_earned,total_daily_paid,total_payable,
       blocked_count,created_by)
      VALUES (:companyId,:projectId,:salaryMonth,:revisionNo,'PREVIEW',:totalEarned,:totalDailyPaid,
        :totalPayable,:blockedCount,:operatorId)`, {
      companyId, projectId, salaryMonth, revisionNo, blockedCount, operatorId, ...totals
    });
    const runId = Number(inserted.insertId);
    for (const line of lines) await insertDailyLine(client, companyId, runId, projectId, line.row, line.result);
    return { runId, projectId, salaryMonth, revisionNo, ...totals, blockedCount };
  });
}

async function getPreview(companyIdValue, user, runIdValue) {
  const companyId = positiveId(companyIdValue);
  const runId = positiveId(runIdValue);
  if (!companyId || !runId) throw createError('工资预览不存在或无权访问', 404, 'WAGE_PREVIEW_NOT_FOUND');
  const params = { companyId, runId };
  const scope = projectScope(user, params, 'p');
  const runs = await db.query(`SELECT run.id AS runId,run.project_id AS projectId,p.project_name AS projectName,
      run.salary_month AS salaryMonth,run.revision_no AS revisionNo,run.status,run.salary_batch_id AS salaryBatchId,
      run.total_earned AS totalEarned,run.total_daily_paid AS totalDailyPaid,
      run.total_payable AS totalPayable,run.blocked_count AS blockedCount
    FROM wage_calculation_runs run
    JOIN labor_project p ON p.id=run.project_id AND p.company_id=run.company_id
    WHERE run.company_id=:companyId AND run.id=:runId ${scope} LIMIT 1`, params);
  if (!runs[0]) throw createError('工资预览不存在或无权访问', 404, 'WAGE_PREVIEW_NOT_FOUND');
  const lines = await db.query(`SELECT line.employee_id AS employeeId,e.name,line.shift_date AS shiftDate,
      line.shift_type AS shiftType,line.settlement_mode AS settlementMode,
      line.worked_minutes AS workedMinutes,line.approved_minutes AS approvedMinutes,
      line.payable_minutes AS payableMinutes,line.hourly_rate AS hourlyRate,line.base_amount AS baseAmount,
      line.allowance_amount AS allowanceAmount,line.earned_amount AS earnedAmount,
      line.daily_paid_amount AS dailyPaidAmount,line.payable_amount AS payableAmount,
      line.allowance_snapshot AS allowanceItems,line.calculation_status AS calculationStatus,
      line.blocked_reason AS blockedReason
    FROM wage_calculation_daily_lines line
    JOIN hr_employee e ON e.id=line.employee_id AND e.company_id=line.company_id
    WHERE line.company_id=:companyId AND line.run_id=:runId
    ORDER BY e.name,line.shift_date,line.id`, { companyId, runId });
  const employeesById = new Map();
  for (const line of lines) {
    const employeeId = Number(line.employeeId);
    if (!employeesById.has(employeeId)) employeesById.set(employeeId, { employeeId, name: line.name, days: [] });
    employeesById.get(employeeId).days.push(line);
  }
  const run = runs[0];
  return {
    runId: Number(run.runId),
    projectId: Number(run.projectId),
    projectName: run.projectName,
    salaryMonth: run.salaryMonth,
    revisionNo: Number(run.revisionNo),
    status: run.status,
    salaryBatchId: run.salaryBatchId == null ? null : Number(run.salaryBatchId),
    summary: {
      totalEarned: String(run.totalEarned),
      totalDailyPaid: String(run.totalDailyPaid),
      totalPayable: String(run.totalPayable),
      blockedCount: Number(run.blockedCount)
    },
    employees: [...employeesById.values()]
  };
}

module.exports = { createPreview, getPreview };
