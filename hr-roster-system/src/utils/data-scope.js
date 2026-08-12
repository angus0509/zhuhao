// 统一构造查询数据范围条件。
// 项目授权通过 customer_id 映射员工任职记录；驻厂、工资等项目表则直接按 project_id 过滤。

function scopeParams(user, params) {
  if (!user) return;
  params.scopeUserId = Number(user.id || 0);
  params.scopeCompanyId = Number(user.companyId || params.companyId || 0);
}

function departmentCondition(user, params, column) {
  const deptIds = Array.isArray(user?.scopeDeptIds)
    ? [...new Set(user.scopeDeptIds.map(Number).filter(Number.isInteger).filter(id => id > 0))]
    : [];
  if (!deptIds.length) return '1 = 0';
  const placeholders = deptIds.map((deptId, index) => {
    const key = `scopeDeptId${index}`;
    params[key] = deptId;
    return `:${key}`;
  });
  return `${column} IN (${placeholders.join(', ')})`;
}

function departmentCustomerExists(user, params, customerColumn) {
  const condition = departmentCondition(user, params, 'scope_job.dept_id');
  return `EXISTS (
    SELECT 1 FROM hr_employee_job scope_job
    WHERE scope_job.company_id = :scopeCompanyId
      AND scope_job.customer_id = ${customerColumn}
      AND scope_job.job_status = 1
      AND ${condition}
  )`;
}

function projectScope(user, params, alias = 'p') {
  if (!user || Number(user.dataScope) === 1) return '';
  scopeParams(user, params);
  if (Number(user.dataScope) === 5) {
    return ` AND EXISTS (
      SELECT 1 FROM sys_user_project scope_up
      WHERE scope_up.user_id = :scopeUserId AND scope_up.project_id = ${alias}.id
    )`;
  }
  if ([2, 3].includes(Number(user.dataScope))) {
    return ` AND ${departmentCustomerExists(user, params, `${alias}.customer_id`)}`;
  }
  return ' AND 1 = 0';
}

function customerScope(user, params, alias = 'c') {
  if (!user || Number(user.dataScope) === 1) return '';
  scopeParams(user, params);
  if (Number(user.dataScope) === 5) {
    return ` AND EXISTS (
      SELECT 1 FROM sys_user_project scope_up
      JOIN labor_project scope_project
        ON scope_project.id = scope_up.project_id
       AND scope_project.company_id = :scopeCompanyId
      WHERE scope_up.user_id = :scopeUserId
        AND scope_project.customer_id = ${alias}.id
    )`;
  }
  if ([2, 3].includes(Number(user.dataScope))) {
    return ` AND ${departmentCustomerExists(user, params, `${alias}.id`)}`;
  }
  return ' AND 1 = 0';
}

function employeeScope(user, params, employeeAlias = 'e', jobAlias = 'j') {
  if (!user || Number(user.dataScope) === 1) return '';
  scopeParams(user, params);
  if (Number(user.dataScope) === 4) {
    params.scopeEmployeeId = Number(user.employeeId || 0);
    return ` AND ${employeeAlias}.id = :scopeEmployeeId`;
  }
  if (Number(user.dataScope) === 5) {
    return ` AND (EXISTS (
      SELECT 1 FROM sys_user_project scope_up
      JOIN labor_project scope_project
        ON scope_project.id = scope_up.project_id
       AND scope_project.company_id = :scopeCompanyId
      WHERE scope_up.user_id = :scopeUserId
        AND scope_project.id = ${jobAlias}.project_id
    ) OR (${employeeAlias}.created_by = :scopeUserId AND ${jobAlias}.project_id IS NULL))`;
  }
  if ([2, 3].includes(Number(user.dataScope))) {
    return ` AND ${departmentCondition(user, params, `${jobAlias}.dept_id`)}`;
  }
  return ' AND 1 = 0';
}

// 待办可能指向“目标项目”（如跨项目转岗），不能只按员工当前任职项目过滤。
// 驻厂账号满足目标项目授权或当前任职项目授权任一条件即可看到对应待办。
function workTaskScope(user, params, taskAlias = 't', employeeAlias = 'e', jobAlias = 'j') {
  if (!user || Number(user.dataScope) === 1) return '';
  scopeParams(user, params);
  if (Number(user.dataScope) === 4) {
    params.scopeEmployeeId = Number(user.employeeId || 0);
    return ` AND ${employeeAlias}.id = :scopeEmployeeId`;
  }
  if (Number(user.dataScope) === 5) {
    return ` AND (EXISTS (
      SELECT 1 FROM sys_user_project task_up
      WHERE task_up.user_id = :scopeUserId AND task_up.project_id = ${taskAlias}.project_id
    ) OR EXISTS (
      SELECT 1 FROM sys_user_project job_up
      WHERE job_up.user_id = :scopeUserId AND job_up.project_id = ${jobAlias}.project_id
    ) OR (${employeeAlias}.created_by = :scopeUserId AND ${jobAlias}.project_id IS NULL))`;
  }
  if ([2, 3].includes(Number(user.dataScope))) {
    return ` AND ${departmentCondition(user, params, `${jobAlias}.dept_id`)}`;
  }
  return ' AND 1 = 0';
}

module.exports = { projectScope, customerScope, employeeScope, workTaskScope };
