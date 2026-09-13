const db = require('../db');
const { createError } = require('../utils/response');
const { encrypt, sha256 } = require('../utils/crypto');
const { maskPhone } = require('../utils/mask');
const { customerScope, employeeScope, projectScope } = require('../utils/data-scope');
const operationsService = require('./operations.service');
const { assertEmployeeScope } = require('./employee.service');
const { dictionaries } = require('../utils/dictionaries');

const serviceTypeNames = { 1: '劳务派遣', 2: '岗位外包', 3: '灵活用工', 4: 'RPO招聘' };
const employmentTypeNames = { 1: '全职', 2: '兼职', 3: '劳务', 4: '实习', 5: '外包', 6: '派遣' };
const riskTypeNames = { 1: '未签合同', 2: '合同到期', 3: '社保异常', 4: '证件过期', 5: '特殊工种', 6: '离职流程', 7: '雇主险异常' };
const clientRequestTypeNames = { 1: '员工增员', 2: '员工减员', 3: '资料补充', 4: '账单确认', 5: '发票事项', 6: '其他服务' };
const clientRequestStatusNames = { 0: '待受理', 1: '处理中', 2: '待客户反馈', 3: '已完成' };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function listClients(companyId, user) {
  const params = { companyId };
  return db.query(
    `SELECT c.id, c.customer_name clientName, c.contact_name contactName, c.contact_phone contactPhone,
      COALESCE(c.remark,'月结30天') settlementCycle,
      COUNT(DISTINCT p.id) projectCount,
      COUNT(DISTINCT CASE WHEN p.status = 2 THEN p.id END) effectiveProjectCount,
      COUNT(DISTINCT CASE WHEN fs.onsite_status = 2 THEN fs.employee_id END) activeCount
     FROM crm_customer c
     LEFT JOIN labor_project p ON p.customer_id = c.id AND p.company_id = c.company_id
     LEFT JOIN factory_staff fs ON fs.project_id = p.id AND fs.company_id = c.company_id
     WHERE c.company_id = :companyId ${customerScope(user, params, 'c')} GROUP BY c.id ORDER BY c.id DESC`,
    params
  );
}

async function createClient(companyId, body, operatorId = 0, user = null) {
  const result = await operationsService.createCustomer(companyId, {
    ...body,
    customerName: body.clientName || body.customerName
  }, operatorId, user);
  return { ...result, clientId: result.customerId };
}

async function assertCustomerAccess(companyId, customerId, user) {
  const params = { companyId, customerId: Number(customerId) };
  const customer = await db.first(
    `SELECT c.id FROM crm_customer c
     WHERE c.company_id=:companyId AND c.id=:customerId AND c.status=1
       ${customerScope(user, params, 'c')} LIMIT 1`,
    params
  );
  if (!customer) throw createError('客户单位不存在或无数据权限', 403);
  return customer;
}

async function assertProjectAccess(companyId, projectId, customerId, user) {
  const params = { companyId, projectId: Number(projectId), customerId: Number(customerId) };
  const project = await db.first(
    `SELECT p.id FROM labor_project p
     WHERE p.company_id=:companyId AND p.id=:projectId AND p.customer_id=:customerId
       ${projectScope(user, params, 'p')} LIMIT 1`,
    params
  );
  if (!project) throw createError('项目不存在、不属于该客户或无数据权限', 403);
  return project;
}

