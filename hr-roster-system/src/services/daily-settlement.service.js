const db = require('../db');
const { projectScope } = require('../utils/data-scope');
const { createError } = require('../utils/response');
const { parseMoneyToCents, formatCents } = require('./hourly-wage-calculator.service');
const wageCalculation = require('./wage-calculation.service');

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

function validRequestId(value) {
  return /^[A-Za-z0-9:_-]{8,64}$/.test(String(value || ''));
}

function idsClause(ids, params) {
  return ids.map((id, index) => {
    const key = `employeeId${index}`;
    params[key] = id;
    return `:${key}`;
  }).join(',');
}

async function assertProject(client, companyId, user, projectId) {
  const params = { companyId, projectId };
  const scope = projectScope(user, params, 'p');
  const rows = await query(client, `SELECT p.id AS projectId FROM labor_project p
    WHERE p.company_id=:companyId AND p.id=:projectId${scope}
    LIMIT 1 FOR UPDATE`, params);
  if (!rows[0]) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
}

async function listProjects(companyId, user) {
  const params = { companyId };
  const scope = projectScope(user, params, 'p');
  const list = await db.query(`SELECT p.id AS projectId,p.project_name AS projectName,
      p.customer_id AS customerId,c.customer_name AS customerName
    FROM labor_project p JOIN crm_customer c ON c.id=p.customer_id AND c.company_id=p.company_id
    WHERE p.company_id=:companyId${scope}
    ORDER BY c.customer_name,p.project_name,p.id`, params);
  return { list };
}

function paymentStatus(line, payment) {
  if (payment?.status === 'PAID') return 'PAID';
  if (line.calculationStatus === 'BLOCKED') return 'BLOCKED';
  if (line.calculationStatus === 'ZERO') return 'NO_PAYMENT';
  return 'READY';
}

async function createDailyPreview(companyId, user, operatorId, body = {}) {
  const projectId = positiveId(body.projectId);
  const shiftDate = String(body.shiftDate || '');
  if (!projectId || !validDate(shiftDate) || !validRequestId(body.clientRequestId)) {
    throw createError('日结预览参数无效', 400, 'INVALID_DAILY_PREVIEW');
  }
  const preview = await wageCalculation.createPreview(companyId, user, operatorId, {
    projectId, salaryMonth: shiftDate.slice(0, 7), clientRequestId: String(body.clientRequestId)
  });
  const detail = await wageCalculation.getPreview(companyId, user, preview.runId);
  const list = detail.employees.flatMap(employee => employee.days
    .filter(day => String(day.shiftDate).slice(0, 10) === shiftDate)
    .map(day => ({ employeeId: employee.employeeId, name: employee.name, ...day })));
  return { runId: preview.runId, projectId, shiftDate, list };
}

