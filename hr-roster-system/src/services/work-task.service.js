const db = require('../db');
const { createError } = require('../utils/response');
const { workTaskScope } = require('../utils/data-scope');

const TASK_TYPE_NAMES = {
  ARRIVAL: '待确认到岗',
  INSURANCE: '待办理雇主险增保',
  CONTRACT: '待签劳动合同',
  DOCUMENT: '待补员工资料',
  OFFBOARD: '待完成离职交接',
  INSURANCE_TERMINATION: '离职待雇主险减保',
  TRANSFER_ACCEPTANCE: '跨项目转岗待接收'
};

function formatTask(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || '',
    employeeNo: row.employee_no || '',
    customerName: row.customer_name || '',
    targetCustomerName: row.target_customer_name || '',
    targetProjectName: row.target_project_name || '',
    positionName: row.position_name || '',
    taskType: row.task_type,
    sourceId: row.source_id || null,
    taskTypeName: TASK_TYPE_NAMES[row.task_type] || row.task_type,
    taskTitle: row.task_title,
    taskContent: row.task_content || '',
    riskLevel: Number(row.risk_level || 1),
    taskStatus: Number(row.task_status || 0),
    assignedUserId: row.assigned_user_id || null,
    assignedUserName: row.assigned_user_name || '待分配',
    deadline: row.deadline || null,
    overdue: Boolean(row.deadline && Number(row.task_status) < 2 && new Date(row.deadline) < new Date()),
    createdAt: row.created_at
  };
}

async function listTasks(companyId, query, user) {
  const params = {
    companyId,
    taskStatus: query.taskStatus === undefined || query.taskStatus === '' ? null : Number(query.taskStatus),
    taskType: query.taskType || null,
    riskLevel: query.riskLevel ? Number(query.riskLevel) : null
  };
  const scope = workTaskScope(user, params, 't', 'e', 'j');
  const rows = await db.query(
    `SELECT t.*,e.name employee_name,e.employee_no,cu.customer_name,p.position_name,u.real_name assigned_user_name,
            target_project.project_name target_project_name,target_customer.customer_name target_customer_name
     FROM hr_work_task t
     LEFT JOIN hr_employee e ON e.id=t.employee_id AND e.company_id=t.company_id
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.employee_id=e.id AND j2.company_id=e.company_id
       ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
     )
     LEFT JOIN crm_customer cu ON cu.id=j.customer_id AND cu.company_id=e.company_id
     LEFT JOIN hr_position p ON p.id=j.position_id AND p.company_id=e.company_id
     LEFT JOIN sys_user u ON u.id=t.assigned_user_id
     LEFT JOIN labor_project target_project ON target_project.id=t.project_id AND target_project.company_id=t.company_id
     LEFT JOIN crm_customer target_customer ON target_customer.id=target_project.customer_id AND target_customer.company_id=t.company_id
     WHERE t.company_id=:companyId
       AND t.task_type<>'PAYROLL_SETTLEMENT'
       AND (
         (t.task_type='ARRIVAL' AND e.employee_status=1)
         OR (t.task_type IN ('CONTRACT','INSURANCE') AND e.employee_status=2 AND COALESCE(e.lifecycle_status,'')<>'OFFBOARDING')
         OR (t.task_type IN ('OFFBOARD','INSURANCE_TERMINATION') AND e.lifecycle_status='OFFBOARDING')
         OR (t.task_type='DOCUMENT' AND e.employee_status IN (1,2,6))
         OR t.task_type='TRANSFER_ACCEPTANCE'
       )
       AND (:taskStatus IS NULL OR t.task_status=:taskStatus)
       AND (:taskType IS NULL OR t.task_type=:taskType)
       AND (:riskLevel IS NULL OR t.risk_level=:riskLevel)
       ${scope}
     ORDER BY (t.task_status<2 AND t.deadline<NOW()) DESC,t.risk_level DESC,t.deadline IS NULL,t.deadline,t.id DESC
     LIMIT 500`,
    params
  );
  return rows.map(formatTask);
}

async function getScopedTask(companyId, taskId, user) {
  const params = { companyId, taskId };
  const scope = workTaskScope(user, params, 't', 'e', 'j');
  const task = await db.first(
    `SELECT t.* FROM hr_work_task t
     LEFT JOIN hr_employee e ON e.id=t.employee_id AND e.company_id=t.company_id
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.employee_id=e.id AND j2.company_id=e.company_id
       ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
     )
     WHERE t.company_id=:companyId AND t.id=:taskId ${scope} LIMIT 1`,
    params
  );
  if (!task) throw createError('待办不存在或无项目权限', 404);
  return task;
}

async function startTask(companyId, taskId, operatorId, user) {
  const task = await getScopedTask(companyId, taskId, user);
  if (Number(task.task_status) >= 2) throw createError('待办已结束，不能重复处理');
  await db.query(
    `UPDATE hr_work_task SET task_status=1,assigned_user_id=COALESCE(assigned_user_id,:operatorId),updated_at=NOW()
     WHERE company_id=:companyId AND id=:taskId AND task_status=0`,
    { companyId, taskId, operatorId }
  );
  return { taskId, taskStatus: 1 };
}

async function completeTask(companyId, taskId, body, operatorId, user) {
  const task = await getScopedTask(companyId, taskId, user);
  if (Number(task.task_status) >= 2) throw createError('待办已结束，不能重复完成');
  if (['OFFBOARD', 'TRANSFER_ACCEPTANCE'].includes(task.task_type)) {
    throw createError('该待办必须通过对应业务操作完成，不能直接勾选完成');
  }
  if (Number(task.risk_level) === 3) {
    throw createError('高风险待办必须通过投保、退保或对应业务操作完成');
  }
  await db.transaction(async connection => {
    await connection.execute(
      `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=NOW(),updated_at=NOW()
       WHERE company_id=:companyId AND id=:taskId AND task_status IN (0,1)`,
      { companyId, taskId, operatorId }
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'驻厂待办','work_task',:taskId,'complete',:afterData)`,
      { companyId, operatorId, taskId, afterData: JSON.stringify({ remark: body.remark || '' }) }
    );
  });
  return { taskId, taskStatus: 2 };
}

module.exports = { listTasks, startTask, completeTask, TASK_TYPE_NAMES };