async function listClientServices(companyId, query = {}, user) {
  const status = query.status === '' || query.status === undefined ? null : Number(query.status);
  if (status !== null && ![0, 1, 2, 3].includes(status)) throw createError('工单状态不正确');
  const params = { companyId, status };
  const stripAnd = value => String(value || '').replace(/^\s*AND\s+/, '');
  const scope = user && Number(user.dataScope) === 5
    ? `${stripAnd(projectScope(user, params, 'p'))} OR ${stripAnd(customerScope(user, params, 'c'))}`
    : stripAnd(customerScope(user, params, 'c'));
  const rows = await db.query(
    `SELECT r.*, c.customer_name, p.project_name, e.name employee_name, e.employee_no
     FROM client_service_request r
     JOIN crm_customer c ON c.id=r.customer_id AND c.company_id=r.company_id
     LEFT JOIN labor_project p ON p.id=r.project_id AND p.company_id=r.company_id
     LEFT JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
     WHERE r.company_id=:companyId AND (:status IS NULL OR r.status=:status)
       AND (${scope || '1=1'})
     ORDER BY r.status ASC, r.deadline ASC, r.id DESC`,
    params
  );
  return rows.map(row => ({
    id: row.id,
    requestNo: row.request_no,
    customerId: row.customer_id,
    customerName: row.customer_name,
    projectId: row.project_id || '',
    projectName: row.project_name || '未关联项目',
    employeeId: row.employee_id || '',
    employeeName: row.employee_name || '',
    employeeNo: row.employee_no || '',
    requestType: row.request_type,
    requestTypeName: clientRequestTypeNames[row.request_type] || '其他服务',
    requestDate: row.request_date,
    deadline: row.deadline,
    description: row.description,
    ownerName: row.owner_name,
    status: row.status,
    statusName: clientRequestStatusNames[row.status] || '未知',
    overdue: Number(row.status) !== 3 && row.deadline < new Date().toISOString().slice(0, 10),
    createdAt: row.created_at
  }));
}

async function createClientService(companyId, body, operatorId, user) {
  if (!body.customerId || !body.requestType || !body.requestDate || !body.deadline || !body.ownerName || !body.description) {
    throw createError('请完整填写客户单位、事项类型、日期、负责人和事项说明');
  }
  if (body.deadline < body.requestDate) throw createError('完成日期不能早于提交日期');
  await assertCustomerAccess(companyId, Number(body.customerId), user);
  if (body.projectId) {
    await assertProjectAccess(companyId, Number(body.projectId), Number(body.customerId), user);
  }
  if (body.employeeId) {
    await assertEmployeeScope(companyId, Number(body.employeeId), user);
    const employee = await db.first(
      `SELECT j.customer_id customerId,j.project_id projectId
       FROM hr_employee e
       LEFT JOIN hr_employee_job j ON j.id=(SELECT j2.id FROM hr_employee_job j2
         WHERE j2.company_id=e.company_id AND j2.employee_id=e.id
         ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1)
       WHERE e.company_id=:companyId AND e.id=:employeeId AND e.deleted_at IS NULL`,
      { companyId, employeeId: Number(body.employeeId) }
    );
    if (!employee || Number(employee.customerId) !== Number(body.customerId)) {
      throw createError('所选员工不属于该客户单位');
    }
    if (body.projectId && Number(employee.projectId || 0) !== Number(body.projectId)) {
      throw createError('所选员工不属于该项目');
    }
  }
  const requestNo = `FW${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(Date.now()).slice(-6)}`;
  const result = await db.query(
    `INSERT INTO client_service_request
     (company_id,request_no,customer_id,project_id,employee_id,request_type,request_date,deadline,description,owner_name,status,created_by)
     VALUES (:companyId,:requestNo,:customerId,:projectId,:employeeId,:requestType,:requestDate,:deadline,:description,:ownerName,0,:operatorId)`,
    {
      companyId,
      requestNo,
      customerId: Number(body.customerId),
      projectId: body.projectId ? Number(body.projectId) : null,
      employeeId: body.employeeId ? Number(body.employeeId) : null,
      requestType: Number(body.requestType),
      requestDate: body.requestDate,
      deadline: body.deadline,
      description: String(body.description).trim(),
      ownerName: String(body.ownerName).trim(),
      operatorId: operatorId || null
    }
  );
  return { requestId: result.insertId, requestNo };
}

