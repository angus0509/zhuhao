const db = require('../db');
const { projectScope } = require('../utils/data-scope');
const { createError } = require('../utils/response');

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

function validatePayProfile(body = {}) {
  const defaultShiftType = String(body.defaultShiftType || '');
  const settlementMode = String(body.settlementMode || '');
  const effectiveFrom = String(body.effectiveFrom || '');
  if (!['DAY', 'NIGHT'].includes(defaultShiftType)
    || !['MONTHLY', 'DAILY_ACCRUAL', 'DAILY_PAID'].includes(settlementMode)
    || !validDate(effectiveFrom)) {
    throw createError('员工计薪设置参数无效', 400, 'INVALID_PAY_PROFILE');
  }
  return { defaultShiftType, settlementMode, effectiveFrom };
}

async function assertProject(client, companyId, user, projectId) {
  const params = { companyId, projectId: positiveId(projectId) };
  const scope = projectScope(user, params, 'p');
  const rows = await query(client, `SELECT p.id FROM labor_project p
    WHERE p.company_id=:companyId AND p.id=:projectId ${scope} LIMIT 1`, params);
  if (!rows[0]) throw createError('项目不存在或无权访问', 403, 'PROJECT_FORBIDDEN');
}

async function assertEmployeeProject(client, companyId, projectId, employeeId, effectiveFrom) {
  const rows = await query(client, `SELECT j.id FROM hr_employee_job j
    WHERE j.company_id=:companyId AND j.project_id=:projectId AND j.employee_id=:employeeId
      AND (j.hire_date IS NULL OR j.hire_date<=:effectiveFrom)
      AND NOT EXISTS (SELECT 1 FROM hr_employee_job newer_j
        WHERE newer_j.company_id=j.company_id AND newer_j.employee_id=j.employee_id
          AND newer_j.hire_date IS NOT NULL AND newer_j.hire_date<=:effectiveFrom
          AND (j.hire_date IS NULL OR newer_j.hire_date>j.hire_date OR
            (newer_j.hire_date=j.hire_date AND newer_j.id>j.id)))
    ORDER BY j.hire_date DESC,j.id DESC LIMIT 1`, { companyId, projectId, employeeId, effectiveFrom });
  if (!rows[0]) throw createError('员工不属于当前项目', 403, 'EMPLOYEE_PROJECT_FORBIDDEN');
}

async function resolvePayProfile(client, companyId, projectId, employeeId, shiftDate) {
  if (!positiveId(projectId) || !positiveId(employeeId) || !validDate(shiftDate)) {
    throw createError('员工计薪查询参数无效', 400, 'INVALID_PAY_PROFILE_QUERY');
  }
  const rows = await query(client, `SELECT id AS profileId,default_shift_type AS defaultShiftType,
      settlement_mode AS settlementMode,effective_from AS effectiveFrom
    FROM employee_pay_profiles
    WHERE company_id=:companyId AND project_id=:projectId AND employee_id=:employeeId
      AND status=1 AND effective_from<=:shiftDate
    ORDER BY effective_from DESC,id DESC LIMIT 1`, { companyId, projectId, employeeId, shiftDate });
  return rows[0] || null;
}

async function savePayProfile(companyId, user, operatorId, projectIdValue, employeeIdValue, body = {}) {
  const projectId = positiveId(projectIdValue);
  const employeeId = positiveId(employeeIdValue);
  const operator = positiveId(operatorId);
  const values = validatePayProfile(body);
  if (!projectId || !employeeId || !operator) throw createError('员工计薪设置参数无效', 400, 'INVALID_PAY_PROFILE');
  return db.transaction(async client => {
    await assertProject(client, companyId, user, projectId);
    await assertEmployeeProject(client, companyId, projectId, employeeId, values.effectiveFrom);
    const existing = await query(client, `SELECT id FROM employee_pay_profiles
      WHERE company_id=:companyId AND project_id=:projectId AND employee_id=:employeeId
        AND effective_from=:effectiveFrom LIMIT 1 FOR UPDATE`, {
      companyId, projectId, employeeId, effectiveFrom: values.effectiveFrom
    });
    if (existing[0]) {
      const confirmed = await query(client, `SELECT 1 AS referenced FROM wage_calculation_daily_lines line
        JOIN wage_calculation_runs run ON run.id=line.run_id AND run.company_id=line.company_id
        WHERE line.company_id=:companyId AND line.project_id=:projectId AND line.employee_id=:employeeId
          AND line.shift_date>=:effectiveFrom AND run.status='CONFIRMED' LIMIT 1`, {
        companyId, projectId, employeeId, effectiveFrom: values.effectiveFrom
      });
      if (confirmed[0]) throw createError('已用于确认工资的计薪设置不可修改，请新增生效版本', 409, 'PAY_PROFILE_IMMUTABLE');
    }
    const result = await query(client, `INSERT INTO employee_pay_profiles
      (company_id,project_id,employee_id,default_shift_type,settlement_mode,effective_from,status,created_by,updated_by)
      VALUES (:companyId,:projectId,:employeeId,:defaultShiftType,:settlementMode,:effectiveFrom,1,:operatorId,:operatorId)
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),default_shift_type=VALUES(default_shift_type),
        settlement_mode=VALUES(settlement_mode),status=1,updated_by=VALUES(updated_by)`, {
      companyId, projectId, employeeId, operatorId: operator, ...values
    });
    const profileId = Number(result.insertId || existing[0]?.id);
    const summary = { profileId, employeeId, projectId, ...values };
    await query(client, `INSERT INTO hr_operation_log
      (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
      VALUES (:companyId,:operatorId,'考勤工资','employee_pay_profile',:profileId,'upsert',:afterData)`, {
      companyId, operatorId: operator, profileId, afterData: JSON.stringify(summary)
    });
    return summary;
  });
}

module.exports = { validatePayProfile, resolvePayProfile, savePayProfile };