async function listDailySettlements(companyId, user, queryParams = {}) {
  const projectId = positiveId(queryParams.projectId);
  const shiftDate = String(queryParams.shiftDate || '');
  const keyword = String(queryParams.keyword || '').trim();
  const status = String(queryParams.status || 'ALL').toUpperCase();
  if (!projectId || !validDate(shiftDate) || keyword.length > 50 ||
    !['ALL', 'READY', 'BLOCKED', 'NO_PAYMENT', 'PAID'].includes(status)) {
    throw createError('日结查询参数无效', 400, 'INVALID_DAILY_QUERY');
  }
  const params = { companyId, projectId, shiftDate };
  const scope = projectScope(user, params, 'p');
  const runs = await db.query(`SELECT run.id AS runId,run.status AS runStatus,
      closure.version_no AS closureVersion,closure.status AS closureStatus
    FROM labor_project p
    LEFT JOIN wage_calculation_runs run ON run.id=(
      SELECT latest.id FROM wage_calculation_runs latest
      WHERE latest.company_id=p.company_id AND latest.project_id=p.id
        AND latest.salary_month=LEFT(:shiftDate,7) AND latest.status IN ('PREVIEW','CANCELLED')
      ORDER BY latest.revision_no DESC LIMIT 1)
    LEFT JOIN attendance_daily_closures closure ON closure.company_id=p.company_id
      AND closure.project_id=p.id AND closure.shift_date=:shiftDate
    WHERE p.company_id=:companyId AND p.id=:projectId${scope} LIMIT 1`, params);
  if (!runs[0]) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
  const run = runs[0];
  const rows = positiveId(run.runId)
    ? await db.query(`SELECT line.employee_id AS employeeId,e.name,line.shift_type AS shiftType,
        line.worked_minutes AS workedMinutes,line.approved_minutes AS approvedMinutes,
        line.payable_minutes AS payableMinutes,line.hourly_rate AS hourlyRate,
        line.base_amount AS baseAmount,line.allowance_amount AS allowanceAmount,
        line.earned_amount AS earnedAmount,line.allowance_snapshot AS allowanceItems,
        line.calculation_status AS calculationStatus,line.blocked_reason AS blockedReason,
        line.attendance_closure_version AS attendanceClosureVersion,
        pay.id AS paymentId,pay.status AS paymentStatus,pay.amount AS paidAmount
      FROM wage_calculation_daily_lines line
      JOIN hr_employee e ON e.id=line.employee_id AND e.company_id=line.company_id
      LEFT JOIN wage_daily_payments pay ON pay.company_id=line.company_id
        AND pay.project_id=line.project_id AND pay.employee_id=line.employee_id
        AND pay.shift_date=line.shift_date
      WHERE line.company_id=:companyId AND line.project_id=:projectId
        AND line.run_id=:runId AND line.shift_date=:shiftDate
      ORDER BY e.name,line.employee_id`, { companyId, projectId, runId: Number(run.runId), shiftDate })
    : [];
  const all = rows.map(row => ({
    ...row,
    employeeId: Number(row.employeeId),
    paymentId: row.paymentId == null ? null : Number(row.paymentId),
    status: paymentStatus(row, { status: row.paymentStatus }),
    approvedHours: (Number(row.approvedMinutes || 0) / 60).toFixed(2),
    workedHours: (Number(row.workedMinutes || 0) / 60).toFixed(2)
  }));
  const summary = {
    employeeCount: all.length,
    readyCount: all.filter(row => row.status === 'READY').length,
    blockedCount: all.filter(row => row.status === 'BLOCKED').length,
    paidCount: all.filter(row => row.status === 'PAID').length,
    readyAmount: formatCents(all.filter(row => row.status === 'READY')
      .reduce((total, row) => total + parseMoneyToCents(row.earnedAmount), 0)),
    paidAmount: formatCents(all.filter(row => row.status === 'PAID')
      .reduce((total, row) => total + parseMoneyToCents(row.paidAmount), 0))
  };
  return {
    runId: positiveId(run.runId) || null,
    runStatus: run.runStatus || null,
    closureVersion: Number(run.closureVersion || 0),
    closureStatus: run.closureStatus || 'OPEN',
    summary,
    list: all.filter(row => (status === 'ALL' || row.status === status)
      && (!keyword || String(row.name || '').includes(keyword)))
  };
}

function batchInput(body) {
  const projectId = positiveId(body.projectId);
  const shiftDate = String(body.shiftDate || '');
  const runId = positiveId(body.runId);
  const closureVersion = positiveId(body.closureVersion);
  const original = body.employeeIds;
  const employeeIds = Array.isArray(original) ? original.map(positiveId) : [];
  const clientRequestId = String(body.clientRequestId || '');
  if (!projectId || !validDate(shiftDate) || !runId || !closureVersion ||
    !employeeIds.length || employeeIds.length > 500 || employeeIds.includes(0) ||
    new Set(employeeIds).size !== employeeIds.length || !validRequestId(clientRequestId)) {
    throw createError('日结确认参数无效', 400, 'INVALID_DAILY_PAYMENT');
  }
  return { projectId, shiftDate, runId, closureVersion, clientRequestId,
    employeeIds: employeeIds.sort((left, right) => left - right),
    remark: String(body.remark || '').trim().slice(0, 255) };
}