async function updateClientServiceStatus(companyId, requestId, body, user) {
  const status = Number(body.status);
  if (![1, 2, 3].includes(status)) throw createError('工单状态不正确');
  const current = await db.first(
    `SELECT id,customer_id customerId,project_id projectId,employee_id employeeId
     FROM client_service_request WHERE company_id=:companyId AND id=:requestId LIMIT 1`,
    { companyId, requestId }
  );
  if (!current) throw createError('客户交付工单不存在', 404);
  await assertCustomerAccess(companyId, Number(current.customerId), user);
  if (current.projectId) {
    await assertProjectAccess(companyId, Number(current.projectId), Number(current.customerId), user);
  }
  if (current.employeeId) await assertEmployeeScope(companyId, Number(current.employeeId), user);
  const result = await db.query(
    `UPDATE client_service_request SET status=:status,
     completed_at=CASE WHEN :status=3 THEN NOW() ELSE NULL END, updated_at=NOW()
     WHERE company_id=:companyId AND id=:requestId`,
    { companyId, requestId, status }
  );
  if (!result.affectedRows) throw createError('客户交付工单不存在', 404);
  return { requestId, status };
}

async function listTalents(companyId, user, query = {}) {
  const keyword = String(query.keyword || '').trim().slice(0, 80);
  const keywordHash = /^\d{17}[\dXx]$/.test(keyword) ? sha256(keyword.toUpperCase()) : '';
  const params = { companyId, scopeUserId: Number(user?.id || 0), keyword: `%${keyword}%`, keywordHash };
  const linkedEmployeeScope = !user || Number(user.dataScope) === 1
    ? ''
    : employeeScope(user, params, 'e', 'j').replace(/^\s*AND\s+/i, '');
  const scopeCondition = linkedEmployeeScope
    ? `AND (t.owner_user_id=:scopeUserId OR (t.employee_id IS NOT NULL AND ${linkedEmployeeScope}))`
    : '';
  const rows = await db.query(
    `SELECT t.*,u.real_name owner_name,e.employee_status,e.lifecycle_status,
            j.fee_mode,j.employment_type,j.hire_date,
            c.customer_name,pj.project_name,pos.position_name,
            COALESCE(rc.channel_name,t.source_channel) recruitment_channel_name
     FROM talent_candidate t
     LEFT JOIN sys_user u ON u.id = t.owner_user_id
     LEFT JOIN hr_employee e ON e.id=t.employee_id AND e.company_id=t.company_id AND e.deleted_at IS NULL
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.company_id=t.company_id AND j2.employee_id=t.employee_id
       ORDER BY j2.id DESC LIMIT 1
     )
     LEFT JOIN crm_customer c ON c.id=COALESCE(t.customer_id,j.customer_id) AND c.company_id=t.company_id
     LEFT JOIN labor_project pj ON pj.id=COALESCE(t.project_id,j.project_id) AND pj.company_id=t.company_id
     LEFT JOIN hr_position pos ON pos.id=COALESCE(t.position_id,j.position_id) AND pos.company_id=t.company_id
     LEFT JOIN hr_recruitment_channel rc ON rc.id=COALESCE(t.recruitment_channel_id,e.recruitment_channel_id) AND rc.company_id=t.company_id
     WHERE t.company_id = :companyId
       AND (:keyword = '%%' OR t.name LIKE :keyword OR t.phone LIKE :keyword
            OR (:keywordHash <> '' AND t.id_card_hash = :keywordHash))
       ${scopeCondition}
     ORDER BY t.id DESC`, params
  );
  const statusNames = { 1: '待联系', 2: '跟进中', 3: '待入职', 4: '已入职', 5: '已淘汰' };
  const sourceTypeNames = { MANUAL: '手工录入', INTERVIEW: '面试登记', INTERVIEW_REJECTED: '面试未通过', UNJOINED: '未入职回流', RESIGNED: '离职回流' };
  const employeeStatusNames = { 1: '待入职', 2: '在职', 3: '离职', 4: '黑名单', 5: '未入职', 6: '面试' };
  const availableStatusNames = { 1: '可联系', 2: '暂不考虑', 3: '已重新入职' };
  return rows.map(row => ({
    id: row.id, name: row.name, phone: maskPhone(row.phone), source: row.source_channel || '',
    intentionJob: row.intended_position || '', tags: row.remark ? row.remark.split(/[，,]/).filter(Boolean) : [],
    followStatus: statusNames[row.candidate_status] || '待联系', ownerName: row.owner_name || '企业管理员',
    employeeId: row.employee_id || null,
    lifecycleStatus: row.lifecycle_status || '',
    customerId: row.customer_id || null,
    projectId: row.project_id || null,
    positionId: row.position_id || null,
    talentSourceType: row.talent_source_type || 'MANUAL',
    talentSourceTypeName: sourceTypeNames[row.talent_source_type] || '手工录入',
    customerName: row.customer_name || '未关联客户',
    projectName: row.project_name || '未关联项目',
    positionName: row.position_name || row.intended_position || '未填写岗位',
    recruitmentChannelName: row.recruitment_channel_name || row.source_channel || '未填写渠道',
    employeeStatus: row.employee_status ?? row.employee_status_snapshot ?? null,
    employeeStatusName: employeeStatusNames[row.employee_status ?? row.employee_status_snapshot] || '未转员工',
    availableStatus: Number(row.available_status || 1),
    availableStatusName: availableStatusNames[row.available_status] || '可联系',
    feeMode: row.fee_mode || '',
    employmentTypeName: employmentTypeNames[row.employment_type] || '',
    hireDate: row.hire_date || '',
    resignedAt: row.resigned_at || '',
    resignationReason: row.resignation_reason || '',
    flowedAt: row.flowed_at || row.updated_at || row.created_at
  }));
}

