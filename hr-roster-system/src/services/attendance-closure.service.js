const database = require('../db');
const { createError } = require('../utils/response');
const { projectScope } = require('../utils/data-scope');

async function query(client, sql, params) {
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

async function assertProject(client, companyId, user, projectId) {
  const params = { companyId, projectId };
  const scope = projectScope(user, params, 'p');
  const rows = await query(client, `SELECT p.id AS projectId
    FROM labor_project p
    WHERE p.company_id=:companyId AND p.id=:projectId${scope}
    LIMIT 1 FOR UPDATE`, params);
  if (!rows[0]) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
  return rows[0];
}

async function getClosure(client, companyId, projectId, shiftDate, options = {}) {
  const rows = await query(client, `SELECT id,status,version_no AS versionNo,
      confirmed_by AS confirmedBy,confirmed_at AS confirmedAt,
      reopened_by AS reopenedBy,reopened_at AS reopenedAt,reopen_reason AS reopenReason
    FROM attendance_daily_closures
    WHERE company_id=:companyId AND project_id=:projectId AND shift_date=:shiftDate
    LIMIT 1${options.forUpdate ? ' FOR UPDATE' : ''}`, { companyId, projectId, shiftDate });
  return rows[0] || null;
}

async function replayClosureEvent(client, companyId, clientRequestId, expected) {
  const rows = await query(client, `SELECT action_type AS actionType,project_id AS projectId,
      shift_date AS shiftDate,version_no AS versionNo
    FROM attendance_daily_closure_events
    WHERE company_id=:companyId AND client_request_id=:clientRequestId LIMIT 1`, {
    companyId,
    clientRequestId
  });
  if (!rows[0]) return null;
  if (Number(rows[0].projectId) !== expected.projectId
    || String(rows[0].shiftDate).slice(0, 10) !== expected.shiftDate
    || rows[0].actionType !== expected.actionType) {
    throw createError('请求编号已用于其他考勤操作', 409, 'ATTENDANCE_REQUEST_CONFLICT');
  }
  return {
    projectId: Number(rows[0].projectId),
    shiftDate: String(rows[0].shiftDate).slice(0, 10),
    status: rows[0].actionType === 'CONFIRM' ? 'CONFIRMED' : 'OPEN',
    versionNo: Number(rows[0].versionNo)
  };
}

async function ensureClosure(client, companyId, projectId, shiftDate) {
  const existing = await getClosure(client, companyId, projectId, shiftDate, { forUpdate: true });
  if (existing) return existing;
  const inserted = await query(client, `INSERT INTO attendance_daily_closures
    (company_id,project_id,shift_date,status,version_no)
    VALUES (:companyId,:projectId,:shiftDate,'OPEN',0)`, { companyId, projectId, shiftDate });
  return { id: Number(inserted.insertId), status: 'OPEN', versionNo: 0 };
}

async function pendingAttendanceCount(client, companyId, projectId, shiftDate) {
  const rows = await query(client, `SELECT (
      (SELECT COUNT(*) FROM attendance_correction_requests c
        LEFT JOIN attendance_punches cp ON cp.id=c.punch_id AND cp.company_id=c.company_id
        LEFT JOIN attendance_daily_results cd ON cd.company_id=c.company_id
          AND cd.employee_id=c.employee_id AND cd.shift_date=c.shift_date
        WHERE c.company_id=:companyId AND c.shift_date=:shiftDate AND c.status='PENDING'
          AND COALESCE(cp.project_id,cd.project_id)=:projectId)
      + (SELECT COUNT(*) FROM attendance_daily_results d
        WHERE d.company_id=:companyId AND d.project_id=:projectId AND d.shift_date=:shiftDate
          AND d.review_status<>'APPROVED'
          AND (d.result_status='MISSING_PUNCH' OR EXISTS (
            SELECT 1 FROM attendance_punches p
            WHERE p.company_id=d.company_id AND p.project_id=d.project_id
              AND p.employee_id=d.employee_id AND p.shift_date=d.shift_date
              AND p.geofence_status IN ('OUTSIDE','LOW_ACCURACY','LOCATION_FAILED')
          )))
      + (SELECT COUNT(*) FROM attendance_schedules s
        LEFT JOIN attendance_shift_rules sr ON sr.id=s.shift_rule_id AND sr.company_id=s.company_id
        LEFT JOIN attendance_project_rules pr ON pr.id=s.project_rule_id AND pr.company_id=s.company_id
        LEFT JOIN attendance_project_shift_rules psr ON psr.id=s.project_shift_rule_id AND psr.company_id=s.company_id
        WHERE s.company_id=:companyId AND s.project_id=:projectId AND s.shift_date=:shiftDate
          AND s.schedule_status='WORK'
          AND DATE_ADD(TIMESTAMP(s.shift_date,COALESCE(sr.work_end_time,psr.work_end_time,pr.work_end_time)),
            INTERVAL IF(COALESCE(sr.work_end_time,psr.work_end_time,pr.work_end_time)
              <=COALESCE(sr.work_start_time,psr.work_start_time,pr.work_start_time),1,0) DAY) > NOW())
    ) AS pendingCount`, { companyId, projectId, shiftDate });
  return Number(rows[0]?.pendingCount || 0);
}

async function appendClosureEvent(client, values) {
  await query(client, `INSERT INTO attendance_daily_closure_events
    (company_id,closure_id,project_id,shift_date,action_type,version_no,client_request_id,reason,operated_by)
    VALUES (:companyId,:closureId,:projectId,:shiftDate,:actionType,:versionNo,:clientRequestId,:reason,:operatorId)`, values);
  await query(client, `UPDATE wage_calculation_runs SET status='CANCELLED'
    WHERE company_id=:companyId AND project_id=:projectId AND status='PREVIEW'`, values);
  await query(client, `INSERT INTO hr_operation_log
    (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
    VALUES (:companyId,:operatorId,'考勤管理','attendance_daily_closure',:closureId,:logAction,:afterData)`, {
    ...values,
    logAction: values.actionType === 'CONFIRM' ? 'confirm' : 'reopen',
    afterData: JSON.stringify({
      projectId: values.projectId,
      shiftDate: values.shiftDate,
      status: values.actionType === 'CONFIRM' ? 'CONFIRMED' : 'OPEN',
      versionNo: values.versionNo
    })
  });
}

function closureInput(body) {
  const projectId = positiveId(body.projectId);
  const shiftDate = String(body.shiftDate || '');
  const clientRequestId = String(body.clientRequestId || '');
  if (!projectId || !validDate(shiftDate)) {
    throw createError('项目或日期参数无效', 400, 'INVALID_ATTENDANCE_CLOSURE');
  }
  if (!validRequestId(clientRequestId)) {
    throw createError('缺少有效的请求编号', 400, 'INVALID_REQUEST_ID');
  }
  return { projectId, shiftDate, clientRequestId };
}

async function confirmDailyClosure(companyId, user, operatorId, body = {}) {
  const values = closureInput(body);
  return database.transaction(async client => {
    await assertProject(client, companyId, user, values.projectId);
    const replay = await replayClosureEvent(client, companyId, values.clientRequestId, {
      ...values, actionType: 'CONFIRM'
    });
    if (replay) return replay;
    const closure = await ensureClosure(client, companyId, values.projectId, values.shiftDate);
    if (await pendingAttendanceCount(client, companyId, values.projectId, values.shiftDate)) {
      throw createError('仍有考勤异常、待审核申请或未结束班次', 409, 'ATTENDANCE_PENDING');
    }
    const versionNo = Number(closure.versionNo || 0) + 1;
    await query(client, `UPDATE attendance_daily_closures
      SET status='CONFIRMED',version_no=:versionNo,confirmed_by=:operatorId,confirmed_at=NOW(),
        reopened_by=NULL,reopened_at=NULL,reopen_reason=NULL
      WHERE id=:closureId AND company_id=:companyId`, {
      companyId, operatorId, closureId: closure.id, versionNo
    });
    await appendClosureEvent(client, {
      companyId, operatorId, closureId: closure.id, versionNo,
      actionType: 'CONFIRM', reason: null, ...values
    });
    return { projectId: values.projectId, shiftDate: values.shiftDate, status: 'CONFIRMED', versionNo };
  });
}

async function reopenDailyClosure(companyId, user, operatorId, body = {}) {
  const values = closureInput(body);
  const reason = String(body.reason || '').trim().slice(0, 255);
  if (!reason) throw createError('重新打开考勤必须填写原因', 400, 'REOPEN_REASON_REQUIRED');
  return database.transaction(async client => {
    await assertProject(client, companyId, user, values.projectId);
    const replay = await replayClosureEvent(client, companyId, values.clientRequestId, {
      ...values, actionType: 'REOPEN'
    });
    if (replay) return replay;
    const closure = await ensureClosure(client, companyId, values.projectId, values.shiftDate);
    if (closure.status !== 'CONFIRMED') {
      throw createError('该考勤日尚未确认', 409, 'ATTENDANCE_NOT_CONFIRMED');
    }
    const paymentRows = await query(client, `SELECT COUNT(*) AS paidCount FROM wage_daily_payments
      WHERE company_id=:companyId AND project_id=:projectId AND shift_date=:shiftDate AND status='PAID'`, {
      companyId,
      projectId: values.projectId,
      shiftDate: values.shiftDate
    });
    if (Number(paymentRows[0]?.paidCount || 0) > 0) {
      throw createError('该日存在已支付日结，请先撤销支付登记', 409, 'DAILY_PAYMENT_ACTIVE');
    }
    const versionNo = Number(closure.versionNo || 0) + 1;
    await query(client, `UPDATE attendance_daily_closures
      SET status='OPEN',version_no=:versionNo,reopened_by=:operatorId,reopened_at=NOW(),reopen_reason=:reason
      WHERE id=:closureId AND company_id=:companyId`, {
      companyId, operatorId, closureId: closure.id, versionNo, reason
    });
    await appendClosureEvent(client, {
      companyId, operatorId, closureId: closure.id, versionNo,
      actionType: 'REOPEN', reason, ...values
    });
    return { projectId: values.projectId, shiftDate: values.shiftDate, status: 'OPEN', versionNo };
  });
}

async function reviewDailyException(companyId, user, operatorId, resultIdValue, body = {}) {
  const resultId = positiveId(resultIdValue);
  const clientRequestId = String(body.clientRequestId || '');
  const reviewComment = String(body.reviewComment || '').trim().slice(0, 255);
  if (!resultId || body.action !== 'CONFIRM_EXCEPTION' || !reviewComment) {
    throw createError('异常核实信息不完整', 400, 'INVALID_EXCEPTION_REVIEW');
  }
  if (!validRequestId(clientRequestId)) {
    throw createError('缺少有效的请求编号', 400, 'INVALID_REQUEST_ID');
  }
  return database.transaction(async client => {
    const replayRows = await query(client, `SELECT daily_result_id AS dailyResultId,
        project_id AS projectId,action_type AS actionType,result_status AS resultStatus
      FROM attendance_daily_review_events
      WHERE company_id=:companyId AND client_request_id=:clientRequestId LIMIT 1`, {
      companyId,
      clientRequestId
    });
    if (replayRows[0]) {
      await assertProject(client, companyId, user, Number(replayRows[0].projectId));
      if (Number(replayRows[0].dailyResultId) !== resultId
        || replayRows[0].actionType !== 'CONFIRM_EXCEPTION') {
        throw createError('请求编号已用于其他考勤操作', 409, 'ATTENDANCE_REQUEST_CONFLICT');
      }
      return {
        id: Number(replayRows[0].dailyResultId),
        resultStatus: replayRows[0].resultStatus,
        reviewStatus: 'APPROVED'
      };
    }
    const params = { companyId, resultId };
    const scope = projectScope(user, params, 'p');
    const rows = await query(client, `SELECT d.id,d.project_id AS projectId,d.employee_id AS employeeId,
        d.shift_date AS shiftDate,d.result_status AS resultStatus,
        EXISTS (SELECT 1 FROM attendance_punches punch
          WHERE punch.company_id=d.company_id AND punch.project_id=d.project_id
            AND punch.employee_id=d.employee_id AND punch.shift_date=d.shift_date
            AND punch.geofence_status IN ('OUTSIDE','LOW_ACCURACY','LOCATION_FAILED')) AS hasGeofenceException
      FROM attendance_daily_results d
      JOIN labor_project p ON p.id=d.project_id AND p.company_id=d.company_id
      WHERE d.company_id=:companyId AND d.id=:resultId${scope}
      LIMIT 1 FOR UPDATE`, params);
    const result = rows[0];
    if (!result) throw createError('考勤结果不存在或无权访问', 403, 'ATTENDANCE_RESULT_FORBIDDEN');
    if (result.resultStatus !== 'MISSING_PUNCH' && !Number(result.hasGeofenceException)) {
      throw createError('该考勤结果没有可核实异常', 409, 'ATTENDANCE_EXCEPTION_NOT_FOUND');
    }
    await query(client, `UPDATE attendance_daily_results
      SET review_status='APPROVED',reviewed_by=:operatorId,reviewed_at=NOW()
      WHERE id=:resultId AND company_id=:companyId`, { companyId, resultId, operatorId });
    await query(client, `INSERT INTO attendance_daily_review_events
      (company_id,daily_result_id,project_id,employee_id,shift_date,action_type,result_status,
       client_request_id,review_comment,operated_by)
      VALUES (:companyId,:resultId,:projectId,:employeeId,:shiftDate,'CONFIRM_EXCEPTION',:resultStatus,
        :clientRequestId,:reviewComment,:operatorId)`, {
      companyId,
      resultId,
      projectId: Number(result.projectId),
      employeeId: Number(result.employeeId),
      shiftDate: String(result.shiftDate).slice(0, 10),
      resultStatus: result.resultStatus,
      clientRequestId,
      reviewComment,
      operatorId
    });
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'考勤管理','attendance_daily_result',:resultId,'confirm_exception',:afterData)`, {
      companyId,
      operatorId,
      resultId,
      afterData: JSON.stringify({
        projectId: Number(result.projectId),
        dailyResultId: resultId,
        resultStatus: result.resultStatus,
        reviewStatus: 'APPROVED'
      })
    });
    return { id: resultId, resultStatus: result.resultStatus, reviewStatus: 'APPROVED' };
  });
}

module.exports = {
  confirmDailyClosure,
  reopenDailyClosure,
  reviewDailyException,
  getClosure,
  positiveId,
  validDate,
  validRequestId
};