async function replayBatch(client, companyId, input) {
  const events = await query(client, `SELECT employee_id AS employeeId,amount,
      action_type AS actionType,project_id AS projectId,shift_date AS shiftDate
    FROM wage_daily_payment_events
    WHERE company_id=:companyId AND client_request_id=:clientRequestId
    ORDER BY employee_id`, { companyId, clientRequestId: input.clientRequestId });
  if (!events.length) return null;
  const same = events.length === input.employeeIds.length && events.every((event, index) =>
    Number(event.employeeId) === input.employeeIds[index]
    && Number(event.projectId) === input.projectId
    && String(event.shiftDate).slice(0, 10) === input.shiftDate
    && ['MARK_PAID', 'REPAID'].includes(event.actionType));
  if (!same) throw createError('请求编号已用于其他日结操作', 409, 'DAILY_REQUEST_CONFLICT');
  return { status: 'PAID', paidCount: events.length,
    totalAmount: formatCents(events.reduce((sum, event) => sum + parseMoneyToCents(event.amount), 0)) };
}

async function confirmBatch(companyId, user, operatorId, body = {}) {
  const input = batchInput(body);
  return db.transaction(async client => {
    await assertProject(client, companyId, user, input.projectId);
    const replay = await replayBatch(client, companyId, input);
    if (replay) return replay;
    const params = { companyId, projectId: input.projectId, shiftDate: input.shiftDate };
    const closures = await query(client, `SELECT id,status,version_no AS versionNo
      FROM attendance_daily_closures
      WHERE company_id=:companyId AND project_id=:projectId AND shift_date=:shiftDate
      LIMIT 1 FOR UPDATE`, params);
    const closure = closures[0];
    if (!closure || closure.status !== 'CONFIRMED') {
      throw createError('考勤日尚未确认', 409, 'DAILY_WAGE_BLOCKED');
    }
    if (Number(closure.versionNo) !== input.closureVersion) {
      throw createError('考勤确认版本已变化，请刷新预览', 409, 'WAGE_PREVIEW_STALE');
    }
    const runs = await query(client, `SELECT id,status,revision_no AS revisionNo
      FROM wage_calculation_runs
      WHERE company_id=:companyId AND project_id=:projectId
        AND salary_month=LEFT(:shiftDate,7)
      ORDER BY revision_no DESC LIMIT 1 FOR UPDATE`, params);
    if (!runs[0] || Number(runs[0].id) !== input.runId || runs[0].status !== 'PREVIEW') {
      throw createError('工资预览已失效，请重新计算', 409, 'WAGE_PREVIEW_STALE');
    }
    const lineParams = { ...params, runId: input.runId };
    const placeholders = idsClause(input.employeeIds, lineParams);
    const lines = await query(client, `SELECT employee_id AS employeeId,
        settlement_mode AS settlementMode,calculation_status AS calculationStatus,
        earned_amount AS earnedAmount,attendance_closure_id AS attendanceClosureId,
        attendance_closure_version AS attendanceClosureVersion
      FROM wage_calculation_daily_lines
      WHERE company_id=:companyId AND project_id=:projectId AND run_id=:runId
        AND shift_date=:shiftDate AND employee_id IN (${placeholders})
      ORDER BY employee_id FOR UPDATE`, lineParams);
    if (lines.length !== input.employeeIds.length ||
      lines.some((line, index) => Number(line.employeeId) !== input.employeeIds[index] ||
        line.settlementMode !== 'DAILY_PAID' || line.calculationStatus !== 'READY')) {
      throw createError('所选员工存在阻断项，整批未提交', 409, 'DAILY_WAGE_BLOCKED');
    }
    if (lines.some(line => Number(line.attendanceClosureId) !== Number(closure.id) ||
      Number(line.attendanceClosureVersion) !== input.closureVersion)) {
      throw createError('考勤确认版本已变化，请刷新预览', 409, 'WAGE_PREVIEW_STALE');
    }
    const payments = await query(client, `SELECT id,employee_id AS employeeId,status
      FROM wage_daily_payments
      WHERE company_id=:companyId AND project_id=:projectId AND shift_date=:shiftDate
        AND employee_id IN (${placeholders}) ORDER BY employee_id FOR UPDATE`, lineParams);
    if (payments.some(payment => payment.status === 'PAID')) {
      throw createError('所选员工存在已支付记录', 409, 'DAILY_PAYMENT_ALREADY_PAID');
    }
    const previousByEmployee = new Map(payments.map(payment => [Number(payment.employeeId), payment]));
    let totalCents = 0;
    for (const line of lines) {
      const employeeId = Number(line.employeeId);
      const amount = String(line.earnedAmount);
      totalCents += parseMoneyToCents(amount);
      const inserted = await query(client, `INSERT INTO wage_daily_payments
        (company_id,project_id,employee_id,shift_date,amount,status,remark,paid_by,paid_at)
        VALUES (:companyId,:projectId,:employeeId,:shiftDate,:amount,'PAID',:remark,:operatorId,NOW())
        ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),amount=VALUES(amount),status='PAID',
          remark=VALUES(remark),paid_by=VALUES(paid_by),paid_at=NOW(),revoked_by=NULL,revoked_at=NULL`, {
        ...params, employeeId, amount, remark: input.remark || null, operatorId
      });
      await query(client, `INSERT INTO wage_daily_payment_events
        (company_id,payment_id,project_id,employee_id,shift_date,action_type,amount,
         run_id,closure_version,client_request_id,remark,operated_by)
        VALUES (:companyId,:paymentId,:projectId,:employeeId,:shiftDate,:actionType,:amount,
          :runId,:closureVersion,:clientRequestId,:remark,:operatorId)`, {
        ...params, employeeId, paymentId: Number(inserted.insertId),
        actionType: previousByEmployee.has(employeeId) ? 'REPAID' : 'MARK_PAID',
        amount, runId: input.runId, closureVersion: input.closureVersion,
        clientRequestId: input.clientRequestId, remark: input.remark || null, operatorId
      });
    }
    await query(client, `UPDATE wage_calculation_runs SET status='CANCELLED'
      WHERE company_id=:companyId AND project_id=:projectId AND status='PREVIEW'`, params);
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'日结薪资','wage_daily_settlement',:runId,'batch_paid',:afterData)`, {
      companyId, operatorId, runId: input.runId,
      afterData: JSON.stringify({ projectId: input.projectId, shiftDate: input.shiftDate,
        runId: input.runId, employeeIds: input.employeeIds, paidCount: lines.length,
        totalAmount: formatCents(totalCents) })
    });
    return { status: 'PAID', paidCount: lines.length, totalAmount: formatCents(totalCents) };
  });
}

async function revokePayment(companyId, user, operatorId, paymentIdValue, body = {}) {
  const paymentId = positiveId(paymentIdValue);
  const reason = String(body.reason || '').trim().slice(0, 255);
  const clientRequestId = String(body.clientRequestId || '');
  if (!reason) throw createError('撤销日结必须填写原因', 400, 'DAILY_PAYMENT_REMARK_REQUIRED');
  if (!paymentId || !validRequestId(clientRequestId)) {
    throw createError('撤销日结参数无效', 400, 'INVALID_DAILY_PAYMENT');
  }
  return db.transaction(async client => {
    const lookup = await query(client, `SELECT project_id AS projectId,shift_date AS shiftDate FROM wage_daily_payments
      WHERE company_id=:companyId AND id=:paymentId LIMIT 1`, { companyId, paymentId });
    if (!lookup[0]) throw createError('日结记录不存在或无权访问', 404, 'DAILY_PAYMENT_NOT_FOUND');
    const projectId = Number(lookup[0].projectId);
    await assertProject(client, companyId, user, projectId);
    const shiftDate = String(lookup[0].shiftDate).slice(0, 10);
    const replay = await query(client, `SELECT payment_id AS paymentId,amount
      FROM wage_daily_payment_events WHERE company_id=:companyId
        AND client_request_id=:clientRequestId AND action_type='REVOKE' LIMIT 1`, {
      companyId, clientRequestId
    });
    if (replay[0]) {
      if (Number(replay[0].paymentId) !== paymentId) {
        throw createError('请求编号已用于其他日结操作', 409, 'DAILY_REQUEST_CONFLICT');
      }
      return { paymentId, status: 'REVOKED', amount: String(replay[0].amount) };
    }
    const closures = await query(client, `SELECT version_no AS versionNo
      FROM attendance_daily_closures WHERE company_id=:companyId
        AND project_id=:projectId AND shift_date=:shiftDate LIMIT 1 FOR UPDATE`, {
      companyId, projectId, shiftDate
    });
    const payments = await query(client, `SELECT id,employee_id AS employeeId,
        shift_date AS shiftDate,amount,status
      FROM wage_daily_payments WHERE company_id=:companyId
        AND project_id=:projectId AND id=:paymentId LIMIT 1 FOR UPDATE`, {
      companyId, projectId, paymentId
    });
    const payment = payments[0];
    if (!payment || payment.status !== 'PAID') {
      throw createError('该日工资尚未标记为已支付', 409, 'DAILY_PAYMENT_NOT_PAID');
    }
    if (String(payment.shiftDate).slice(0, 10) !== shiftDate) {
      throw createError('日结日期已变化，请刷新', 409, 'WAGE_PREVIEW_STALE');
    }
    await query(client, `UPDATE wage_daily_payments SET status='REVOKED',remark=:reason,
        revoked_by=:operatorId,revoked_at=NOW()
      WHERE company_id=:companyId AND project_id=:projectId AND id=:paymentId AND status='PAID'`, {
      companyId, projectId, paymentId, reason, operatorId
    });
    await query(client, `INSERT INTO wage_daily_payment_events
      (company_id,payment_id,project_id,employee_id,shift_date,action_type,amount,
       run_id,closure_version,client_request_id,remark,operated_by)
      VALUES (:companyId,:paymentId,:projectId,:employeeId,:shiftDate,'REVOKE',:amount,
        NULL,:closureVersion,:clientRequestId,:reason,:operatorId)`, {
      companyId, paymentId, projectId, employeeId: Number(payment.employeeId), shiftDate,
      amount: String(payment.amount), closureVersion: Number(closures[0]?.versionNo || 0),
      clientRequestId, reason, operatorId
    });
    await query(client, `UPDATE wage_calculation_runs SET status='CANCELLED'
      WHERE company_id=:companyId AND project_id=:projectId AND status='PREVIEW'`, {
      companyId, projectId
    });
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'日结薪资','wage_daily_payment',:paymentId,'revoke',:afterData)`, {
      companyId, operatorId, paymentId,
      afterData: JSON.stringify({ paymentId, projectId, shiftDate, status: 'REVOKED' })
    });
    return { paymentId, status: 'REVOKED', amount: String(payment.amount) };
  });
}

async function listPaymentEvents(companyId, user, paymentIdValue) {
  const paymentId = positiveId(paymentIdValue);
  if (!paymentId) throw createError('日结记录不存在或无权访问', 404, 'DAILY_PAYMENT_NOT_FOUND');
  const params = { companyId, paymentId };
  const scope = projectScope(user, params, 'p');
  const payment = await db.query(`SELECT pay.id FROM wage_daily_payments pay
    JOIN labor_project p ON p.id=pay.project_id AND p.company_id=pay.company_id
    WHERE pay.company_id=:companyId AND pay.id=:paymentId${scope} LIMIT 1`, params);
  if (!payment[0]) throw createError('日结记录不存在或无权访问', 404, 'DAILY_PAYMENT_NOT_FOUND');
  const list = await db.query(`SELECT id,action_type AS actionType,amount,
      run_id AS runId,closure_version AS closureVersion,remark,
      operated_by AS operatedBy,operated_at AS operatedAt
    FROM wage_daily_payment_events
    WHERE company_id=:companyId AND payment_id=:paymentId ORDER BY id`, { companyId, paymentId });
  return { list };
}

module.exports = {
  listProjects,
  createDailyPreview, listDailySettlements, confirmBatch, revokePayment, listPaymentEvents
};