async function createTalent(companyId, body, operatorId) {
  if (!body.name || !body.phone) throw createError('姓名和手机号不能为空');
  if (!/^1[3-9]\d{9}$/.test(body.phone)) throw createError('手机号格式不正确');
  if (body.idCardNo) {
    const blacklisted = await db.first('SELECT blacklist_reason FROM person_blacklist WHERE company_id=:companyId AND id_card_hash=:idCardHash AND status=1', { companyId, idCardHash: sha256(body.idCardNo) });
    if (blacklisted) throw createError(`该人员命中全公司黑名单：${blacklisted.blacklist_reason}`);
  }
  const statusMap = { 待联系: 1, 跟进中: 2, 已面试: 2, 待入职: 3, 已入职: 4, 已淘汰: 5 };
  const result = await db.query(
    `INSERT INTO talent_candidate
     (company_id,name,id_card_no,id_card_hash,phone,intended_position,source_channel,candidate_status,
      talent_source_type,available_status,flowed_at,owner_user_id,remark)
     VALUES (:companyId,:name,:idCardNo,:idCardHash,:phone,:position,:source,:status,
      'MANUAL',1,NOW(),:ownerId,:remark)`,
    {
      companyId, name: body.name, idCardNo: body.idCardNo ? encrypt(body.idCardNo) : null,
      idCardHash: body.idCardNo ? sha256(body.idCardNo) : null, phone: body.phone,
      position: body.intentionJob || body.intendedPosition || null, source: body.source || body.sourceChannel || null,
      status: statusMap[body.followStatus] || 1, ownerId: operatorId || null, remark: body.tags || body.remark || null
    }
  );
  return { talentId: result.insertId };
}

async function employmentRecords(companyId, user) {
  const params = { companyId };
  return db.query(
    `SELECT j.id, e.name employeeName, e.employee_no employeeNo, d.dept_name departmentName,
      p.position_name positionName, j.hire_date hireDate,
      CASE WHEN j.job_status=1 THEN '当前用工' ELSE '历史记录' END statusName
     FROM hr_employee_job j JOIN hr_employee e ON e.id=j.employee_id AND e.company_id=j.company_id
     LEFT JOIN hr_department d ON d.id=j.dept_id LEFT JOIN hr_position p ON p.id=j.position_id
     WHERE j.company_id=:companyId ${employeeScope(user, params, 'e', 'j')} ORDER BY j.id DESC`, params
  );
}

