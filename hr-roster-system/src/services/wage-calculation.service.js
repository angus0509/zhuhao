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

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

async function cancelProjectPreviews(client, companyId, projectId) {
  await query(client, `UPDATE wage_calculation_runs SET status='CANCELLED'
    WHERE company_id=:companyId AND project_id=:projectId AND status='PREVIEW'`, { companyId, projectId });
}

async function setDailyPayment(companyIdValue, user, operatorIdValue, body = {}) {
  const companyId = positiveId(companyIdValue);
  const operatorId = positiveId(operatorIdValue);
  const projectId = positiveId(body.projectId);
  const employeeId = positiveId(body.employeeId);
  const shiftDate = String(body.shiftDate || '');
  const action = String(body.action || '');
  const remark = String(body.remark || '').trim();
  if (!companyId || !operatorId || !projectId || !employeeId || !validDate(shiftDate)
    || !['MARK_PAID', 'REVOKE'].includes(action)) {
    throw createError('日结状态参数无效', 400, 'INVALID_DAILY_PAYMENT');
  }
  if (action === 'REVOKE' && !remark) {
    throw createError('撤销日结必须填写原因', 400, 'DAILY_PAYMENT_REMARK_REQUIRED');
  }
  return db.transaction(async client => {
    await assertProject(client, companyId, user, projectId);
    const lines = await query(client, `SELECT line.employee_id AS employeeId,line.shift_date AS shiftDate,
        line.settlement_mode AS settlementMode,line.earned_amount AS earnedAmount,
        line.calculation_status AS calculationStatus
      FROM wage_calculation_daily_lines line
      JOIN wage_calculation_runs run ON run.id=line.run_id AND run.company_id=line.company_id
      WHERE line.company_id=:companyId AND line.project_id=:projectId AND line.employee_id=:employeeId
        AND line.shift_date=:shiftDate AND run.status IN ('PREVIEW','CANCELLED')
      ORDER BY run.revision_no DESC,line.id DESC LIMIT 1 FOR UPDATE`, {
      companyId, projectId, employeeId, shiftDate
    });
    const line = lines[0];
    if (!line) throw createError('未找到可日结的工资明细', 404, 'DAILY_WAGE_NOT_FOUND');
    if (line.settlementMode !== 'DAILY_PAID') {
      throw createError('该员工不是日结已支付模式', 409, 'DAILY_PAYMENT_MODE_REQUIRED');
    }
    if (!['READY', 'ZERO'].includes(line.calculationStatus)) {
      throw createError('当日工资仍有阻断项，不能标记日结', 409, 'DAILY_WAGE_BLOCKED');
    }
    const payments = await query(client, `SELECT id,status,amount FROM wage_daily_payments
      WHERE company_id=:companyId AND project_id=:projectId AND employee_id=:employeeId
        AND shift_date=:shiftDate LIMIT 1 FOR UPDATE`, { companyId, projectId, employeeId, shiftDate });
    const existing = payments[0];
    if (action === 'MARK_PAID' && existing?.status === 'PAID') {
      return { employeeId, shiftDate, status: 'PAID', amount: String(existing.amount) };
    }
    if (action === 'REVOKE' && (!existing || existing.status !== 'PAID')) {
      throw createError('该日工资尚未标记为已支付', 409, 'DAILY_PAYMENT_NOT_PAID');
    }
    const amount = String(line.earnedAmount);
    if (action === 'MARK_PAID') {
      await query(client, `INSERT INTO wage_daily_payments
        (company_id,project_id,employee_id,shift_date,amount,status,remark,paid_by,paid_at)
        VALUES (:companyId,:projectId,:employeeId,:shiftDate,:amount,'PAID',:remark,:operatorId,NOW())
        ON DUPLICATE KEY UPDATE amount=VALUES(amount),status='PAID',remark=VALUES(remark),
          paid_by=VALUES(paid_by),paid_at=NOW(),revoked_by=NULL,revoked_at=NULL`, {
        companyId, projectId, employeeId, shiftDate, amount, remark: remark || null, operatorId
      });
    } else {
      await query(client, `UPDATE wage_daily_payments SET status='REVOKED',remark=:remark,
          revoked_by=:operatorId,revoked_at=NOW()
        WHERE company_id=:companyId AND project_id=:projectId AND employee_id=:employeeId
          AND shift_date=:shiftDate AND status='PAID'`, {
        companyId, projectId, employeeId, shiftDate, remark, operatorId
      });
    }
    await cancelProjectPreviews(client, companyId, projectId);
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'考勤工资','wage_daily_payment',:employeeId,:actionType,:afterData)`, {
      companyId, operatorId, employeeId,
      actionType: action === 'MARK_PAID' ? 'mark_paid' : 'revoke',
      afterData: JSON.stringify({ projectId, employeeId, shiftDate, amount, remark: remark || null })
    });
    return { employeeId, shiftDate, status: action === 'MARK_PAID' ? 'PAID' : 'REVOKED', amount };
  });
}

function employeeWageSnapshot(employee) {
  const items = [
    { label: '当月应得工资', value: formatCents(employee.earnedCents), category: 'display', sortOrder: 1 },
    { label: '已日结金额', value: formatCents(employee.dailyPaidCents), category: 'display', sortOrder: 2 },
    { label: '月度待发金额', value: formatCents(employee.payableCents), category: 'display', sortOrder: 3 }
  ];
  employee.days.forEach((day, index) => {
    const shiftName = day.shiftType === 'NIGHT' ? '夜班' : '白班';
    items.push({
      label: `${String(day.shiftDate).slice(5, 10).replace('-', '月')}日 ${shiftName}`,
      value: `实际${(Number(day.workedMinutes || 0) / 60).toFixed(2)}小时，计薪${(Number(day.payableMinutes || 0) / 60).toFixed(2)}小时，时薪${day.hourlyRate}元，补贴${day.allowanceAmount}元，应得${day.earnedAmount}元，已日结${day.dailyPaidAmount}元，待发${day.payableAmount}元`,
      category: 'display',
      sortOrder: index + 4
    });
  });
  return items;
}

async function confirmPreview(companyIdValue, user, operatorIdValue, runIdValue) {
  const companyId = positiveId(companyIdValue);
  const operatorId = positiveId(operatorIdValue);
  const runId = positiveId(runIdValue);
  if (!companyId || !operatorId || !runId) {
    throw createError('工资预览确认参数无效', 400, 'INVALID_WAGE_CONFIRMATION');
  }
  return db.transaction(async client => {
    const params = { companyId, runId };
    const scope = projectScope(user, params, 'p');
    const runs = await query(client, `SELECT run.id AS runId,run.project_id AS projectId,
        run.salary_month AS salaryMonth,run.revision_no AS revisionNo,run.status,
        run.blocked_count AS blockedCount,run.salary_batch_id AS salaryBatchId
      FROM wage_calculation_runs run
      JOIN labor_project p ON p.id=run.project_id AND p.company_id=run.company_id
      WHERE run.company_id=:companyId AND run.id=:runId ${scope} LIMIT 1 FOR UPDATE`, params);
    const run = runs[0];
    if (!run) throw createError('工资预览不存在或无权访问', 404, 'WAGE_PREVIEW_NOT_FOUND');
    if (run.status === 'CONFIRMED' && positiveId(run.salaryBatchId)) {
      return { runId, salaryBatchId: Number(run.salaryBatchId), batchStatus: 3 };
    }
    const existingBatches = await query(client, `SELECT id FROM salary_batch
      WHERE company_id=:companyId AND calculation_run_id=:runId LIMIT 1 FOR UPDATE`, { companyId, runId });
    if (existingBatches[0]) {
      return { runId, salaryBatchId: Number(existingBatches[0].id), batchStatus: 3 };
    }
    if (run.status !== 'PREVIEW') throw createError('该工资预览已失效，请重新生成', 409, 'WAGE_PREVIEW_STALE');
    if (Number(run.blockedCount || 0) > 0) {
      throw createError(`仍有${Number(run.blockedCount)}条考勤异常未处理，不能生成工资批次`, 409, 'WAGE_PREVIEW_BLOCKED');
    }
    const latest = await query(client, `SELECT id FROM wage_calculation_runs
      WHERE company_id=:companyId AND project_id=:projectId AND salary_month=:salaryMonth
        AND status='PREVIEW' ORDER BY revision_no DESC LIMIT 1 FOR UPDATE`, {
      companyId, projectId: Number(run.projectId), salaryMonth: run.salaryMonth
    });
    if (Number(latest[0]?.id) !== runId) {
      throw createError('该工资预览不是最新版本，请刷新后重试', 409, 'WAGE_PREVIEW_STALE');
    }
    const lines = await query(client, `SELECT line.employee_id AS employeeId,line.shift_date AS shiftDate,
        line.shift_type AS shiftType,line.worked_minutes AS workedMinutes,
        line.payable_minutes AS payableMinutes,line.hourly_rate AS hourlyRate,
        line.allowance_amount AS allowanceAmount,line.earned_amount AS earnedAmount,
        line.daily_paid_amount AS dailyPaidAmount,line.payable_amount AS payableAmount
      FROM wage_calculation_daily_lines line
      WHERE line.company_id=:companyId AND line.run_id=:runId AND line.calculation_status IN ('READY','ZERO')
      ORDER BY line.employee_id,line.shift_date,line.id`, { companyId, runId });
    const employees = new Map();
    for (const line of lines) {
      const employeeId = Number(line.employeeId);
      if (!employees.has(employeeId)) {
        employees.set(employeeId, { employeeId, earnedCents: 0, dailyPaidCents: 0, payableCents: 0, days: [] });
      }
      const employee = employees.get(employeeId);
      employee.earnedCents += parseMoneyToCents(line.earnedAmount);
      employee.dailyPaidCents += parseMoneyToCents(line.dailyPaidAmount);
      employee.payableCents += parseMoneyToCents(line.payableAmount);
      employee.days.push(line);
    }
    const batchNo = `GZAUTO${String(run.salaryMonth).replace('-', '')}${runId}`;
    const totalGrossCents = [...employees.values()].reduce((sum, item) => sum + item.earnedCents, 0);
    const totalNetCents = [...employees.values()].reduce((sum, item) => sum + item.payableCents, 0);
    const sourceType = 'ATTENDANCE_AUTO';
    const batchResult = await query(client, `INSERT INTO salary_batch
      (company_id,project_id,batch_no,salary_month,payroll_type,source_type,calculation_run_id,
       batch_status,total_gross,total_net,created_by)
      VALUES (:companyId,:projectId,:batchNo,:salaryMonth,1,:sourceType,:runId,3,
        :totalGross,:totalNet,:operatorId)`, {
      companyId, projectId: Number(run.projectId), batchNo, salaryMonth: run.salaryMonth,
      sourceType, runId, totalGross: formatCents(totalGrossCents), totalNet: formatCents(totalNetCents), operatorId
    });
    const salaryBatchId = Number(batchResult.insertId);
    let sourceRowNo = 1;
    for (const employee of employees.values()) {
      await query(client, `INSERT INTO salary_detail
        (company_id,batch_id,employee_id,allowance_amount,gross_amount,other_deduction,net_amount,
         item_snapshot,source_row_no,receipt_status)
        VALUES (:companyId,:batchId,:employeeId,:allowanceAmount,:grossAmount,:otherDeduction,
          :netAmount,:itemSnapshot,:sourceRowNo,0)`, {
        companyId, batchId: salaryBatchId, employeeId: employee.employeeId,
        allowanceAmount: formatCents(employee.days.reduce(
          (sum, day) => sum + parseMoneyToCents(day.allowanceAmount), 0
        )),
        grossAmount: formatCents(employee.earnedCents),
        otherDeduction: formatCents(employee.dailyPaidCents),
        netAmount: formatCents(employee.payableCents),
        itemSnapshot: JSON.stringify(employeeWageSnapshot(employee)),
        sourceRowNo
      });
      sourceRowNo += 1;
    }
    await query(client, `UPDATE wage_calculation_runs SET status='CONFIRMED',salary_batch_id=:salaryBatchId,
        confirmed_by=:operatorId,confirmed_at=NOW()
      WHERE company_id=:companyId AND id=:runId AND status='PREVIEW'`, {
      companyId, runId, salaryBatchId, operatorId
    });
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'考勤工资','wage_calculation_run',:runId,'confirm',:afterData)`, {
      companyId, operatorId, runId,
      afterData: JSON.stringify({ salaryBatchId, projectId: Number(run.projectId), salaryMonth: run.salaryMonth })
    });
    return { runId, salaryBatchId, batchStatus: 3 };
  });
}

module.exports = { createPreview, getPreview, setDailyPayment, confirmPreview };