function auditLogScope(user, params) {
  if (!user || Number(user.dataScope) === 1) return '';
  params.auditUserId = Number(user.id || 0);
  const employeeFilter = employeeScope(user, params, 'audit_e', 'audit_j');
  const projectFilter = projectScope(user, params, 'audit_p');
  const employeeJoin = `JOIN hr_employee audit_e ON audit_e.company_id=l.company_id
    LEFT JOIN hr_employee_job audit_j ON audit_j.id=(SELECT audit_j2.id FROM hr_employee_job audit_j2
      WHERE audit_j2.company_id=audit_e.company_id AND audit_j2.employee_id=audit_e.id
      ORDER BY (audit_j2.job_status=1) DESC,audit_j2.id DESC LIMIT 1)`;
  return ` AND (
    l.operator_id=:auditUserId
    OR (l.biz_type IN ('employee','onboarding_compliance') AND EXISTS (
      SELECT 1 FROM hr_employee audit_e
      LEFT JOIN hr_employee_job audit_j ON audit_j.id=(SELECT audit_j2.id FROM hr_employee_job audit_j2
        WHERE audit_j2.company_id=audit_e.company_id AND audit_j2.employee_id=audit_e.id
        ORDER BY (audit_j2.job_status=1) DESC,audit_j2.id DESC LIMIT 1)
      WHERE audit_e.company_id=l.company_id AND audit_e.id=l.biz_id${employeeFilter}
    ))
    OR (l.biz_type='salary_advance' AND EXISTS (
      SELECT 1 FROM salary_advance audit_advance ${employeeJoin}
      WHERE audit_advance.company_id=l.company_id AND audit_advance.id=l.biz_id
        AND audit_e.id=audit_advance.employee_id${employeeFilter}
    ))
    OR (l.biz_type='work_task' AND EXISTS (
      SELECT 1 FROM hr_work_task audit_task ${employeeJoin}
      WHERE audit_task.company_id=l.company_id AND audit_task.id=l.biz_id
        AND audit_e.id=audit_task.employee_id${employeeFilter}
    ))
    OR (l.biz_type='attachment' AND EXISTS (
      SELECT 1 FROM hr_attachment audit_attachment ${employeeJoin}
      WHERE audit_attachment.company_id=l.company_id AND audit_attachment.id=l.biz_id
        AND audit_e.id=audit_attachment.employee_id${employeeFilter}
    ))
    OR (l.biz_type='risk_case' AND EXISTS (
      SELECT 1 FROM hr_risk_case audit_case
      JOIN hr_risk_alert audit_risk ON audit_risk.id=audit_case.source_alert_id AND audit_risk.company_id=audit_case.company_id
      ${employeeJoin}
      WHERE audit_case.company_id=l.company_id AND audit_case.id=l.biz_id
        AND audit_e.id=audit_risk.employee_id${employeeFilter}
    ))
    OR (l.biz_type IN ('salary_batch','project_onsite_assignment') AND EXISTS (
      SELECT 1 FROM labor_project audit_p
      LEFT JOIN salary_batch audit_batch ON audit_batch.project_id=audit_p.id AND audit_batch.company_id=audit_p.company_id
      WHERE audit_p.company_id=l.company_id
        AND ((l.biz_type='salary_batch' AND audit_batch.id=l.biz_id)
          OR (l.biz_type='project_onsite_assignment' AND audit_p.id=l.biz_id))${projectFilter}
    ))
    OR (l.biz_type='salary_detail' AND EXISTS (
      SELECT 1 FROM salary_detail audit_detail
      JOIN salary_batch audit_batch ON audit_batch.id=audit_detail.batch_id AND audit_batch.company_id=audit_detail.company_id
      JOIN labor_project audit_p ON audit_p.id=audit_batch.project_id AND audit_p.company_id=audit_batch.company_id
      WHERE audit_detail.company_id=l.company_id AND audit_detail.id=l.biz_id${projectFilter}
    ))
    OR (l.biz_type='salary_dispute' AND EXISTS (
      SELECT 1 FROM salary_dispute audit_dispute
      JOIN salary_detail audit_detail ON audit_detail.id=audit_dispute.salary_detail_id AND audit_detail.company_id=audit_dispute.company_id
      JOIN salary_batch audit_batch ON audit_batch.id=audit_detail.batch_id AND audit_batch.company_id=audit_detail.company_id
      JOIN labor_project audit_p ON audit_p.id=audit_batch.project_id AND audit_p.company_id=audit_batch.company_id
      WHERE audit_dispute.company_id=l.company_id AND audit_dispute.id=l.biz_id${projectFilter}
    ))
  )`;
}

const AUDIT_DETAIL_NOISE_KEYS = new Set(['fileSha256', 'userAgent', 'ipAddress', 'deviceInfo', 'signatureSha256']);

function formatAuditDetail(afterData) {
  if (!afterData) return '';
  let data = afterData;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (_error) { return afterData; }
  }
  if (Array.isArray(data)) {
    return data.map(item => (item && typeof item === 'object') ? JSON.stringify(item) : String(item)).join('；');
  }
  if (data === null || typeof data !== 'object') return String(data);
  return Object.entries(data)
    .filter(([key, value]) => value != null && value !== '' && !AUDIT_DETAIL_NOISE_KEYS.has(key))
    .map(([key, value]) => `${key}=${(value && typeof value === 'object') ? JSON.stringify(value) : String(value)}`)
    .join('；');
}

async function auditLogs(companyId, user) {
  const params = { companyId };
  const scope = auditLogScope(user, params);
  const rows = await db.query(
    `SELECT l.id, l.module_name moduleName, l.action_type actionType, l.biz_id bizId,
      l.after_data afterData, l.created_at createdAt,
      COALESCE(NULLIF(u.real_name,''), u.username, '系统管理员') operatorName
     FROM hr_operation_log l
     LEFT JOIN sys_user u ON u.id=l.operator_id
     WHERE l.company_id=:companyId${scope} ORDER BY l.id DESC LIMIT 200`, params
  );
  return rows.map(row => ({
    ...row,
    operatorName: row.operatorName || '系统管理员',
    actionName: dictionaries.actionType[row.actionType] || row.actionType,
    detail: formatAuditDetail(row.afterData)
  }));
}

async function dashboard(companyId, user) {
  const params = { companyId };
  const employeeFilter = employeeScope(user, params, 'e', 'j');
  const customerFilter = customerScope(user, params, 'c');
  const [employeeCounts, customers, employment, compliance, risks, trend, suppliers] = await Promise.all([
    db.first(`SELECT COUNT(*) employeeTotal, SUM(employee_status=2) activeTotal, SUM(employee_status=1) pendingOnboardTotal
      FROM hr_employee e
      LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
      WHERE e.company_id=:companyId AND e.deleted_at IS NULL ${employeeFilter}`, params),
    db.query(`SELECT c.customer_name name, COUNT(e.id) value FROM crm_customer c
      LEFT JOIN hr_employee_job j ON j.customer_id=c.id AND j.company_id=c.company_id AND j.job_status=1
      LEFT JOIN hr_employee e ON e.id=j.employee_id AND e.employee_status=2 AND e.deleted_at IS NULL
      WHERE c.company_id=:companyId AND c.status=1 ${customerFilter} GROUP BY c.id ORDER BY value DESC`, params),
    db.query(`SELECT j.employment_type type, COUNT(*) value FROM hr_employee_job j JOIN hr_employee e ON e.id=j.employee_id
      WHERE j.company_id=:companyId AND j.job_status=1 AND e.employee_status=2 AND e.deleted_at IS NULL
        ${employeeScope(user, params, 'e', 'j')} GROUP BY j.employment_type`, params),
    db.first(`SELECT
      COUNT(*) activeTotal,
      SUM(EXISTS(SELECT 1 FROM hr_labor_contract c WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1)) contractCount,
      SUM(EXISTS(SELECT 1 FROM hr_social_security s WHERE s.company_id=e.company_id AND s.employee_id=e.id
        AND s.id=(SELECT MAX(s2.id) FROM hr_social_security s2 WHERE s2.company_id=e.company_id AND s2.employee_id=e.id)
        AND s.employer_insurance_status=1)) employerInsuranceCount
      FROM hr_employee e
      LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
      WHERE e.company_id=:companyId AND e.employee_status=2 AND e.deleted_at IS NULL
        ${employeeScope(user, params, 'e', 'j')}`, params),
    db.query(`SELECT r.risk_type riskType, SUM(r.handle_status IN (0,1)) unresolved, SUM(r.handle_status IN (2,3)) closed
      FROM hr_risk_alert r
      JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
      LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
      WHERE r.company_id=:companyId AND r.risk_type<>3 ${employeeScope(user, params, 'e', 'j')} GROUP BY r.risk_type`, params),
    db.query(`SELECT DATE_FORMAT(months.month_start,'%Y-%m') month,
      (SELECT COUNT(*) FROM hr_employee_job j
       JOIN hr_employee e ON e.id=j.employee_id AND e.company_id=j.company_id
       WHERE j.company_id=:companyId AND DATE_FORMAT(j.hire_date,'%Y-%m')=DATE_FORMAT(months.month_start,'%Y-%m')
         ${employeeScope(user, params, 'e', 'j')}) hires,
      (SELECT COUNT(*) FROM hr_resignation r
       WHERE r.company_id=:companyId AND DATE_FORMAT(r.leave_date,'%Y-%m')=DATE_FORMAT(months.month_start,'%Y-%m')
         ${!user || Number(user.dataScope) === 1 ? '' : `AND EXISTS (
           SELECT 1 FROM hr_employee_job tj
           JOIN labor_project tp ON tp.customer_id=tj.customer_id AND tp.company_id=tj.company_id
           JOIN sys_user_project tup ON tup.project_id=tp.id AND tup.user_id=:scopeUserId
           WHERE tj.employee_id=r.employee_id AND tj.company_id=r.company_id AND tj.job_status=1
         )`}) resignations
      FROM (SELECT DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL n MONTH) month_start FROM
      (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) nums) months
      ORDER BY months.month_start`, params),
    db.query(`SELECT COALESCE(rc.channel_name, '未填写招聘渠道') name, COUNT(DISTINCT e.id) value
      FROM hr_employee e
      JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
      LEFT JOIN hr_recruitment_channel rc ON rc.id=e.recruitment_channel_id AND rc.company_id=e.company_id
      WHERE e.company_id=:companyId AND e.employee_status=2 AND e.deleted_at IS NULL
        ${employeeScope(user, params, 'e', 'j')}
      GROUP BY COALESCE(rc.id, 0), rc.channel_name ORDER BY value DESC, name`, params)
  ]);
  const active = Number(compliance.activeTotal || 0);
  const highOpenRisks = risks.filter(item => Number(item.riskType) > 0).reduce((sum, item) => sum + Number(item.unresolved || 0), 0);
  const totalRisks = risks.reduce((sum, item) => sum + Number(item.unresolved || 0) + Number(item.closed || 0), 0);
  const closedRisks = risks.reduce((sum, item) => sum + Number(item.closed || 0), 0);
  return {
    kpis: {
      employeeTotal: Number(employeeCounts.employeeTotal || 0), activeTotal: Number(employeeCounts.activeTotal || 0),
      pendingOnboardTotal: Number(employeeCounts.pendingOnboardTotal || 0), highOpenRisks,
      riskClosureRate: totalRisks ? Math.round(closedRisks / totalRisks * 100) : 100
    },
    customerDistribution: customers.map(item => ({ name: item.name, value: Number(item.value) })),
    employmentDistribution: employment.map(item => ({ name: employmentTypeNames[item.type] || '其他', value: Number(item.value) })),
    recruitmentChannelDistribution: suppliers.map(item => ({ name: item.name, value: Number(item.value || 0) })),
    // 保留旧字段，兼容尚未更新的客户端。
    supplierDistribution: suppliers.map(item => ({ name: item.name, value: Number(item.value || 0) })),
    compliance: {
      contractRate: active ? Math.round(Number(compliance.contractCount || 0) / active * 100) : 100,
      employerInsuranceRate: active ? Math.round(Number(compliance.employerInsuranceCount || 0) / active * 100) : 100,
      specialCertRate: 100
    },
    riskByType: risks.map(item => ({ name: riskTypeNames[item.riskType] || '其他风险', unresolved: Number(item.unresolved || 0), closed: Number(item.closed || 0) })),
    trend: trend.map(item => ({ month: item.month, hires: Number(item.hires || 0), resignations: Number(item.resignations || 0) })),
    generatedAt: new Date().toISOString()
  };
}

module.exports = { listClients, createClient, listClientServices, createClientService, updateClientServiceStatus, listTalents, createTalent, employmentRecords, auditLogs, dashboard, serviceTypeNames };
