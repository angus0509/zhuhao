const db = require('../db');
const nodeCrypto = require('crypto');
const ExcelJS = require('exceljs');
const { createError } = require('../utils/response');
const noticeService = require('./notice.service');
const { encrypt, decrypt, sha256 } = require('../utils/crypto');
const { maskPhone, maskIdCard, maskBankCard } = require('../utils/mask');
const { label } = require('../utils/dictionaries');
const { paging } = require('../utils/pagination');

function buildInternalEmployeeNo() {
  return `YY${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeEmploymentType(value) {
  const raw = String(value || '').trim();
  const map = { 全职: 1, 兼职: 2, 劳务: 3, 实习: 4, 外包: 5, 派遣: 6, 劳务派遣: 6, 岗位外包: 5 };
  if (!raw) throw createError('用工模式不能为空，请填写全职/兼职/劳务/实习/外包/派遣');
  const normalized = map[raw] || (/^[1-6]$/.test(raw) ? Number(raw) : 0);
  if (!normalized) throw createError(`用工模式"${raw}"无效，可填写全职/兼职/劳务/实习/外包/派遣`);
  return normalized;
}

function normalizeFeeMode(value) {
  const raw = String(value || '').trim();
  if (raw.length > 80) throw createError('费用模式最多填写80个字符');
  return raw;
}

function normalizeRecruitmentChannel(body = {}) {
  const normalized = { ...body };
  const recruitmentChannel = String(body.recruitmentChannel || '').trim();
  const channelSource = String(body.channelSource || '').trim();
  const structuredMatch = /^(recruiter|supplier):(\d+)$/.exec(recruitmentChannel);

  // 兼容已上线的招聘人/供应商结构化请求；新版表单统一自由填写。
  if (structuredMatch && Number(structuredMatch[2]) > 0) {
    const channelType = structuredMatch[1];
    const channelId = Number(structuredMatch[2]);
    normalized.channelSource = null;
    normalized.recruitmentSourceType = channelType === 'recruiter' ? 1 : 2;
    normalized.recruiterId = channelType === 'recruiter' ? channelId : null;
    normalized.supplierId = channelType === 'supplier' ? channelId : null;
    return normalized;
  }

  const freeText = channelSource || recruitmentChannel;
  if (freeText.length > 100) throw createError('招聘渠道最多填写100个字符');
  if (freeText) {
    normalized.channelSource = freeText;
    normalized.recruitmentSourceType = null;
    normalized.recruiterId = null;
    normalized.supplierId = null;
  }
  return normalized;
}

async function resolveRecruitmentChannel(companyId, normalizedBody, operatorId, connection) {
  const channelName = String(normalizedBody.channelSource || '').trim();
  if (!channelName) {
    const relationColumn = Number(normalizedBody.recruitmentSourceType) === 1 && normalizedBody.recruiterId
      ? 'recruiter_id'
      : Number(normalizedBody.recruitmentSourceType) === 2 && normalizedBody.supplierId ? 'supplier_id' : '';
    const relationId = relationColumn === 'recruiter_id' ? Number(normalizedBody.recruiterId) : relationColumn === 'supplier_id' ? Number(normalizedBody.supplierId) : 0;
    if (!relationColumn || !relationId) return { ...normalizedBody, recruitmentChannelId: null };
    const [[linkedChannel]] = await connection.execute(
      `SELECT id FROM hr_recruitment_channel WHERE company_id=:companyId AND ${relationColumn}=:relationId AND status=1 ORDER BY id LIMIT 1`,
      { companyId, relationId }
    );
    return { ...normalizedBody, recruitmentChannelId: linkedChannel ? Number(linkedChannel.id) : null };
  }
  const [[existing]] = await connection.execute(
    'SELECT id,status FROM hr_recruitment_channel WHERE company_id=:companyId AND channel_name=:channelName LIMIT 1',
    { companyId, channelName }
  );
  if (existing) {
    if (Number(existing.status) !== 1) throw createError(`招聘渠道“${channelName}”已停用，请更换或先启用`);
    return { ...normalizedBody, recruitmentChannelId: Number(existing.id) };
  }
  const [result] = await connection.execute(
    `INSERT INTO hr_recruitment_channel (company_id,channel_name,channel_type,status,created_by)
     VALUES (:companyId,:channelName,9,1,:operatorId)`,
    { companyId, channelName, operatorId: operatorId || null }
  );
  return { ...normalizedBody, recruitmentChannelId: result.insertId };
}

function contractStatusName(contract) {
  if (!contract || Number(contract.sign_status) !== 1) return '未签';
  if (!contract.end_date) return '已签';
  if (contract.end_date < today()) return '已过期';
  if (contract.end_date <= addDays(today(), 30)) return '即将到期';
  return '已签';
}

function formatEmployeeRow(row, options = {}) {
  const idCardNo = decrypt(row.id_card_no);
  const address = decrypt(row.address);
  const bankCardNo = decrypt(row.bank_card_no);
  const showSensitive = options.showSensitive === true;

  return {
    id: row.id,
    employeeNo: row.employee_no,
    createdBy: row.created_by || null,
    name: row.name,
    gender: row.gender,
    genderName: label('gender', row.gender, '未知'),
    idCardNo: showSensitive ? idCardNo : maskIdCard(idCardNo),
    address: showSensitive ? address : (address ? '已填写' : ''),
    phone: showSensitive ? row.phone : maskPhone(row.phone),
    email: row.email || '',
    education: row.education || '',
    bankName: row.bank_name || '',
    bankCardNo: showSensitive ? bankCardNo : maskBankCard(bankCardNo),
    emergencyContact: row.emergency_contact || '',
    emergencyPhone: showSensitive ? row.emergency_phone : maskPhone(row.emergency_phone),
    channelSource: row.channel_source || '',
    recruitmentChannelId: row.recruitment_channel_id || null,
    recruitmentSourceType: row.recruitment_source_type || null,
    recruitmentSourceTypeName: Number(row.recruitment_source_type) === 1
      ? '招聘人'
      : Number(row.recruitment_source_type) === 2 ? '供应商' : '',
    recruiterId: row.recruiter_id || null,
    recruiterName: row.recruiter_name || '',
    supplierId: row.supplier_id || null,
    supplierName: row.recruitment_supplier_name || '',
    recruitmentChannel: row.channel_source || (Number(row.recruitment_source_type) === 1 && row.recruiter_id
      ? `recruiter:${row.recruiter_id}`
      : Number(row.recruitment_source_type) === 2 && row.supplier_id ? `supplier:${row.supplier_id}` : ''),
    recruitmentChannelName: row.channel_source || (Number(row.recruitment_source_type) === 1
      ? `招聘人｜${row.recruiter_name || '-'}`
      : Number(row.recruitment_source_type) === 2 ? `供应商｜${row.recruitment_supplier_name || '-'}` : ''),
    sourceLocked: Number(row.source_locked || 0) === 1,
    lifecycleStatus: row.lifecycle_status || '',
    arrivalStatus: row.arrival_status || '',
    insuranceStatus: row.insurance_status || '',
    contractStatus: row.contract_status || '',
    documentStatus: row.document_status || '',
    riskLevel: Number(row.risk_level || 1),
    remark: row.remark || '',
    employeeStatus: row.employee_status,
    employeeStatusName: label('employeeStatus', row.employee_status, '未知'),
    deptId: row.dept_id || '',
    deptName: row.dept_name || '',
    customerId: row.customer_id || '',
    customerName: row.customer_name || '未分配客户单位',
    projectId: row.project_id || '',
    positionId: row.position_id || '',
    positionName: row.position_name || '',
    employmentType: row.employment_type || '',
    employmentTypeName: label('employmentType', row.employment_type),
    feeMode: row.fee_mode || '',
    feeModeName: row.fee_mode || '',
    workType: row.work_type || '',
    workTypeName: label('workType', row.work_type),
    hireDate: row.hire_date || '',
    socialStatus: row.social_status ?? 0,
    socialStatusName: label('socialStatus', row.social_status ?? 0, '未参保'),
    employerInsuranceStatus: row.employer_insurance_status ?? 0,
    employerInsuranceStatusName: Number(row.employer_insurance_status) === 1
      ? '保障中'
      : Number(row.employer_insurance_status) === 2 ? '已终止' : '未投保',
    employerInsuranceEndDate: row.employer_end_date || '',
    contractStatusName: row.contract_no ? contractStatusName(row) : '未签',
    contractPeriod: formatContractPeriod(row.contract_start_date, row.contract_end_date),
    leaveDate: row.leave_date || '',
    riskCount: Number(row.risk_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatContractPeriod(startDate, endDate) {
  if (!startDate && !endDate) return '';
  const start = startDate || '起';
  const end = endDate || '无固定';
  return `${start} ~ ${end}`;
}

function formatRisk(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || '',
    employeeNo: row.employee_no || '',
    riskType: row.risk_type,
    riskLevel: row.risk_level,
    riskLevelName: label('riskLevel', row.risk_level),
    riskTitle: row.risk_title,
    riskDesc: row.risk_desc,
    riskKey: row.risk_key,
    handleStatus: row.handle_status,
    handleStatusName: label('handleStatus', row.handle_status),
    handleRemark: row.handle_remark || '',
    handleTime: row.handle_time || '',
    riskCaseId: row.risk_case_id || null,
    customerName: row.customer_name || '',
    projectId: row.project_id || null,
    projectName: row.project_name || '',
    positionName: row.position_name || '',
    caseStatus: row.case_status === null || row.case_status === undefined ? null : Number(row.case_status),
    caseOwnerName: row.case_owner_name || '',
    caseOwnerDept: row.case_owner_dept || '',
    caseDeadline: row.case_deadline || '',
    correctiveMeasure: row.corrective_measure || '',
    evidenceNote: row.evidence_note || '',
    reviewNote: row.review_note || '',
    caseUpdatedAt: row.case_updated_at || '',
    createdAt: row.created_at
  };
}

async function resolveDataScope(companyId, user) {
  if (!user || Number(user.dataScope) === 1) {
    return { type: 'all', deptIds: [], employeeId: null };
  }

  if (Number(user.dataScope) === 4) {
    return { type: 'employee', deptIds: [], employeeId: user.employeeId || 0 };
  }

  if (Number(user.dataScope) === 5) {
    // 项目授权是用户级数据范围；员工任职表目前只有客户单位字段，
    // 因此通过授权项目的 customer_id 映射员工可见范围。
    const rows = await db.query(
      `
      SELECT DISTINCT p.id project_id, p.customer_id
      FROM sys_user_project up
      JOIN labor_project p ON p.id = up.project_id AND p.company_id = :companyId
      WHERE up.user_id = :userId AND p.status IN (1,2)
      `,
      { companyId, userId: Number(user.id) }
    );
    return {
      type: 'project',
      deptIds: [],
      projectIds: rows.map(row => row.project_id),
      customerIds: [...new Set(rows.map(row => row.customer_id))],
      employeeId: null,
      userId: Number(user.id)
    };
  }

  if ([2, 3].includes(Number(user.dataScope)) && Array.isArray(user.scopeDeptIds)) {
    return user.scopeDeptIds.length
      ? { type: 'dept', deptIds: user.scopeDeptIds.map(Number), employeeId: null }
      : { type: 'none', deptIds: [], employeeId: null };
  }

  if (!user.employeeId) return { type: 'none', deptIds: [], employeeId: null };

  const currentJob = await db.first(
    'SELECT dept_id FROM hr_employee_job WHERE company_id = :companyId AND employee_id = :employeeId AND job_status = 1 LIMIT 1',
    { companyId, employeeId: user.employeeId }
  );
  if (!currentJob) return { type: 'none', deptIds: [], employeeId: null };

  if (Number(user.dataScope) === 3) {
    return { type: 'dept', deptIds: [currentJob.dept_id], employeeId: null };
  }

  const rows = await db.query(
    `
    WITH RECURSIVE dept_tree AS (
      SELECT id FROM hr_department WHERE company_id = :companyId AND id = :deptId
      UNION ALL
      SELECT d.id
      FROM hr_department d
      JOIN dept_tree dt ON d.parent_id = dt.id
      WHERE d.company_id = :companyId
    )
    SELECT id FROM dept_tree
    `,
    { companyId, deptId: currentJob.dept_id }
  );

  return { type: 'dept', deptIds: rows.map(row => row.id), employeeId: null };
}

function applyDataScope(where, params, scope) {
  if (!scope || scope.type === 'all') return;
  if (scope.type === 'none') {
    where.push('1 = 0');
    return;
  }
  if (scope.type === 'employee') {
    where.push('e.id = :scopeEmployeeId');
    params.scopeEmployeeId = Number(scope.employeeId || 0);
    return;
  }
  if (scope.type === 'dept') {
    if (!scope.deptIds.length) {
      where.push('1 = 0');
      return;
    }
    const keys = scope.deptIds.map((deptId, index) => {
      const key = `scopeDeptId${index}`;
      params[key] = deptId;
      return `:${key}`;
    });
    where.push(`j.dept_id IN (${keys.join(', ')})`);
    return;
  }
  if (scope.type === 'project') {
    params.scopeOwnerUserId = Number(scope.userId || 0);
    const ownerLegacyCondition = '(e.created_by = :scopeOwnerUserId AND j.project_id IS NULL)';
    if (!scope.projectIds?.length) {
      where.push(ownerLegacyCondition);
      return;
    }
    const keys = scope.projectIds.map((projectId, index) => {
      const key = `scopeProjectId${index}`;
      params[key] = projectId;
      return `:${key}`;
    });
    where.push(`(j.project_id IN (${keys.join(', ')}) OR ${ownerLegacyCondition})`);
  }
}

async function assertEmployeeScope(companyId, employeeId, user, connection = db.pool) {
  const scope = await resolveDataScope(companyId, user);
  const params = { companyId, employeeId };
  const where = ['e.company_id = :companyId', 'e.id = :employeeId', 'e.deleted_at IS NULL'];
  applyDataScope(where, params, scope);
  const [[employee]] = await connection.execute(
    `SELECT e.id
     FROM hr_employee e
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.employee_id=e.id AND j2.company_id=e.company_id
       ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
     )
     WHERE ${where.join(' AND ')} LIMIT 1`,
    params
  );
  if (!employee) throw createError('无权操作该项目员工', 403);
  return employee;
}

async function assertNewEmployeeScope(companyId, body, user, connection = db.pool) {
  if (!user || Number(user.dataScope) === 1) return;
  if ([2, 3].includes(Number(user.dataScope))) {
    const allowedDeptIds = Array.isArray(user.scopeDeptIds) ? user.scopeDeptIds.map(Number) : [];
    if (!allowedDeptIds.includes(Number(body.deptId))) throw createError('无权向该部门录入员工', 403);
    return;
  }
  if (Number(user.dataScope) === 5) {
    // 驻厂人员可先录入未分配客户/项目的面试线索，后续补齐时再校验项目权限。
    if (Number(body.employeeStatus) === 6 && !body.projectId && !body.customerId) return;
    if (!body.projectId) throw createError('授权项目范围账号必须选择所属项目');
    const [[project]] = await connection.execute(
      `SELECT p.id FROM sys_user_project up
       JOIN labor_project p ON p.id=up.project_id AND p.company_id=:companyId AND p.status IN (1,2)
       WHERE up.user_id=:userId AND p.id=:projectId AND p.customer_id=:customerId LIMIT 1`,
      { companyId, userId: Number(user.id), projectId: Number(body.projectId), customerId: Number(body.customerId) }
    );
    if (!project) throw createError('无权向该项目录入或调整员工', 403);
    return;
  }
  throw createError('当前数据范围不允许新增其他员工', 403);
}

async function getBootstrap(companyId, user = null) {
  const scope = await resolveDataScope(companyId, user);
  const [company, allDepartments, positions, allCustomers, allProjects, recruiters, suppliers] = await Promise.all([
    db.first('SELECT * FROM hr_company WHERE id = :companyId', { companyId }),
    db.query(
      'SELECT id, company_id AS companyId, parent_id AS parentId, dept_name AS deptName, dept_code AS deptCode, status FROM hr_department WHERE company_id = :companyId AND status = 1 ORDER BY sort_no, id',
      { companyId }
    ),
    db.query(
      `SELECT id, company_id AS companyId, position_name AS positionName, position_code AS positionCode,
              risk_level AS riskLevel, is_special_work AS isSpecialWork, status
       FROM hr_position
       WHERE company_id = :companyId AND status = 1
       ORDER BY CASE WHEN position_code = 'OP' OR position_name = '普工' THEN 0 ELSE 1 END,
                position_name, id`,
      { companyId }
    ),
    db.query(
      'SELECT id, customer_name AS customerName, status FROM crm_customer WHERE company_id = :companyId AND status = 1 ORDER BY customer_name, id',
      { companyId }
    ),
    db.query(
      `SELECT id,customer_id customerId,project_name projectName,factory_name factoryName,status
       FROM labor_project WHERE company_id=:companyId AND status IN (1,2) ORDER BY project_name,id`,
      { companyId }
    ),
    db.query(
      'SELECT id, recruiter_no recruiterNo, recruiter_name recruiterName, phone FROM hr_recruiter WHERE company_id=:companyId AND status=1 ORDER BY recruiter_name,id',
      { companyId }
    ),
    db.query(
      `SELECT id, supplier_no supplierNo, supplier_name supplierName, contact_name contactName,
              contact_phone contactPhone, contract_end_date contractEndDate, risk_level riskLevel
       FROM hr_recruitment_supplier
       WHERE company_id=:companyId AND status=1
       ORDER BY supplier_name,id`,
      { companyId }
    )
  ]);

  let departments = allDepartments;
  let customers = allCustomers;
  let projects = allProjects;
  if (scope.type === 'dept') {
    const allowedDeptIds = new Set(scope.deptIds.map(Number));
    departments = allDepartments.filter(item => allowedDeptIds.has(Number(item.id)));
    const customerRows = scope.deptIds.length
      ? await db.query(
          `SELECT DISTINCT customer_id FROM hr_employee_job
           WHERE company_id=:companyId AND job_status=1 AND dept_id IN (${scope.deptIds.map((_, index) => `:deptId${index}`).join(',')})`,
          Object.assign({ companyId }, ...scope.deptIds.map((deptId, index) => ({ [`deptId${index}`]: Number(deptId) })))
        )
      : [];
    const customerIds = new Set(customerRows.map(item => Number(item.customer_id)));
    customers = allCustomers.filter(item => customerIds.has(Number(item.id)));
  } else if (scope.type === 'project') {
    const customerIds = new Set((scope.customerIds || []).map(Number));
    customers = allCustomers.filter(item => customerIds.has(Number(item.id)));
    const projectIds = new Set((scope.projectIds || []).map(Number));
    projects = allProjects.filter(item => projectIds.has(Number(item.id)));
  } else if (scope.type === 'employee') {
    const currentJob = await db.first(
      'SELECT customer_id, dept_id FROM hr_employee_job WHERE company_id=:companyId AND employee_id=:employeeId AND job_status=1 LIMIT 1',
      { companyId, employeeId: scope.employeeId }
    );
    customers = currentJob ? allCustomers.filter(item => Number(item.id) === Number(currentJob.customer_id)) : [];
    departments = currentJob ? allDepartments.filter(item => Number(item.id) === Number(currentJob.dept_id)) : [];
  } else if (scope.type === 'none') {
    departments = [];
    customers = [];
    projects = [];
  }

  return {
    company: company
      ? {
          id: company.id,
          companyName: company.company_name,
          contactName: company.contact_name,
          contactPhone: company.contact_phone,
          status: company.status
        }
      : null,
    departments,
    positions,
    customers,
    projects,
    recruitmentSources: { recruiters, suppliers }
  };
}

async function getSummary(companyId, user = null) {
  const params = { companyId };
  const scopeWhere = [];
  applyDataScope(scopeWhere, params, await resolveDataScope(companyId, user));
  const employeeFilter = scopeWhere.length ? `AND ${scopeWhere.join(' AND ')}` : '';
  const row = await db.first(
    `
    SELECT
      COUNT(*) AS employee_total,
      SUM(CASE WHEN employee_status = 2 THEN 1 ELSE 0 END) AS active_total
    FROM hr_employee e
    LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
    WHERE e.company_id = :companyId AND e.deleted_at IS NULL ${employeeFilter}
    `,
    params
  );

  const risk = await db.first(
    `
    SELECT
      SUM(CASE WHEN r.handle_status IN (0, 1) THEN 1 ELSE 0 END) AS unresolved_risk_total,
      SUM(CASE WHEN r.handle_status IN (0, 1) AND r.risk_level = 3 THEN 1 ELSE 0 END) AS high_risk_total
    FROM hr_risk_alert r
    JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
    LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
    WHERE r.company_id = :companyId
      AND r.risk_type IN (1, 7)
      AND e.employee_status = 2
      AND e.lifecycle_status <> 'OFFBOARDING'
      AND e.deleted_at IS NULL
      ${employeeFilter}
    `,
    params
  );

  const unsigned = await db.first(
    `
    SELECT COUNT(*) AS unsigned_total
    FROM hr_employee e
    LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
    WHERE e.company_id = :companyId
      AND e.employee_status = 2
      AND e.deleted_at IS NULL
      ${employeeFilter}
      AND NOT EXISTS (
        SELECT 1 FROM hr_labor_contract c
        WHERE c.company_id = e.company_id
          AND c.employee_id = e.id
          AND c.sign_status = 1
      )
    `,
    params
  );

  const socialMissing = await db.first(
    `
    SELECT COUNT(*) AS social_missing_total
    FROM hr_employee e
    JOIN hr_employee_job j ON j.employee_id = e.id AND j.company_id = e.company_id AND j.job_status = 1
    WHERE e.company_id = :companyId
      AND e.employee_status = 2
      AND e.deleted_at IS NULL
      ${employeeFilter}
      AND j.employment_type = 1
      AND NOT EXISTS (
        SELECT 1 FROM hr_social_security s
        WHERE s.company_id = e.company_id
          AND s.employee_id = e.id
          AND s.social_status = 1
      )
    `,
    params
  );

  return {
    employeeTotal: Number(row?.employee_total || 0),
    activeTotal: Number(row?.active_total || 0),
    unresolvedRiskTotal: Number(risk?.unresolved_risk_total || 0),
    highRiskTotal: Number(risk?.high_risk_total || 0),
    unsignedTotal: Number(unsigned?.unsigned_total || 0),
    socialMissingTotal: Number(socialMissing?.social_missing_total || 0)
  };
}

// 驻厂工作台只需要轻量统计，不应为了客户人数和状态汇总下载整家公司花名册。
async function getOnsiteOverview(companyId, user = null) {
  const params = { companyId };
  const where = [
    'e.company_id = :companyId',
    'e.deleted_at IS NULL'
  ];
  applyDataScope(where, params, await resolveDataScope(companyId, user));
  const rows = await db.query(
    `SELECT
       j.customer_id customerId,
       cu.customer_name customerName,
       COUNT(*) employeeCount,
       SUM(CASE WHEN e.employee_status=1 THEN 1 ELSE 0 END) pendingCount,
       SUM(CASE WHEN e.employee_status=6 THEN 1 ELSE 0 END) interviewCount,
       SUM(CASE WHEN e.employee_status=5 THEN 1 ELSE 0 END) unjoinedCount,
       SUM(CASE WHEN e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' THEN 1 ELSE 0 END) activeCount,
       SUM(CASE WHEN e.lifecycle_status='OFFBOARDING' THEN 1 ELSE 0 END) offboardingCount,
       SUM(CASE WHEN e.employee_status=3 THEN 1 ELSE 0 END) leftCount,
       SUM(CASE WHEN e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING'
         AND COALESCE(s.employer_insurance_status,0)<>1 THEN 1 ELSE 0 END) insuranceGapCount
     FROM hr_employee e
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.employee_id=e.id AND j2.company_id=e.company_id
       ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
     )
     LEFT JOIN crm_customer cu ON cu.id=j.customer_id AND cu.company_id=e.company_id
     LEFT JOIN hr_social_security s ON s.id=(
       SELECT s2.id FROM hr_social_security s2
       WHERE s2.company_id=e.company_id AND s2.employee_id=e.id
       ORDER BY s2.id DESC LIMIT 1
     )
     WHERE ${where.join(' AND ')}
     GROUP BY j.customer_id,cu.customer_name
     ORDER BY cu.customer_name,j.customer_id`,
    params
  );
  const normalize = row => ({
    customerId: row.customerId || '',
    customerName: row.customerName || '未分配客户单位',
    employeeCount: Number(row.employeeCount || 0),
    pendingCount: Number(row.pendingCount || 0),
    interviewCount: Number(row.interviewCount || 0),
    unjoinedCount: Number(row.unjoinedCount || 0),
    activeCount: Number(row.activeCount || 0),
    offboardingCount: Number(row.offboardingCount || 0),
    leftCount: Number(row.leftCount || 0),
    insuranceGapCount: Number(row.insuranceGapCount || 0)
  });
  const customerStats = rows.map(normalize);
  const overall = customerStats.reduce((total, item) => {
    for (const key of ['employeeCount', 'pendingCount', 'interviewCount', 'unjoinedCount', 'activeCount', 'offboardingCount', 'leftCount', 'insuranceGapCount']) {
      total[key] += item[key];
    }
    return total;
  }, { employeeCount: 0, pendingCount: 0, interviewCount: 0, unjoinedCount: 0, activeCount: 0, offboardingCount: 0, leftCount: 0, insuranceGapCount: 0 });
  return { overall, customerStats };
}

async function listEmployees(companyId, query, user = null, options = {}) {
  const { page, pageSize, offset } = paging(query, { maxPageSize: options.maxPageSize || 200 });
  const params = {
    companyId,
    keyword: `%${query.keyword || ''}%`,
    employeeStatus: query.employeeStatus ? Number(query.employeeStatus) : null,
    customerId: query.customerId ? Number(query.customerId) : null,
    employmentType: query.employmentType ? Number(query.employmentType) : null,
    pageSize,
    offset
  };

  const where = [
    'e.company_id = :companyId',
    'e.deleted_at IS NULL',
    '(:employeeStatus IS NULL OR e.employee_status = :employeeStatus)',
    '(:customerId IS NULL OR j.customer_id = :customerId)',
    '(:employmentType IS NULL OR j.employment_type = :employmentType)'
  ];

  if (query.keyword) {
    where.push('(e.name LIKE :keyword OR e.employee_no LIKE :keyword OR e.phone LIKE :keyword)');
  }
  if (query.view === 'activeRoster') {
    // 网页花名册固定为当前在职视图，离职办理中和无有效任职记录的人员不进入列表及导出。
    where.push('e.employee_status = 2');
    where.push("COALESCE(e.lifecycle_status, '') <> 'OFFBOARDING'");
    where.push('j.job_status = 1');
  }
  applyDataScope(where, params, await resolveDataScope(companyId, user));

  const baseFrom = `
    FROM hr_employee e
    LEFT JOIN hr_employee_job j ON j.id = (
      SELECT j2.id FROM hr_employee_job j2
      WHERE j2.employee_id = e.id AND j2.company_id = e.company_id
      ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
    )
    LEFT JOIN hr_department d ON d.id = j.dept_id AND d.company_id = e.company_id
    LEFT JOIN crm_customer cu ON cu.id = j.customer_id AND cu.company_id = e.company_id
    LEFT JOIN hr_position p ON p.id = j.position_id AND p.company_id = e.company_id
    LEFT JOIN hr_recruiter rec ON rec.id=e.recruiter_id AND rec.company_id=e.company_id
    LEFT JOIN hr_recruitment_supplier rs ON rs.id=e.supplier_id AND rs.company_id=e.company_id
    LEFT JOIN hr_social_security s ON s.employee_id = e.id AND s.company_id = e.company_id
    LEFT JOIN hr_labor_contract c ON c.id = (
      SELECT c2.id FROM hr_labor_contract c2
      WHERE c2.employee_id = e.id AND c2.company_id = e.company_id
      ORDER BY c2.sign_status DESC, c2.start_date DESC, c2.id DESC
      LIMIT 1
    )
    LEFT JOIN hr_resignation res ON res.id = (
      SELECT res2.id FROM hr_resignation res2
      WHERE res2.employee_id = e.id AND res2.company_id = e.company_id
      ORDER BY res2.leave_date DESC, res2.id DESC
      LIMIT 1
    )
    LEFT JOIN (
      SELECT employee_id, COUNT(*) AS risk_count
      FROM hr_risk_alert
      WHERE company_id = :companyId AND handle_status IN (0, 1)
      GROUP BY employee_id
    ) r ON r.employee_id = e.id
    WHERE ${where.join(' AND ')}
  `;

  const totalRow = await db.first(`SELECT COUNT(*) AS total ${baseFrom}`, params);
  const rows = await db.query(
    `
    SELECT
      e.*, j.dept_id, j.customer_id, j.project_id, j.position_id, j.employment_type, j.fee_mode, j.work_type, j.hire_date,
      d.dept_name, cu.customer_name, p.position_name,
      rec.recruiter_name, rs.supplier_name AS recruitment_supplier_name,
      s.social_status, s.employer_insurance_status, s.employer_end_date,
      c.contract_no, c.sign_status, c.start_date AS contract_start_date, c.end_date AS contract_end_date,
      res.leave_date,
      COALESCE(r.risk_count, 0) AS risk_count
    ${baseFrom}
    ORDER BY e.id DESC
    LIMIT :pageSize OFFSET :offset
    `,
    params
  );

  return {
    page,
    pageSize,
    total: Number(totalRow?.total || 0),
    list: rows.map(row => formatEmployeeRow(row))
  };
}

async function listMyEmployees(companyId, user, query = {}) {
  const { page, pageSize, offset } = paging(query);
  const params = {
    companyId,
    userId: Number(user?.id || 0),
    keyword: `%${query.keyword || ''}%`,
    employeeStatus: query.employeeStatus ? Number(query.employeeStatus) : null,
    limit: pageSize,
    offset
  };

  const where = [
    'e.company_id = :companyId',
    'e.deleted_at IS NULL',
    'e.created_by = :userId',
    '(:employeeStatus IS NULL OR e.employee_status = :employeeStatus)'
  ];

  if (query.keyword) {
    where.push('(e.name LIKE :keyword OR e.employee_no LIKE :keyword OR e.phone LIKE :keyword)');
  }
  applyDataScope(where, params, await resolveDataScope(companyId, user));

  const baseFrom = `
    FROM hr_employee e
    LEFT JOIN hr_employee_job j ON j.id = (
      SELECT j2.id FROM hr_employee_job j2
      WHERE j2.employee_id = e.id AND j2.company_id = e.company_id
      ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
    )
    LEFT JOIN crm_customer cu ON cu.id = j.customer_id AND cu.company_id = e.company_id
    LEFT JOIN hr_position p ON p.id = j.position_id AND p.company_id = e.company_id
    LEFT JOIN hr_recruiter rec ON rec.id=e.recruiter_id AND rec.company_id=e.company_id
    LEFT JOIN hr_recruitment_supplier rs ON rs.id=e.supplier_id AND rs.company_id=e.company_id
    WHERE ${where.join(' AND ')}
  `;

  const totalRow = await db.first(`SELECT COUNT(*) AS total ${baseFrom}`, params);
  const rows = await db.query(
    `
    SELECT
      e.id, e.employee_no, e.name, e.gender, e.phone, e.employee_status, e.created_at,
      j.customer_id, j.position_id, j.employment_type, j.fee_mode, j.work_type, j.hire_date,
      cu.customer_name, p.position_name
    ${baseFrom}
    ORDER BY e.id DESC
    LIMIT :limit OFFSET :offset
    `,
    params
  );

  return {
    page,
    pageSize,
    total: Number(totalRow?.total || 0),
    list: rows.map(row => formatEmployeeRow(row))
  };
}

async function getEmployeeDetail(companyId, employeeId, options = {}) {
  const scope = await resolveDataScope(companyId, options.user || null);
  const params = { companyId, employeeId };
  const scopeWhere = [];
  applyDataScope(scopeWhere, params, scope);
  const employee = await db.first(
    `
    SELECT
      e.*, j.dept_id, j.customer_id, j.project_id, j.position_id, j.employment_type, j.fee_mode, j.work_type, j.hire_date,
      d.dept_name, cu.customer_name, p.position_name,
      s.social_status, s.employer_insurance_status, s.employer_end_date,
      rec.recruiter_name, rs.supplier_name AS recruitment_supplier_name,
      c.contract_no, c.sign_status, c.start_date AS contract_start_date, c.end_date AS contract_end_date,
      res.leave_date,
      COALESCE(r.risk_count, 0) AS risk_count
    FROM hr_employee e
    LEFT JOIN hr_employee_job j ON j.id = (
      SELECT j2.id FROM hr_employee_job j2
      WHERE j2.employee_id = e.id AND j2.company_id = e.company_id
      ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
    )
    LEFT JOIN hr_department d ON d.id = j.dept_id AND d.company_id = e.company_id
    LEFT JOIN crm_customer cu ON cu.id = j.customer_id AND cu.company_id = e.company_id
    LEFT JOIN hr_position p ON p.id = j.position_id AND p.company_id = e.company_id
    LEFT JOIN hr_social_security s ON s.employee_id = e.id AND s.company_id = e.company_id
    LEFT JOIN hr_recruiter rec ON rec.id = e.recruiter_id AND rec.company_id = e.company_id
    LEFT JOIN hr_recruitment_supplier rs ON rs.id = e.supplier_id AND rs.company_id = e.company_id
    LEFT JOIN hr_labor_contract c ON c.id = (
      SELECT c2.id FROM hr_labor_contract c2
      WHERE c2.employee_id = e.id AND c2.company_id = e.company_id
      ORDER BY c2.sign_status DESC, c2.start_date DESC, c2.id DESC
      LIMIT 1
    )
    LEFT JOIN hr_resignation res ON res.id = (
      SELECT res2.id FROM hr_resignation res2
      WHERE res2.employee_id = e.id AND res2.company_id = e.company_id
      ORDER BY res2.leave_date DESC, res2.id DESC
      LIMIT 1
    )
    LEFT JOIN (
      SELECT employee_id, COUNT(*) AS risk_count
      FROM hr_risk_alert
      WHERE company_id = :companyId AND handle_status IN (0, 1)
      GROUP BY employee_id
    ) r ON r.employee_id = e.id
    WHERE e.company_id = :companyId
      AND e.id = :employeeId
      AND e.deleted_at IS NULL
      ${scopeWhere.length ? `AND ${scopeWhere.join(' AND ')}` : ''}
    `,
    params
  );

  if (!employee) throw createError('员工不存在', 404);

  const [jobHistory, contractList, socialSecurity, certificateList, riskAlertList, resignation] = await Promise.all([
    db.query(
      `
      SELECT j.*, d.dept_name, cu.customer_name, p.position_name
      FROM hr_employee_job j
      LEFT JOIN hr_department d ON d.id = j.dept_id AND d.company_id = j.company_id
      LEFT JOIN crm_customer cu ON cu.id = j.customer_id AND cu.company_id = j.company_id
      LEFT JOIN hr_position p ON p.id = j.position_id AND p.company_id = j.company_id
      WHERE j.company_id = :companyId AND j.employee_id = :employeeId
      ORDER BY j.id DESC
      `,
      { companyId, employeeId }
    ),
    db.query('SELECT * FROM hr_labor_contract WHERE company_id = :companyId AND employee_id = :employeeId ORDER BY start_date DESC, id DESC', {
      companyId,
      employeeId
    }),
    db.first('SELECT * FROM hr_social_security WHERE company_id = :companyId AND employee_id = :employeeId ORDER BY id DESC LIMIT 1', {
      companyId,
      employeeId
    }),
    db.query('SELECT * FROM hr_employee_certificate WHERE company_id = :companyId AND employee_id = :employeeId ORDER BY id DESC', {
      companyId,
      employeeId
    }),
    db.query(
      'SELECT * FROM hr_risk_alert WHERE company_id = :companyId AND employee_id = :employeeId ORDER BY risk_level DESC, id DESC',
      { companyId, employeeId }
    ),
    db.first(
      'SELECT * FROM hr_resignation WHERE company_id=:companyId AND employee_id=:employeeId ORDER BY id DESC LIMIT 1',
      { companyId, employeeId }
    )
  ]);

  return {
    basicInfo: formatEmployeeRow(employee, options),
    jobInfo: jobHistory.find(row => Number(row.job_status) === 1) || null,
    jobHistory: jobHistory.map(row => ({
      id: row.id,
      deptId: row.dept_id,
      deptName: row.dept_name || '',
      customerId: row.customer_id || '',
      customerName: row.customer_name || '未分配客户单位',
      positionId: row.position_id,
      positionName: row.position_name || '',
      employmentType: row.employment_type,
      employmentTypeName: label('employmentType', row.employment_type),
      feeMode: row.fee_mode || '',
      feeModeName: row.fee_mode || '',
      workType: row.work_type,
      workTypeName: label('workType', row.work_type),
      hireDate: row.hire_date,
      jobStatus: row.job_status,
      jobStatusName: Number(row.job_status) === 1 ? '当前' : '历史',
      remark: row.remark || ''
    })),
    contractList: contractList.map(row => ({
      id: row.id,
      contractNo: row.contract_no,
      contractType: row.contract_type,
      signStatus: row.sign_status,
      signStatusName: label('signStatus', row.sign_status),
      startDate: row.start_date,
      endDate: row.end_date,
      renewalCount: row.renewal_count,
      contractStatusName: contractStatusName(row)
    })),
    socialSecurity: socialSecurity
      ? {
          id: socialSecurity.id,
          socialStatus: socialSecurity.social_status,
          socialStatusName: label('socialStatus', socialSecurity.social_status),
          socialCity: socialSecurity.social_city || '',
          socialBase: socialSecurity.social_base,
          fundStatus: socialSecurity.fund_status,
          fundStatusName: label('socialStatus', socialSecurity.fund_status),
          fundBase: socialSecurity.fund_base,
          startMonth: socialSecurity.start_month || '',
          stopMonth: socialSecurity.stop_month || '',
          supplierName: socialSecurity.supplier_name || '',
          employerInsuranceStatus: socialSecurity.employer_insurance_status || 0,
          employerInsurer: socialSecurity.employer_insurer || '',
          employerPolicyNo: socialSecurity.employer_policy_no || '',
          employerStartDate: socialSecurity.employer_start_date || '',
          employerEndDate: socialSecurity.employer_end_date || '',
          employerInsuredAmount: socialSecurity.employer_insured_amount || 0,
          remark: socialSecurity.remark || ''
        }
      : null,
    certificateList: certificateList.map(row => ({
      id: row.id,
      certType: row.cert_type,
      certTypeName: label('certType', row.cert_type),
      certNo: row.cert_no || '',
      issueDate: row.issue_date || '',
      expireDate: row.expire_date || '',
      verifyStatus: row.verify_status,
      verifyStatusName: Number(row.verify_status) === 1 ? '已核验' : Number(row.verify_status) === 2 ? '异常' : '未核验'
    })),
    riskAlertList: riskAlertList.map(formatRisk),
    resignation: resignation ? {
      id: resignation.id,
      leaveDate: resignation.leave_date,
      leaveType: resignation.leave_type,
      leaveReason: resignation.leave_reason || '',
      handoverStatus: Number(resignation.handover_status || 0),
      badgeReturned: Number(resignation.badge_returned || 0) === 1,
      toolsReturned: Number(resignation.tools_returned || 0) === 1,
      dormCleared: Number(resignation.dorm_cleared || 0) === 1,
      attendanceConfirmed: Number(resignation.attendance_confirmed || 0) === 1,
      riskRemark: resignation.risk_remark || '',
      completedAt: resignation.completed_at || null
    } : null
  };
}

async function recordSensitiveAccess(companyId, employeeId, operatorId, reason, ipAddress = '') {
  await db.query(
    `INSERT INTO sys_sensitive_access_log
     (company_id, employee_id, operator_id, field_name, reason, ip_address)
     VALUES (:companyId, :employeeId, :operatorId, 'employee_identity_and_bank', :reason, :ipAddress)`,
    {
      companyId,
      employeeId,
      operatorId,
      reason: String(reason || '编辑员工档案').slice(0, 255),
      ipAddress: String(ipAddress || '').slice(0, 50) || null
    }
  );
}

async function validateEmployeeInput(companyId, body, employeeId = 0, connection = db.pool, employeeStatus = 1) {
  const interview = Number(employeeStatus) === 6;
  const required = interview ? [
    ['name', '姓名不能为空'],
    ['phone', '手机号不能为空']
  ] : [
    ['name', '姓名不能为空'],
    ['phone', '手机号不能为空'],
    ['idCardNo', '身份证号不能为空'],
    ['customerId', '客户单位不能为空'],
    ['positionId', '岗位不能为空']
  ];
  if (Number(employeeStatus) === 2) {
    required.push(
      ['employmentType', '直接入职时用工模式不能为空'],
      ['workType', '直接入职时工资类型不能为空'],
      ['hireDate', '直接入职时入职日期不能为空']
    );
  }

  for (const [field, message] of required) {
    if (!body[field]) throw createError(message);
  }
  if (!/^1[3-9]\d{9}$/.test(body.phone)) throw createError('手机号格式不正确');
  if (body.idCardNo && !/^\d{17}[\dXx]$/.test(body.idCardNo)) throw createError('身份证号格式不正确');
  if (body.address && String(body.address).trim().length > 255) throw createError('地址最多填写255个字符');
  if (body.employmentType && ![1, 2, 3, 4, 5, 6].includes(Number(body.employmentType))) throw createError('用工模式不正确');
  normalizeFeeMode(body.feeMode);
  if (body.workType && ![1, 2, 3].includes(Number(body.workType))) throw createError('工资类型不正确');

  if (body.idCardNo) {
    const [[blacklisted]] = await connection.execute(
      `SELECT blacklist_reason, risk_level FROM person_blacklist
       WHERE company_id = :companyId AND id_card_hash = :idCardHash AND status = 1 LIMIT 1`,
      { companyId, idCardHash: sha256(body.idCardNo) }
    );
    if (blacklisted) {
      throw createError(`该人员命中全公司黑名单：${blacklisted.blacklist_reason}`);
    }

    const [[duplicatedIdentity]] = await connection.execute(
      `SELECT id FROM hr_employee
       WHERE company_id=:companyId AND id_card_hash=:idCardHash
         AND deleted_at IS NULL AND id<>:employeeId LIMIT 1`,
      { companyId, idCardHash: sha256(body.idCardNo), employeeId: Number(employeeId || 0) }
    );
    if (duplicatedIdentity) throw createError('该身份证号已存在员工档案');
  }

  if (body.employeeNo) {
    const [[duplicated]] = await connection.execute(
      `
      SELECT id FROM hr_employee
      WHERE company_id = :companyId
        AND employee_no = :employeeNo
        AND deleted_at IS NULL
        AND id <> :employeeId
      LIMIT 1
      `,
      { companyId, employeeNo: body.employeeNo, employeeId }
    );
    if (duplicated) throw createError('员工内部编号已存在');
  }

  if (interview && (!body.customerId || !body.positionId)) {
    await validateRecruitmentSource(companyId, body, connection);
    return;
  }

  const [[customer]] = await connection.execute(
    'SELECT id FROM crm_customer WHERE company_id = :companyId AND id = :customerId AND status = 1 LIMIT 1',
    { companyId, customerId: Number(body.customerId) }
  );
  if (!customer) throw createError('客户单位不存在或已停用');

  const [[dept]] = await connection.execute(
    'SELECT id FROM hr_department WHERE company_id = :companyId AND id = :deptId AND status = 1 LIMIT 1',
    { companyId, deptId: Number(body.deptId) }
  );
  if (!dept) throw createError('部门不存在或已停用');

  const [[position]] = await connection.execute(
    'SELECT id FROM hr_position WHERE company_id = :companyId AND id = :positionId AND status = 1 LIMIT 1',
    { companyId, positionId: Number(body.positionId) }
  );
  if (!position) throw createError('岗位不存在或已停用');

  await validateRecruitmentSource(companyId, body, connection);
  if (body.projectId) {
    const [[project]] = await connection.execute(
      'SELECT id FROM labor_project WHERE company_id=:companyId AND id=:projectId AND customer_id=:customerId AND status IN (1,2) LIMIT 1',
      { companyId, projectId: Number(body.projectId), customerId: Number(body.customerId) }
    );
    if (!project) throw createError('所属项目不存在、已停用或不属于客户单位');
  }
}

async function validateRecruitmentSource(companyId, body, connection = db.pool) {
  if (String(body.channelSource || '').trim()) return;
  const sourceType = Number(body.recruitmentSourceType || 0);
  if (!sourceType) return;
  if (![1, 2].includes(sourceType)) throw createError('招聘来源类型不正确');

  if (sourceType === 1) {
    if (!body.recruiterId || body.supplierId) throw createError('选择招聘人来源时必须指定招聘人');
    const [[recruiter]] = await connection.execute(
      'SELECT id FROM hr_recruiter WHERE company_id=:companyId AND id=:recruiterId AND status=1 LIMIT 1',
      { companyId, recruiterId: Number(body.recruiterId) }
    );
    if (!recruiter) throw createError('招聘人不存在或已停用');
    return;
  }

  if (!body.supplierId || body.recruiterId) throw createError('选择供应商来源时必须指定供应商');
  const [[supplier]] = await connection.execute(
    `SELECT id,contract_end_date FROM hr_recruitment_supplier
     WHERE company_id=:companyId AND id=:supplierId AND status=1 LIMIT 1`,
    { companyId, supplierId: Number(body.supplierId) }
  );
  if (!supplier) throw createError('供应商不存在或已停用');
  if (supplier.contract_end_date && supplier.contract_end_date < today()) throw createError('供应商合同已过期，不能作为新员工招聘来源');
}

async function precheckEmployee(companyId, body) {
  if (!/^\d{17}[\dXx]$/.test(String(body.idCardNo || ''))) throw createError('身份证号格式不正确');
  const [blacklisted, existing] = await Promise.all([
    db.first(
      'SELECT blacklist_reason reason,risk_level riskLevel FROM person_blacklist WHERE company_id=:companyId AND id_card_hash=:idCardHash AND status=1 LIMIT 1',
      { companyId, idCardHash: sha256(body.idCardNo) }
    ),
    db.first(
      `SELECT id,name,employee_status employeeStatus,lifecycle_status lifecycleStatus
       FROM hr_employee WHERE company_id=:companyId AND id_card_hash=:idCardHash AND deleted_at IS NULL LIMIT 1`,
      { companyId, idCardHash: sha256(body.idCardNo) }
    )
  ]);
  return {
    allowOnboarding: !blacklisted && !existing,
    checks: {
      blacklist: blacklisted ? { passed: false, reason: blacklisted.reason, riskLevel: blacklisted.riskLevel } : { passed: true },
      duplicate: existing ? { passed: false, employeeId: existing.id, employeeStatus: existing.lifecycleStatus || existing.employeeStatus } : { passed: true }
    }
  };
}

async function createWorkTask(connection, task) {
  await connection.execute(
    `INSERT INTO hr_work_task
     (company_id, employee_id, project_id, task_type, task_title, task_content, source_type, source_id,
      risk_level, task_status, assigned_user_id, deadline)
     VALUES (:companyId,:employeeId,:projectId,:taskType,:taskTitle,:taskContent,:sourceType,:sourceId,
             :riskLevel,0,:assignedUserId,:deadline)
     ON DUPLICATE KEY UPDATE task_title=VALUES(task_title), task_content=VALUES(task_content),
       risk_level=VALUES(risk_level), assigned_user_id=VALUES(assigned_user_id), deadline=VALUES(deadline), updated_at=NOW()`,
    task
  );
}

async function closeEmployeeOpenItems(connection, companyId, employeeId, operatorId, remark) {
  await connection.execute(
    `UPDATE hr_work_task
     SET task_status=3,completed_by=:operatorId,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
     WHERE company_id=:companyId AND employee_id=:employeeId AND task_status IN (0,1)`,
    { companyId, employeeId, operatorId: operatorId || null }
  );
  await connection.execute(
    `UPDATE hr_risk_alert
     SET handle_status=2,handler_id=:operatorId,handle_time=NOW(),handle_remark=:remark,updated_at=NOW()
     WHERE company_id=:companyId AND employee_id=:employeeId AND handle_status IN (0,1)`,
    { companyId, employeeId, operatorId: operatorId || null, remark }
  );
}

// 新员工确认在职后，只建立劳动合同和雇主险两项核心入职合规。
async function createOnboardingCompliance(connection, {
  companyId,
  employeeId,
  employeeName,
  projectId = null,
  operatorId = 0,
  hireDate
}) {
  const reminders = [
    {
      riskType: 1,
      riskTitle: '新员工劳动合同待签订',
      riskDesc: `${employeeName}已入职，请登记已签订的劳动合同`,
      riskKey: `contract_missing:${employeeId}`
    },
    {
      riskType: 7,
      riskTitle: '新员工雇主险待增保',
      riskDesc: `${employeeName}已入职，请办理雇主险增保`,
      riskKey: `employer_insurance_missing:${employeeId}`
    }
  ];
  for (const reminder of reminders) {
    await connection.execute(
      `INSERT INTO hr_risk_alert
       (company_id,employee_id,risk_type,risk_level,risk_title,risk_desc,risk_key,handle_status)
       VALUES (:companyId,:employeeId,:riskType,3,:riskTitle,:riskDesc,:riskKey,0)
       ON DUPLICATE KEY UPDATE risk_type=VALUES(risk_type),risk_level=VALUES(risk_level),
         risk_title=VALUES(risk_title),risk_desc=VALUES(risk_desc),handle_status=0,
         handler_id=NULL,handle_time=NULL,handle_remark=NULL,updated_at=NOW()`,
      { companyId, employeeId, ...reminder }
    );
    await noticeService.createNotice(connection, {
      companyId,
      employeeId,
      title: reminder.riskDesc,
      category: '入职待办',
      noticeType: 'warning',
      targetView: 'risk',
      dedupeKey: `notice:${reminder.riskKey}`
    });
  }

  await createWorkTask(connection, {
    companyId,
    employeeId,
    projectId,
    taskType: 'ONBOARDING_COMPLIANCE',
    taskTitle: `${employeeName}合同和雇主险待确认`,
    taskContent: '一键确认劳动合同已签和雇主险已增保',
    sourceType: 'EMPLOYEE_ONBOARDING',
    sourceId: employeeId,
    riskLevel: 3,
    assignedUserId: operatorId || null,
    deadline: `${hireDate} 23:59:59`
  });
}

async function linkExistingTalentToEmployee(connection, { companyId, employeeId, operatorId = 0 }) {
  const [[employee]] = await connection.execute(
    `SELECT e.id,e.id_card_hash,e.phone,e.employee_status,e.recruitment_channel_id,e.channel_source,e.created_by,
            j.customer_id,j.project_id,j.position_id,p.position_name
     FROM hr_employee e
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.company_id=e.company_id AND j2.employee_id=e.id ORDER BY j2.id DESC LIMIT 1
     )
     LEFT JOIN hr_position p ON p.id=j.position_id AND p.company_id=e.company_id
     WHERE e.company_id=:companyId AND e.id=:employeeId AND e.deleted_at IS NULL LIMIT 1`,
    { companyId, employeeId }
  );
  if (!employee) return null;
  const [[talent]] = await connection.execute(
    `SELECT id FROM talent_candidate
     WHERE company_id=:companyId AND employee_id IS NULL
       AND ((id_card_hash IS NOT NULL AND id_card_hash=:idCardHash) OR phone=:phone)
     ORDER BY id DESC LIMIT 1`,
    { companyId, idCardHash: employee.id_card_hash, phone: employee.phone }
  );
  if (!talent) return null;
  const isActive = Number(employee.employee_status) === 2;
  await connection.execute(
    `UPDATE talent_candidate
     SET employee_id=:employeeId,customer_id=:customerId,project_id=:projectId,position_id=:positionId,
         recruitment_channel_id=:recruitmentChannelId,intended_position=COALESCE(:intendedPosition,intended_position),
         source_channel=COALESCE(:sourceChannel,source_channel),candidate_status=:candidateStatus,
         employee_status_snapshot=:employeeStatusSnapshot,available_status=:availableStatus,flowed_at=NOW(),
         owner_user_id=COALESCE(owner_user_id,:ownerUserId),updated_at=NOW()
     WHERE company_id=:companyId AND id=:talentId AND employee_id IS NULL`,
    {
      companyId,
      talentId: talent.id,
      employeeId,
      customerId: employee.customer_id || null,
      projectId: employee.project_id || null,
      positionId: employee.position_id || null,
      recruitmentChannelId: employee.recruitment_channel_id || null,
      intendedPosition: employee.position_name || null,
      sourceChannel: employee.channel_source || null,
      candidateStatus: isActive ? 4 : 3,
      employeeStatusSnapshot: Number(employee.employee_status),
      availableStatus: isActive ? 3 : 1,
      ownerUserId: employee.created_by || operatorId || null
    }
  );
  await connection.execute(
    `INSERT INTO hr_operation_log
     (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
     VALUES (:companyId,:operatorId,'人才库','talent_employee_link',:talentId,'link',:afterData)`,
    {
      companyId,
      operatorId: operatorId || null,
      talentId: talent.id,
      afterData: JSON.stringify({ employeeId, employeeStatus: Number(employee.employee_status) })
    }
  );
  return Number(talent.id);
}

async function syncEmployeeToTalent(connection, {
  companyId,
  employeeId,
  sourceType,
  operatorId = 0,
  resignedAt = null,
  resignationReason = null
}) {
  if (!['INTERVIEW', 'INTERVIEW_REJECTED', 'UNJOINED', 'RESIGNED', 'REHIRED'].includes(sourceType)) {
    throw createError('人才库流转类型不正确');
  }
  const [[employee]] = await connection.execute(
    `SELECT e.*,j.customer_id,j.project_id,j.position_id,p.position_name
     FROM hr_employee e
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.company_id=e.company_id AND j2.employee_id=e.id
       ORDER BY j2.id DESC LIMIT 1
     )
     LEFT JOIN hr_position p ON p.id=j.position_id AND p.company_id=e.company_id
     WHERE e.company_id=:companyId AND e.id=:employeeId AND e.deleted_at IS NULL LIMIT 1`,
    { companyId, employeeId }
  );
  if (!employee) throw createError('员工不存在，无法同步人才库', 404);

  if (sourceType === 'REHIRED') {
    const [result] = await connection.execute(
      `UPDATE talent_candidate
       SET candidate_status=4,employee_status_snapshot=2,available_status=3,flowed_at=NOW(),updated_at=NOW()
       WHERE company_id=:companyId AND employee_id=:employeeId`,
      { companyId, employeeId }
    );
    if (!result.affectedRows) return;
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'人才库','talent_employee_flow',:employeeId,'sync',:afterData)`,
      {
        companyId,
        operatorId: operatorId || null,
        employeeId,
        afterData: JSON.stringify({ sourceType, employeeStatus: 2 })
      }
    );
    return;
  }

  const statusConfig = sourceType === 'RESIGNED'
    ? { candidateStatus: 1, availableStatus: 1, talentSourceType: 'RESIGNED' }
    : sourceType === 'INTERVIEW_REJECTED'
      ? { candidateStatus: 5, availableStatus: 1, talentSourceType: 'INTERVIEW_REJECTED' }
      : sourceType === 'INTERVIEW'
      ? { candidateStatus: 1, availableStatus: 1, talentSourceType: 'INTERVIEW' }
      : { candidateStatus: 2, availableStatus: 1, talentSourceType: 'UNJOINED' };

  await connection.execute(
    `INSERT INTO talent_candidate
     (company_id,employee_id,customer_id,project_id,position_id,recruitment_channel_id,name,id_card_no,id_card_hash,phone,
      intended_position,source_channel,candidate_status,talent_source_type,employee_status_snapshot,available_status,
      resigned_at,resignation_reason,flowed_at,owner_user_id,remark)
     VALUES
     (:companyId,:employeeId,:customerId,:projectId,:positionId,:recruitmentChannelId,:name,:idCardNo,:idCardHash,:phone,
      :intendedPosition,:sourceChannel,:candidateStatus,:talentSourceType,:employeeStatusSnapshot,:availableStatus,
      :resignedAt,:resignationReason,NOW(),:ownerUserId,:remark)
     ON DUPLICATE KEY UPDATE
       customer_id=VALUES(customer_id),project_id=VALUES(project_id),position_id=VALUES(position_id),
       recruitment_channel_id=VALUES(recruitment_channel_id),name=VALUES(name),id_card_no=VALUES(id_card_no),
       id_card_hash=VALUES(id_card_hash),phone=VALUES(phone),intended_position=VALUES(intended_position),
       source_channel=VALUES(source_channel),candidate_status=VALUES(candidate_status),
       talent_source_type=VALUES(talent_source_type),
       employee_status_snapshot=VALUES(employee_status_snapshot),available_status=VALUES(available_status),
       resigned_at=CASE WHEN :sourceType='RESIGNED' THEN COALESCE(VALUES(resigned_at),resigned_at) ELSE resigned_at END,
       resignation_reason=CASE WHEN :sourceType='RESIGNED' THEN COALESCE(VALUES(resignation_reason),resignation_reason) ELSE resignation_reason END,
       flowed_at=NOW(),owner_user_id=COALESCE(owner_user_id,VALUES(owner_user_id)),remark=VALUES(remark),updated_at=NOW()`,
    {
      companyId,
      employeeId,
      customerId: employee.customer_id || null,
      projectId: employee.project_id || null,
      positionId: employee.position_id || null,
      recruitmentChannelId: employee.recruitment_channel_id || null,
      name: employee.name,
      idCardNo: employee.id_card_no,
      idCardHash: employee.id_card_hash,
      phone: employee.phone,
      intendedPosition: employee.position_name || null,
      sourceChannel: employee.channel_source || null,
      candidateStatus: statusConfig.candidateStatus,
      talentSourceType: statusConfig.talentSourceType,
      employeeStatusSnapshot: Number(employee.employee_status),
      availableStatus: statusConfig.availableStatus,
      resignedAt,
      resignationReason,
      ownerUserId: employee.created_by || operatorId || null,
      remark: employee.remark || null,
      sourceType
    }
  );

  await connection.execute(
    `INSERT INTO hr_operation_log
     (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
     VALUES (:companyId,:operatorId,'人才库','talent_employee_flow',:employeeId,'sync',:afterData)`,
    {
      companyId,
      operatorId: operatorId || null,
      employeeId,
      afterData: JSON.stringify({ sourceType, employeeStatus: Number(employee.employee_status) })
    }
  );
}

async function syncResignationCompletion(connection, companyId, resignationId, operatorId = 0) {
  const [[row]] = await connection.execute(
    `SELECT r.*,e.id employee_id,e.name,
            s.social_status,s.employer_insurance_status
     FROM hr_resignation r
     JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
     LEFT JOIN hr_social_security s ON s.id=(
       SELECT s2.id FROM hr_social_security s2
       WHERE s2.company_id=r.company_id AND s2.employee_id=r.employee_id
       ORDER BY s2.id DESC LIMIT 1
     )
     WHERE r.company_id=:companyId AND r.id=:resignationId LIMIT 1`,
    { companyId, resignationId }
  );
  if (!row) throw createError('离职记录不存在', 404);

  // 交接清单用于记录实际完成项，不再要求四项全部适用于每位员工。
  const handoverCount = ['badge_returned', 'tools_returned', 'dorm_cleared', 'attendance_confirmed']
    .filter(field => Number(row[field]) === 1).length;
  const handoverDone = true;
  // 合规模块仅保留雇主险增减；历史社保状态不得继续阻塞员工离职闭环。
  const insuranceDone = Number(row.employer_insurance_status || 0) !== 1;

  await connection.execute(
    'UPDATE hr_resignation SET handover_status=:handoverStatus,updated_at=NOW() WHERE company_id=:companyId AND id=:resignationId',
    { companyId, resignationId, handoverStatus: handoverDone ? 2 : 1 }
  );
  for (const [taskType, done] of [
    ['OFFBOARD', handoverDone],
    ['INSURANCE_TERMINATION', insuranceDone]
  ]) {
    if (done) {
      await connection.execute(
        `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
         WHERE company_id=:companyId AND source_type='RESIGNATION' AND source_id=:resignationId
           AND task_type=:taskType AND task_status IN (0,1)`,
        { companyId, resignationId, taskType, operatorId }
      );
    }
  }

  const completed = handoverDone && insuranceDone;
  if (completed) {
    await connection.execute(
      `UPDATE hr_resignation SET handover_status=2,completed_by=:operatorId,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE company_id=:companyId AND id=:resignationId`,
      { companyId, resignationId, operatorId }
    );
    await connection.execute(
      "UPDATE hr_employee SET employee_status=3,lifecycle_status='LEFT',insurance_status='TERMINATED',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId",
      { companyId, employeeId: row.employee_id }
    );
    await syncEmployeeToTalent(connection, {
      companyId,
      employeeId: row.employee_id,
      sourceType: 'RESIGNED',
      operatorId,
      resignedAt: row.completed_at || `${row.leave_date} 00:00:00`,
      resignationReason: row.leave_reason || null
    });
    await connection.execute(
      'UPDATE hr_employee_job SET job_status=2,updated_at=NOW() WHERE company_id=:companyId AND employee_id=:employeeId AND job_status=1',
      { companyId, employeeId: row.employee_id }
    );
    // 离职闭环与账号状态在同一事务完成，防止离职员工继续使用已有 Token。
    await connection.execute(
      'UPDATE sys_user SET status=0,token_version=token_version+1,updated_at=NOW() WHERE company_id=:companyId AND employee_id=:employeeId AND status=1',
      { companyId, employeeId: row.employee_id }
    );
    await connection.execute(
      `UPDATE hr_work_task SET task_status=3,completed_by=:operatorId,
         completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE company_id=:companyId AND employee_id=:employeeId AND task_status IN (0,1)`,
      { companyId, employeeId: row.employee_id, operatorId: operatorId || null }
    );
    await connection.execute(
      `UPDATE hr_risk_alert SET handle_status=2,handler_id=:operatorId,handle_time=NOW(),
         handle_remark='员工已离职，相关风险关闭',updated_at=NOW()
       WHERE company_id=:companyId AND employee_id=:employeeId AND handle_status IN (0,1)`,
      { companyId, employeeId: row.employee_id, operatorId: operatorId || null }
    );
  } else {
    await connection.execute(
      "UPDATE hr_employee SET lifecycle_status='OFFBOARDING',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId AND employee_status<>3",
      { companyId, employeeId: row.employee_id }
    );
  }
  return { employeeId: row.employee_id, resignationId, handoverDone, handoverCount, insuranceDone, completed };
}

async function terminateEmployerInsuranceForResignation(connection, {
  companyId,
  employeeId,
  leaveDate,
  terminateEmployerInsurance,
  operatorId
}) {
  const [[insurance]] = await connection.execute(
    `SELECT id,employer_insurance_status
     FROM hr_social_security
     WHERE company_id=:companyId AND employee_id=:employeeId
     ORDER BY id DESC LIMIT 1`,
    { companyId, employeeId }
  );
  const covered = Number(insurance?.employer_insurance_status || 0) === 1;
  if (!covered) return { covered: false, terminated: false };
  if (Number(terminateEmployerInsurance) !== 1) {
    throw createError('该员工雇主险正在保障，请在办理离职中勾选“已减保”');
  }

  await connection.execute(
    `UPDATE hr_social_security
     SET employer_insurance_status=2,employer_end_date=:leaveDate,updated_at=NOW()
     WHERE company_id=:companyId AND id=:socialId`,
    { companyId, socialId: insurance.id, leaveDate }
  );
  await connection.execute(
    `INSERT INTO hr_operation_log
     (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
     VALUES (:companyId,:operatorId,'雇主险','employer_insurance',:socialId,'remove_on_resignation',:afterData)`,
    {
      companyId,
      operatorId: operatorId || null,
      socialId: insurance.id,
      afterData: JSON.stringify({ employeeId, employerInsuranceAction: 'REMOVE', employerInsuranceStatus: 2, leaveDate })
    }
  );
  return { covered: true, terminated: true };
}

async function createEmployee(companyId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    const [[defaultDept]] = await connection.execute(
      'SELECT id FROM hr_department WHERE company_id=:companyId AND status=1 ORDER BY sort_no,id LIMIT 1', { companyId }
    );
    // 所有客户端缺省均进入待入职；6 为面试简登状态。
    const employeeStatus = [1, 2, 5, 6].includes(Number(body.employeeStatus)) ? Number(body.employeeStatus) : 1;
    let normalizedBody = {
      ...normalizeRecruitmentChannel(body),
      employeeStatus,
      employeeNo: body.employeeNo || buildInternalEmployeeNo(),
      deptId: body.deptId || defaultDept?.id
    };
    normalizedBody = await resolveRecruitmentChannel(companyId, normalizedBody, operatorId, connection);
    await assertNewEmployeeScope(companyId, normalizedBody, user, connection);
    await validateEmployeeInput(companyId, normalizedBody, 0, connection, employeeStatus);

    const [employeeResult] = await connection.execute(
      `
      INSERT INTO hr_employee
      (company_id, employee_no, name, gender, id_card_no, id_card_hash, address, phone, email, education, bank_name, bank_card_no,
       emergency_contact, emergency_phone, channel_source, recruitment_channel_id, recruitment_source_type, recruiter_id, supplier_id,
       lifecycle_status, arrival_status, remark, employee_status, created_by)
      VALUES
      (:companyId, :employeeNo, :name, :gender, :idCardNo, :idCardHash, :address, :phone, :email, :education, :bankName, :bankCardNo,
       :emergencyContact, :emergencyPhone, :channelSource, :recruitmentChannelId, :recruitmentSourceType, :recruiterId, :supplierId,
       :lifecycleStatus, :arrivalStatus, :remark, :employeeStatus, :createdBy)
      `,
      {
        companyId,
        employeeNo: normalizedBody.employeeNo,
        name: body.name,
        gender: Number(body.gender || 0),
        idCardNo: encrypt(body.idCardNo),
        idCardHash: sha256(body.idCardNo),
        address: encrypt(body.address),
        phone: body.phone,
        email: body.email || null,
        education: body.education || null,
        bankName: body.bankName || null,
        bankCardNo: encrypt(body.bankCardNo),
        emergencyContact: body.emergencyContact || null,
        emergencyPhone: body.emergencyPhone || null,
        channelSource: normalizedBody.channelSource || null,
        recruitmentChannelId: normalizedBody.recruitmentChannelId || null,
        recruitmentSourceType: normalizedBody.recruitmentSourceType ? Number(normalizedBody.recruitmentSourceType) : null,
        recruiterId: normalizedBody.recruiterId ? Number(normalizedBody.recruiterId) : null,
        supplierId: normalizedBody.supplierId ? Number(normalizedBody.supplierId) : null,
        lifecycleStatus: employeeStatus === 6 ? 'INTERVIEW' : employeeStatus === 1 ? 'PENDING_ARRIVAL' : employeeStatus === 5 ? 'NOT_JOINED' : 'ONBOARDING',
        arrivalStatus: employeeStatus === 5 ? 'NO_SHOW' : employeeStatus === 2 ? 'CONFIRMED' : 'PENDING',
        remark: body.remark || null,
        employeeStatus,
        createdBy: operatorId || null
      }
    );

    const employeeId = employeeResult.insertId;
    // 面试人员可只建立基础档案；已选客户和岗位时才建立可继续补齐的任职记录。
    if (normalizedBody.customerId && body.positionId) {
      await connection.execute(
        `
        INSERT INTO hr_employee_job
        (company_id, employee_id, customer_id, project_id, dept_id, position_id, employment_type, fee_mode, work_type, hire_date, regular_date, direct_leader_id, job_status, remark)
        VALUES
        (:companyId, :employeeId, :customerId, :projectId, :deptId, :positionId, :employmentType, :feeMode, :workType, :hireDate, :regularDate, :directLeaderId, 1, NULL)
        `,
        {
          companyId,
          employeeId,
          customerId: Number(normalizedBody.customerId),
          projectId: normalizedBody.projectId ? Number(normalizedBody.projectId) : null,
          deptId: Number(normalizedBody.deptId),
          positionId: Number(body.positionId),
          employmentType: body.employmentType ? Number(body.employmentType) : null,
          feeMode: normalizeFeeMode(body.feeMode),
          workType: body.workType ? Number(body.workType) : null,
          hireDate: body.hireDate || null,
          regularDate: body.regularDate || null,
          directLeaderId: body.directLeaderId ? Number(body.directLeaderId) : null
        }
      );
    }

    // 已有招聘线索按身份证摘要或手机号绑定到新员工，避免人才库出现重复人员。
    await linkExistingTalentToEmployee(connection, { companyId, employeeId, operatorId });

    if (employeeStatus === 1) {
      await createWorkTask(connection, {
        companyId,
        employeeId,
        projectId: normalizedBody.projectId ? Number(normalizedBody.projectId) : null,
        taskType: 'ARRIVAL',
        taskTitle: `${body.name}待确认到岗`,
        taskContent: '请确认员工是否按计划到岗',
        sourceType: 'EMPLOYEE_ONBOARDING',
        sourceId: employeeId,
        riskLevel: 1,
        assignedUserId: operatorId || null,
        deadline: body.plannedArrivalAt || `${body.hireDate} 18:00:00`
      });
    }

    if (employeeStatus === 2) {
      await createOnboardingCompliance(connection, {
        companyId,
        employeeId,
        employeeName: body.name,
        projectId: normalizedBody.projectId ? Number(normalizedBody.projectId) : null,
        operatorId,
        hireDate: body.hireDate
      });
    }

    if (employeeStatus === 5) {
      await syncEmployeeToTalent(connection, {
        companyId,
        employeeId,
        sourceType: 'UNJOINED',
        operatorId
      });
    }

    if (employeeStatus === 6) {
      await syncEmployeeToTalent(connection, {
        companyId,
        employeeId,
        sourceType: 'INTERVIEW',
        operatorId
      });
    }

    await connection.execute(
      `
      INSERT INTO hr_operation_log
      (company_id, operator_id, module_name, biz_type, biz_id, action_type, after_data)
      VALUES (:companyId, :operatorId, '员工花名册', 'employee', :employeeId, 'create', :afterData)
      `,
      { companyId, operatorId, employeeId, afterData: JSON.stringify({ name: body.name, employeeStatus }) }
    );

    return { employeeId };
  });
}

async function createEmployeesBatch(companyId, rows, operatorId = 0, user = null) {
  if (!Array.isArray(rows) || rows.length === 0) throw createError('批量名单不能为空');
  if (rows.length > 200) throw createError('单次最多录入200人');
  const [customers, positions, projects] = await Promise.all([
    db.query('SELECT id, customer_name FROM crm_customer WHERE company_id=:companyId AND status=1', { companyId }),
    db.query('SELECT id, position_name FROM hr_position WHERE company_id=:companyId AND status=1', { companyId }),
    db.query('SELECT id,customer_id,project_name FROM labor_project WHERE company_id=:companyId AND status IN (1,2)', { companyId })
  ]);
  const customerMap = new Map(customers.map(item => [item.customer_name.trim(), item.id]));
  const positionMap = new Map(positions.map(item => [item.position_name.trim(), item.id]));
  const projectMap = new Map(projects.map(item => [`${item.customer_id}::${item.project_name.trim()}`, item.id]));
  const genderMap = { 未知: 0, 男: 1, 女: 2 };
  const workMap = { 计时: 1, 计件: 2, 混合: 3 };
  const employeeStatusMap = { 待入职: 1, 直接入职: 2, 在职: 2, 未入职: 5, 面试: 6 };
  const errors = [];
  const warnings = [];
  let successCount = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    try {
      const employeeStatusRaw = String(row.employeeStatus || '').trim();
      const employeeStatus = employeeStatusRaw
        ? (employeeStatusMap[employeeStatusRaw] || (/^[1256]$/.test(employeeStatusRaw) ? Number(employeeStatusRaw) : 0))
        : 1;
      if (!employeeStatus) throw createError(`录入状态"${employeeStatusRaw}"无效，请填写待入职/直接入职/未入职/面试`);
      const customerId = customerMap.get(String(row.customerName || '').trim());
      const positionId = positionMap.get(String(row.positionName || '').trim());
      if (employeeStatus !== 6 && !customerId) throw createError(`客户单位"${row.customerName || ''}"不存在`);
      if (employeeStatus !== 6 && !positionId) throw createError(`岗位"${row.positionName || ''}"不存在`);
      const projectName = String(row.projectName || '').trim();
      const projectId = projectName ? (customerId ? projectMap.get(`${customerId}::${projectName}`) : null) : null;
      if (projectName && !projectId) throw createError(`所属项目"${projectName}"不存在或不属于所选客户`);

      // 用工和计费信息可后续补齐，但已填内容仍需校验字典和长度。
      const employmentRaw = String(row.employmentType || '').trim();
      const employmentType = employmentRaw ? normalizeEmploymentType(employmentRaw) : null;
      const feeMode = normalizeFeeMode(row.feeMode);

      // 工资类型(workType)：填了但不在合法范围 → 自动纠错为计时(1)；没填 → 默认计时(1)
      const workRaw = String(row.workType || '').trim();
      let workType = workMap[workRaw];
      const workWarning = (workRaw && workType === undefined)
        ? `工资类型"${workRaw}"无效，已自动按计时处理`
        : null;
      if (workType === undefined) workType = 1;

      const rowWarnings = [workWarning].filter(Boolean);
      await createEmployee(companyId, {
        ...row,
        gender: genderMap[String(row.gender || '未知').trim()] ?? 0,
        customerId,
        projectId,
        positionId,
        employmentType,
        feeMode,
        workType,
        employeeStatus
      }, operatorId, user);
      successCount += 1;
      if (rowWarnings.length) {
        warnings.push({ row: index + 1, name: row.name || '', messages: rowWarnings });
      }
    } catch (error) {
      errors.push({ row: index + 1, name: row.name || '', message: error.message });
    }
  }
  return { total: rows.length, successCount, failureCount: errors.length, warningCount: warnings.length, errors, warnings };
}

async function updateEmployee(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const [[currentJobForDept]] = await connection.execute(
      'SELECT dept_id,customer_id,project_id FROM hr_employee_job WHERE company_id=:companyId AND employee_id=:employeeId AND job_status=1 LIMIT 1',
      { companyId, employeeId }
    );
    const [[employee]] = await connection.execute(
      'SELECT * FROM hr_employee WHERE company_id = :companyId AND id = :employeeId AND deleted_at IS NULL LIMIT 1',
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工不存在', 404);
    const canViewSensitiveEmployee = user?.permissions?.includes('employee:sensitive:view');
    const sensitiveBody = canViewSensitiveEmployee
      ? {
          idCardNo: body.idCardNo,
          address: body.address,
          phone: body.phone,
          bankCardNo: body.bankCardNo,
          emergencyPhone: body.emergencyPhone
        }
      : {
          idCardNo: decrypt(employee.id_card_no),
          address: decrypt(employee.address),
          phone: employee.phone,
          bankCardNo: decrypt(employee.bank_card_no),
          emergencyPhone: employee.emergency_phone
        };
    let normalizedBody = {
      ...normalizeRecruitmentChannel(body),
      ...sensitiveBody,
      employeeStatus: Number(employee.employee_status),
      employeeNo: employee.employee_no,
      deptId: body.deptId || currentJobForDept?.dept_id
    };
    normalizedBody = await resolveRecruitmentChannel(companyId, normalizedBody, operatorId, connection);
    const ownsUnassignedLegacyEmployee = Number(user?.dataScope) === 5
      && Number(employee.created_by) === Number(user?.id)
      && !currentJobForDept?.project_id
      && !normalizedBody.projectId
      && Number(currentJobForDept?.customer_id) === Number(normalizedBody.customerId);
    if (!ownsUnassignedLegacyEmployee) {
      await assertNewEmployeeScope(companyId, normalizedBody, user, connection);
    }
    await validateEmployeeInput(companyId, normalizedBody, employeeId, connection, employee.employee_status);

    await connection.execute(
      `
      UPDATE hr_employee
      SET employee_no = :employeeNo,
          name = :name,
          gender = :gender,
          id_card_no = :idCardNo,
          id_card_hash = :idCardHash,
          address = :address,
          phone = :phone,
          email = :email,
          education = :education,
          bank_name = :bankName,
          bank_card_no = :bankCardNo,
          emergency_contact = :emergencyContact,
          emergency_phone = :emergencyPhone,
          channel_source = :channelSource,
          recruitment_channel_id = :recruitmentChannelId,
          recruitment_source_type = :recruitmentSourceType,
          recruiter_id = :recruiterId,
          supplier_id = :supplierId,
          remark = :remark,
          updated_at = NOW()
      WHERE company_id = :companyId AND id = :employeeId
      `,
      {
        companyId,
        employeeId,
        employeeNo: normalizedBody.employeeNo,
        name: body.name,
        gender: Number(body.gender || 0),
        idCardNo: encrypt(normalizedBody.idCardNo),
        idCardHash: sha256(normalizedBody.idCardNo),
        address: encrypt(normalizedBody.address),
        phone: normalizedBody.phone,
        email: body.email || null,
        education: body.education || null,
        bankName: body.bankName || null,
        bankCardNo: encrypt(normalizedBody.bankCardNo),
        emergencyContact: body.emergencyContact || null,
        emergencyPhone: normalizedBody.emergencyPhone || null,
        channelSource: normalizedBody.channelSource || null,
        recruitmentChannelId: normalizedBody.recruitmentChannelId || null,
        recruitmentSourceType: normalizedBody.recruitmentSourceType ? Number(normalizedBody.recruitmentSourceType) : null,
        recruiterId: normalizedBody.recruiterId ? Number(normalizedBody.recruiterId) : null,
        supplierId: normalizedBody.supplierId ? Number(normalizedBody.supplierId) : null,
        remark: body.remark || null
      }
    );

    const jobPayload = {
      companyId,
      employeeId,
      customerId: normalizedBody.customerId ? Number(normalizedBody.customerId) : null,
      projectId: normalizedBody.projectId ? Number(normalizedBody.projectId) : null,
      deptId: Number(normalizedBody.deptId),
      positionId: body.positionId ? Number(body.positionId) : null,
      employmentType: body.employmentType ? Number(body.employmentType) : null,
      feeMode: normalizeFeeMode(body.feeMode),
      workType: body.workType ? Number(body.workType) : null,
      hireDate: body.hireDate || null
    };
    if (currentJobForDept) {
      await connection.execute(
        `
        UPDATE hr_employee_job
        SET customer_id = :customerId,
            project_id = :projectId,
            dept_id = :deptId,
            position_id = :positionId,
            employment_type = :employmentType,
            fee_mode = :feeMode,
            work_type = :workType,
            hire_date = :hireDate,
            updated_at = NOW()
        WHERE company_id = :companyId AND employee_id = :employeeId AND job_status = 1
        `,
        jobPayload
      );
    } else if (jobPayload.customerId && jobPayload.positionId) {
      await connection.execute(
        `INSERT INTO hr_employee_job
         (company_id,employee_id,customer_id,project_id,dept_id,position_id,employment_type,fee_mode,work_type,hire_date,job_status)
         VALUES (:companyId,:employeeId,:customerId,:projectId,:deptId,:positionId,:employmentType,:feeMode,:workType,:hireDate,1)`,
        jobPayload
      );
    }

    if (Number(employee.employee_status) === 6) {
      await syncEmployeeToTalent(connection, { companyId, employeeId, sourceType: 'INTERVIEW', operatorId });
    }

    await connection.execute(
      `
      INSERT INTO hr_operation_log
      (company_id, operator_id, module_name, biz_type, biz_id, action_type, after_data)
      VALUES (:companyId, :operatorId, '员工花名册', 'employee', :employeeId, 'update', :afterData)
      `,
      { companyId, operatorId, employeeId, afterData: JSON.stringify({ name: body.name }) }
    );

    if ([3, 5].includes(Number(employee.employee_status))) {
      await syncEmployeeToTalent(connection, {
        companyId,
        employeeId,
        sourceType: Number(employee.employee_status) === 3 ? 'RESIGNED' : 'UNJOINED',
        operatorId
      });
    }

    return { employeeId };
  });
}

async function transferJob(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const [[employee]] = await connection.execute(
      'SELECT * FROM hr_employee WHERE company_id = :companyId AND id = :employeeId AND deleted_at IS NULL LIMIT 1',
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工不存在', 404);
    if (Number(employee.employee_status) === 3) throw createError('离职员工不能调岗');
    if (!body.newCustomerId || !body.newPositionId || !body.effectiveDate) throw createError('请完整填写单位、岗位和生效日期');

    const [[newCustomer]] = await connection.execute(
      'SELECT id FROM crm_customer WHERE company_id=:companyId AND id=:customerId AND status=1 LIMIT 1',
      { companyId, customerId: Number(body.newCustomerId) }
    );
    if (!newCustomer) throw createError('客户单位不存在或已停用');

    const [[currentJob]] = await connection.execute(
      'SELECT * FROM hr_employee_job WHERE company_id = :companyId AND employee_id = :employeeId AND job_status = 1 LIMIT 1',
      { companyId, employeeId }
    );
    if (!currentJob) throw createError('当前任职记录不存在');

    const currentProjectId = Number(currentJob.project_id || 0) || null;
    const crossCustomer = Number(currentJob.customer_id) !== Number(body.newCustomerId);
    // 同客户只调岗位时沿用原项目，避免员工因前端漏传项目而脱离驻厂数据范围。
    const targetProjectId = Number(body.newProjectId || 0) || (crossCustomer ? null : currentProjectId);
    if (crossCustomer && !targetProjectId) throw createError('跨客户转岗必须选择目标项目');

    const [[targetPosition]] = await connection.execute(
      'SELECT id FROM hr_position WHERE company_id=:companyId AND id=:positionId AND status=1 LIMIT 1',
      { companyId, positionId: Number(body.newPositionId) }
    );
    if (!targetPosition) throw createError('目标岗位不存在或已停用');

    let targetProject = null;
    if (targetProjectId) {
      const [[project]] = await connection.execute(
        `SELECT id,customer_id,manager_user_id FROM labor_project
         WHERE company_id=:companyId AND id=:projectId AND status IN (1,2) LIMIT 1`,
        { companyId, projectId: targetProjectId }
      );
      if (!project || Number(project.customer_id) !== Number(body.newCustomerId)) {
        throw createError('目标项目不存在或不属于所选客户');
      }
      targetProject = project;
    }

    const crossProject = currentProjectId !== targetProjectId;
    if (!crossCustomer && !crossProject && Number(currentJob.position_id) === Number(body.newPositionId)) {
      throw createError('目标客户、项目和岗位均未变化，无需提交转岗');
    }
    if (crossProject || crossCustomer) {
      const [[activeChange]] = await connection.execute(
        `SELECT id FROM hr_employee_change WHERE company_id=:companyId AND employee_id=:employeeId
         AND change_type='TRANSFER' AND change_status IN ('PENDING_ACCEPTANCE','PENDING_HR_REVIEW','APPROVED') LIMIT 1`,
        { companyId, employeeId }
      );
      if (activeChange) throw createError('员工已有未完成的转岗申请');
      const changeStatus = crossCustomer ? 'PENDING_HR_REVIEW' : 'PENDING_ACCEPTANCE';
      const [changeResult] = await connection.execute(
        `INSERT INTO hr_employee_change
         (company_id,employee_id,change_type,source_project_id,target_project_id,target_customer_id,target_position_id,
          effective_date,reason_text,change_status,created_by)
         VALUES (:companyId,:employeeId,'TRANSFER',:sourceProjectId,:targetProjectId,:targetCustomerId,:targetPositionId,
          :effectiveDate,:reasonText,:changeStatus,:operatorId)`,
        {
          companyId,
          employeeId,
          sourceProjectId: currentProjectId,
          targetProjectId,
          targetCustomerId: Number(body.newCustomerId),
          targetPositionId: Number(body.newPositionId),
          effectiveDate: body.effectiveDate,
          reasonText: body.remark || null,
          changeStatus,
          operatorId
        }
      );
      await connection.execute(
        "UPDATE hr_employee SET lifecycle_status='TRANSFERRING',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId",
        { companyId, employeeId }
      );
      await createWorkTask(connection, {
        companyId,
        employeeId,
        projectId: targetProjectId,
        taskType: 'TRANSFER_ACCEPTANCE',
        taskTitle: `${employee.name}跨项目转岗待接收`,
        taskContent: crossCustomer ? '跨客户转岗，请企业HR复核' : '请目标项目驻厂人员确认接收',
        sourceType: 'EMPLOYEE_CHANGE',
        sourceId: changeResult.insertId,
        riskLevel: crossCustomer ? 2 : 1,
        assignedUserId: targetProject?.manager_user_id || null,
        deadline: `${body.effectiveDate} 18:00:00`
      });
      return { employeeId, changeId: changeResult.insertId, changeStatus };
    }

    await connection.execute('UPDATE hr_employee_job SET job_status = 2, updated_at = NOW() WHERE id = :id', { id: currentJob.id });

    const [jobResult] = await connection.execute(
      `
      INSERT INTO hr_employee_job
      (company_id, employee_id, customer_id, project_id, dept_id, position_id, employment_type, fee_mode, work_type, hire_date, probation_months,
       regular_date, work_location, direct_leader_id, job_status, remark)
      VALUES
      (:companyId, :employeeId, :customerId, :projectId, :deptId, :positionId, :employmentType, :feeMode, :workType, :hireDate, :probationMonths,
       :regularDate, :workLocation, :directLeaderId, 1, :remark)
      `,
      {
        companyId,
        employeeId,
        customerId: Number(body.newCustomerId),
        projectId: targetProjectId,
        deptId: currentJob.dept_id,
        positionId: Number(body.newPositionId),
        employmentType: currentJob.employment_type,
        feeMode: currentJob.fee_mode || '',
        workType: currentJob.work_type,
        hireDate: body.effectiveDate,
        probationMonths: currentJob.probation_months || 0,
        regularDate: currentJob.regular_date || null,
        workLocation: currentJob.work_location || null,
        directLeaderId: body.directLeaderId ? Number(body.directLeaderId) : null,
        remark: body.remark || null
      }
    );

    await connection.execute(
      `
      INSERT INTO hr_operation_log
      (company_id, operator_id, module_name, biz_type, biz_id, action_type, before_data, after_data)
      VALUES (:companyId, :operatorId, '员工调岗', 'employee_job', :jobId, 'transfer', :beforeData, :afterData)
      `,
      {
        companyId,
        operatorId,
        jobId: jobResult.insertId,
        beforeData: JSON.stringify({ deptId: currentJob.dept_id, positionId: currentJob.position_id }),
        afterData: JSON.stringify({ ...body, previousCustomerId: currentJob.customer_id })
      }
    );

    return { employeeId, jobId: jobResult.insertId };
  });
}

async function handleTransfer(companyId, changeId, approved, operatorId, user) {
  return db.transaction(async connection => {
    const [[change]] = await connection.execute(
      `SELECT c.*,j.id current_job_id,j.dept_id,j.employment_type,j.fee_mode,j.work_type,
              j.probation_months,j.regular_date,j.work_location
       FROM hr_employee_change c
       JOIN hr_employee_job j ON j.employee_id=c.employee_id AND j.company_id=c.company_id AND j.job_status=1
       WHERE c.company_id=:companyId AND c.id=:changeId
         AND c.change_status IN ('PENDING_ACCEPTANCE','PENDING_HR_REVIEW') LIMIT 1`,
      { companyId, changeId }
    );
    if (!change) throw createError('转岗申请不存在或已处理', 404);
    const isAdminOrHr = (user.roles || []).some(role => ['company_admin', 'hr_manager'].includes(role.roleCode));
    if (change.change_status === 'PENDING_HR_REVIEW' && !isAdminOrHr) throw createError('跨客户转岗必须由企业HR复核', 403);
    if (change.change_status === 'PENDING_ACCEPTANCE' && Number(user.dataScope) !== 1) {
      const [[authorized]] = await connection.execute(
        'SELECT 1 FROM sys_user_project WHERE user_id=:userId AND project_id=:projectId LIMIT 1',
        { userId: Number(user.id), projectId: Number(change.target_project_id) }
      );
      if (!authorized) throw createError('仅目标项目驻厂人员可以处理转岗接收', 403);
    }
    if (!approved) {
      await connection.execute(
        `UPDATE hr_employee_change SET change_status='REJECTED',handled_by=:operatorId,handled_at=NOW(),updated_at=NOW()
         WHERE id=:changeId`,
        { changeId, operatorId }
      );
      await connection.execute(
        "UPDATE hr_employee SET lifecycle_status='ACTIVE',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId",
        { companyId, employeeId: change.employee_id }
      );
      await connection.execute(
        `UPDATE hr_work_task SET task_status=3,completed_by=:operatorId,completed_at=NOW(),updated_at=NOW()
         WHERE company_id=:companyId AND source_type='EMPLOYEE_CHANGE' AND source_id=:changeId AND task_status IN (0,1)`,
        { companyId, changeId, operatorId }
      );
      return { changeId, changeStatus: 'REJECTED' };
    }

    await connection.execute('UPDATE hr_employee_job SET job_status=2,updated_at=NOW() WHERE id=:jobId', { jobId: change.current_job_id });
    const [jobResult] = await connection.execute(
      `INSERT INTO hr_employee_job
       (company_id,employee_id,customer_id,project_id,dept_id,position_id,employment_type,fee_mode,work_type,hire_date,
        probation_months,regular_date,work_location,job_status,remark)
       VALUES (:companyId,:employeeId,:customerId,:projectId,:deptId,:positionId,:employmentType,:feeMode,:workType,
        :hireDate,:probationMonths,:regularDate,:workLocation,1,:remark)`,
      {
        companyId,
        employeeId: change.employee_id,
        customerId: change.target_customer_id,
        projectId: change.target_project_id,
        deptId: change.dept_id,
        positionId: change.target_position_id,
        employmentType: change.employment_type,
        feeMode: change.fee_mode || '',
        workType: change.work_type,
        hireDate: change.effective_date,
        probationMonths: change.probation_months || 0,
        regularDate: change.regular_date || null,
        workLocation: change.work_location || null,
        remark: change.reason_text || null
      }
    );
    await connection.execute(
      `UPDATE hr_employee_change SET change_status='COMPLETED',handled_by=:operatorId,handled_at=NOW(),updated_at=NOW()
       WHERE id=:changeId`,
      { changeId, operatorId }
    );
    await connection.execute(
      "UPDATE hr_employee SET lifecycle_status='ACTIVE',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId",
      { companyId, employeeId: change.employee_id }
    );
    await connection.execute(
      `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=NOW(),updated_at=NOW()
       WHERE company_id=:companyId AND source_type='EMPLOYEE_CHANGE' AND source_id=:changeId AND task_status IN (0,1)`,
      { companyId, changeId, operatorId }
    );
    return { changeId, changeStatus: 'COMPLETED', jobId: jobResult.insertId };
  });
}

async function resignEmployee(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const [[employee]] = await connection.execute(
      'SELECT * FROM hr_employee WHERE company_id = :companyId AND id = :employeeId AND deleted_at IS NULL LIMIT 1',
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工不存在', 404);
    if (Number(employee.employee_status) === 3) throw createError('员工已离职，不能重复办理');
    if (employee.lifecycle_status === 'OFFBOARDING') throw createError('员工正在办理离职，请打开离职页面继续办结');
    if (!body.leaveDate || !body.leaveType || !body.leaveReason) throw createError('请完整填写离职信息');
    const leaveType = Number(body.leaveType);
    if (![1, 2, 3, 4].includes(leaveType)) throw createError('离职类型不正确');
    const [[currentJob]] = await connection.execute(
      'SELECT * FROM hr_employee_job WHERE company_id = :companyId AND employee_id = :employeeId AND job_status = 1 LIMIT 1',
      { companyId, employeeId }
    );
    if (currentJob && body.leaveDate < currentJob.hire_date) throw createError('离职日期不能早于入职日期');

    await terminateEmployerInsuranceForResignation(connection, {
      companyId,
      employeeId,
      leaveDate: body.leaveDate,
      terminateEmployerInsurance: body.terminateEmployerInsurance,
      operatorId
    });

    const [resignationResult] = await connection.execute(
      `
      INSERT INTO hr_resignation
      (company_id, employee_id, apply_date, leave_date, leave_type, leave_reason, handover_status,
       badge_returned, tools_returned, dorm_cleared, attendance_confirmed, settlement_status, risk_remark)
      VALUES
      (:companyId, :employeeId, :applyDate, :leaveDate, :leaveType, :leaveReason, :handoverStatus,
       :badgeReturned, :toolsReturned, :dormCleared, :attendanceConfirmed, :settlementStatus, :riskRemark)
      `,
      {
        companyId,
        employeeId,
        applyDate: body.applyDate || null,
        leaveDate: body.leaveDate,
        leaveType,
        leaveReason: String(body.leaveReason).trim(),
        handoverStatus: 2,
        badgeReturned: Number(body.badgeReturned) === 1 ? 1 : 0,
        toolsReturned: Number(body.toolsReturned) === 1 ? 1 : 0,
        dormCleared: Number(body.dormCleared) === 1 ? 1 : 0,
        attendanceConfirmed: Number(body.attendanceConfirmed) === 1 ? 1 : 0,
        // 历史字段保留为 1，仅用于兼容旧数据库结构，不再参与业务判断。
        settlementStatus: 1,
        riskRemark: body.riskRemark || null
      }
    );

    await noticeService.createNotice(connection, {
      companyId,
      employeeId,
      title: `${employee.name}离职已办结并归档`,
      category: '员工离职',
      noticeType: 'success',
      targetView: 'roster',
      dedupeKey: `resign:${resignationResult.insertId}`
    });

    const progress = await syncResignationCompletion(connection, companyId, resignationResult.insertId, operatorId);

    await connection.execute(
      `
      INSERT INTO hr_operation_log
      (company_id, operator_id, module_name, biz_type, biz_id, action_type, before_data, after_data)
      VALUES (:companyId, :operatorId, '员工离职', 'resignation', :resignationId, 'resign', :beforeData, :afterData)
      `,
      {
        companyId,
        operatorId,
        resignationId: resignationResult.insertId,
        beforeData: JSON.stringify({ employeeStatus: employee.employee_status }),
        afterData: JSON.stringify(body)
      }
    );

    return progress;
  });
}

async function updateResignationProgress(companyId, resignationId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    const [[resignation]] = await connection.execute(
      'SELECT * FROM hr_resignation WHERE company_id=:companyId AND id=:resignationId LIMIT 1',
      { companyId, resignationId }
    );
    if (!resignation) throw createError('离职记录不存在', 404);
    await assertEmployeeScope(companyId, resignation.employee_id, user, connection);
    if (resignation.completed_at) throw createError('离职流程已完成，不能重复修改');

    const value = (field, current) => body[field] === undefined ? Number(current || 0) : (Number(body[field]) === 1 ? 1 : 0);
    const payload = {
      companyId,
      resignationId,
      badgeReturned: value('badgeReturned', resignation.badge_returned),
      toolsReturned: value('toolsReturned', resignation.tools_returned),
      dormCleared: value('dormCleared', resignation.dorm_cleared),
      attendanceConfirmed: value('attendanceConfirmed', resignation.attendance_confirmed),
      riskRemark: body.riskRemark === undefined ? resignation.risk_remark : (body.riskRemark || null)
    };
    await terminateEmployerInsuranceForResignation(connection, {
      companyId,
      employeeId: resignation.employee_id,
      leaveDate: resignation.leave_date,
      terminateEmployerInsurance: body.terminateEmployerInsurance,
      operatorId
    });
    await connection.execute(
      `UPDATE hr_resignation
       SET badge_returned=:badgeReturned,tools_returned=:toolsReturned,dorm_cleared=:dormCleared,
           attendance_confirmed=:attendanceConfirmed,settlement_status=1,
           risk_remark=:riskRemark,updated_at=NOW()
       WHERE company_id=:companyId AND id=:resignationId`,
      payload
    );
    const progress = await syncResignationCompletion(connection, companyId, resignationId, operatorId);
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,before_data,after_data)
       VALUES (:companyId,:operatorId,'员工离职','resignation',:resignationId,'update',:beforeData,:afterData)`,
      {
        companyId,
        operatorId,
        resignationId,
        beforeData: JSON.stringify(resignation),
        afterData: JSON.stringify(payload)
      }
    );
    return progress;
  });
}

async function onboardEmployee(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const [[employee]] = await connection.execute(
      `SELECT e.id,e.name,e.employee_status,e.id_card_no,e.phone,
              j.id job_id,j.customer_id,j.project_id,j.position_id,j.employment_type,j.work_type,j.hire_date
       FROM hr_employee e
       LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
       WHERE e.company_id=:companyId AND e.id=:employeeId AND e.deleted_at IS NULL LIMIT 1`,
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工不存在', 404);
    if (Number(employee.employee_status) === 3) throw createError('离职员工不能重新确认入职');
    if (Number(employee.employee_status) === 2) throw createError('员工已在职，无需重复确认');
    if (Number(employee.employee_status) !== 1) throw createError('该员工已不在待到岗状态，请刷新列表');
    const missingFields = [];
    if (!decrypt(employee.id_card_no)) missingFields.push('身份证号');
    if (!employee.phone) missingFields.push('手机号');
    if (!employee.customer_id) missingFields.push('客户单位');
    if (!employee.position_id) missingFields.push('岗位');
    if (!employee.employment_type) missingFields.push('用工模式');
    if (!employee.work_type) missingFields.push('工资类型');
    if (!body.hireDate && !employee.hire_date) missingFields.push('入职日期');
    if (missingFields.length) {
      throw createError(`请先编辑并补齐入职资料：${missingFields.join('、')}`);
    }
    if (!employee.job_id) throw createError('请先编辑并补齐客户与岗位信息');
    const hireDate = body.hireDate || employee.hire_date;

    await connection.execute(
      `UPDATE hr_employee
       SET employee_status=2,lifecycle_status='ONBOARDING',arrival_status='CONFIRMED',source_locked=1,
           source_confirmed_at=NOW(),risk_level=3,updated_at=NOW()
       WHERE company_id=:companyId AND id=:employeeId`,
      { companyId, employeeId }
    );
    await connection.execute(
      'UPDATE hr_employee_job SET hire_date=:hireDate, remark=:remark, updated_at=NOW() WHERE id=:jobId',
      { hireDate, remark: body.remark || null, jobId: employee.job_id }
    );

    await createOnboardingCompliance(connection, {
      companyId,
      employeeId,
      employeeName: employee.name,
      projectId: employee.project_id || null,
      operatorId,
      hireDate
    });

    // 入职状态与到岗待办必须在同一事务完成，避免页面仍显示“确认入职”。
    await connection.execute(
      `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,
         completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE company_id=:companyId AND employee_id=:employeeId
         AND task_type='ARRIVAL' AND task_status IN (0,1)`,
      { companyId, employeeId, operatorId }
    );

    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id, operator_id, module_name, biz_type, biz_id, action_type, before_data, after_data)
       VALUES (:companyId, :operatorId, '员工入职', 'employee', :employeeId, 'onboard', :beforeData, :afterData)`,
      {
        companyId,
        operatorId,
        employeeId,
        beforeData: JSON.stringify({ employeeStatus: employee.employee_status }),
        afterData: JSON.stringify({ employeeStatus: 2, hireDate, remark: body.remark || '' })
      }
    );

    await syncEmployeeToTalent(connection, {
      companyId,
      employeeId,
      sourceType: 'REHIRED',
      operatorId
    });

    return { employeeId, employeeStatus: 2, hireDate };
  });
}

async function handleInterviewResult(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const [[employee]] = await connection.execute(
      `SELECT e.id,e.name,e.employee_status,j.project_id
       FROM hr_employee e
       LEFT JOIN hr_employee_job j ON j.id=(
         SELECT j2.id FROM hr_employee_job j2
         WHERE j2.company_id=e.company_id AND j2.employee_id=e.id
         ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
       )
       WHERE e.company_id=:companyId AND e.id=:employeeId AND e.deleted_at IS NULL LIMIT 1`,
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工不存在', 404);
    if (Number(employee.employee_status) !== 6) throw createError('该员工已不在面试状态，请刷新列表');

    const result = String(body.result || '').trim().toUpperCase();
    if (!['PENDING_ARRIVAL', 'REJECTED'].includes(result)) throw createError('面试结果不正确');

    if (result === 'PENDING_ARRIVAL') {
      await connection.execute(
        "UPDATE hr_employee SET employee_status=1,lifecycle_status='PENDING_ARRIVAL',arrival_status='PENDING',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId",
        { companyId, employeeId }
      );
      await connection.execute(
        `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
         WHERE company_id=:companyId AND employee_id=:employeeId AND task_type='ARRIVAL' AND task_status IN (0,1)`,
        { companyId, employeeId, operatorId: operatorId || null }
      );
      await createWorkTask(connection, {
        companyId,
        employeeId,
        projectId: employee.project_id || null,
        taskType: 'ARRIVAL',
        taskTitle: `${employee.name}待确认到岗`,
        taskContent: body.remark || '确认员工是否到岗入职',
        sourceType: 'EMPLOYEE_INTERVIEW',
        sourceId: employeeId,
        riskLevel: 2,
        assignedUserId: operatorId || null,
        deadline: null
      });
    } else {
      await connection.execute(
        "UPDATE hr_employee SET employee_status=5,lifecycle_status='NOT_JOINED',arrival_status='NO_SHOW',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId",
        { companyId, employeeId }
      );
      await closeEmployeeOpenItems(connection, companyId, employeeId, operatorId, '面试未通过或不做');
      await syncEmployeeToTalent(connection, { companyId, employeeId, sourceType: 'INTERVIEW_REJECTED', operatorId });
    }

    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,before_data,after_data)
       VALUES (:companyId,:operatorId,'员工生命周期','employee',:employeeId,'update',:beforeData,:afterData)`,
      {
        companyId,
        operatorId: operatorId || null,
        employeeId,
        beforeData: JSON.stringify({ employeeStatus: 6 }),
        afterData: JSON.stringify({ result, remark: body.remark || '' })
      }
    );
    return { employeeId, result, employeeStatus: result === 'PENDING_ARRIVAL' ? 1 : 5 };
  });
}

async function handleArrivalResult(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const [[employee]] = await connection.execute(
      `SELECT id,employee_status FROM hr_employee
       WHERE company_id=:companyId AND id=:employeeId AND deleted_at IS NULL LIMIT 1`,
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工不存在', 404);
    if (Number(employee.employee_status) !== 1) throw createError('该员工已不在待到岗状态，请刷新列表');
    const result = String(body.result || '').trim().toUpperCase();
    if (result !== 'UNJOINED') throw createError('到岗结果不正确');

    await connection.execute(
      "UPDATE hr_employee SET employee_status=5,lifecycle_status='NOT_JOINED',arrival_status='NO_SHOW',updated_at=NOW() WHERE company_id=:companyId AND id=:employeeId",
      { companyId, employeeId }
    );
    await closeEmployeeOpenItems(connection, companyId, employeeId, operatorId, '待到岗员工未入职');
    await syncEmployeeToTalent(connection, { companyId, employeeId, sourceType: 'UNJOINED', operatorId });
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,before_data,after_data)
       VALUES (:companyId,:operatorId,'员工生命周期','employee',:employeeId,'update',:beforeData,:afterData)`,
      {
        companyId,
        operatorId: operatorId || null,
        employeeId,
        beforeData: JSON.stringify({ employeeStatus: 1 }),
        afterData: JSON.stringify({ result, remark: body.remark || '' })
      }
    );
    return { employeeId, result, employeeStatus: 5 };
  });
}

async function confirmOnboardingCompliance(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const [[employee]] = await connection.execute(
      `SELECT id,name,employee_status FROM hr_employee
       WHERE company_id=:companyId AND id=:employeeId AND deleted_at IS NULL LIMIT 1`,
      { companyId, employeeId }
    );
    if (!employee) throw createError('员工不存在', 404);
    if (Number(employee.employee_status) !== 2) throw createError('只有正常在职员工可以办理入职合规');

    const contractDate = body.contractDate || today();
    const insuranceStartDate = body.insuranceStartDate || today();
    const contractNo = `HT${String(contractDate).replace(/-/g, '')}${employeeId}${String(Date.now()).slice(-6)}`;
    const [contractResult] = await connection.execute(
      `INSERT INTO hr_labor_contract
       (company_id,employee_id,contract_no,contract_type,sign_status,sign_date,start_date,renewal_count)
       VALUES (:companyId,:employeeId,:contractNo,2,1,:contractDate,:contractDate,0)`,
      { companyId, employeeId, contractNo, contractDate }
    );

    const [[social]] = await connection.execute(
      'SELECT id FROM hr_social_security WHERE company_id=:companyId AND employee_id=:employeeId ORDER BY id DESC LIMIT 1',
      { companyId, employeeId }
    );
    if (social) {
      await connection.execute(
        `UPDATE hr_social_security SET employer_insurance_status=1,employer_start_date=:insuranceStartDate,
           employer_end_date=NULL,remark=COALESCE(:remark,remark),updated_at=NOW()
         WHERE company_id=:companyId AND id=:socialId`,
        { companyId, socialId: social.id, insuranceStartDate, remark: body.remark || null }
      );
    } else {
      await connection.execute(
        `INSERT INTO hr_social_security
         (company_id,employee_id,employer_insurance_status,employer_start_date,remark)
         VALUES (:companyId,:employeeId,1,:insuranceStartDate,:remark)`,
        { companyId, employeeId, insuranceStartDate, remark: body.remark || null }
      );
    }

    await connection.execute(
      `UPDATE hr_employee SET contract_status='SIGNED',insurance_status='ACTIVE',lifecycle_status='ACTIVE',updated_at=NOW()
       WHERE company_id=:companyId AND id=:employeeId`,
      { companyId, employeeId }
    );
    await connection.execute(
      `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE company_id=:companyId AND employee_id=:employeeId
         AND task_type IN ('CONTRACT','INSURANCE','ONBOARDING_COMPLIANCE') AND task_status IN (0,1)`,
      { companyId, employeeId, operatorId: operatorId || null }
    );
    await connection.execute(
      `UPDATE hr_risk_alert SET handle_status=2,handler_id=:operatorId,handle_time=NOW(),
         handle_remark='合同和雇主险已一键确认',updated_at=NOW()
       WHERE company_id=:companyId AND employee_id=:employeeId AND risk_type IN (1,7) AND handle_status IN (0,1)`,
      { companyId, employeeId, operatorId: operatorId || null }
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'入职合规','onboarding_compliance',:employeeId,'confirm',:afterData)`,
      {
        companyId,
        operatorId: operatorId || null,
        employeeId,
        afterData: JSON.stringify({ contractId: contractResult.insertId, contractDate, insuranceStartDate, remark: body.remark || '' })
      }
    );
    return { employeeId, contractId: contractResult.insertId, contractDate, insuranceStartDate };
  });
}

async function assertEmployeeExists(companyId, employeeId, connection = db.pool) {
  const [[employee]] = await connection.execute(
    'SELECT id, name FROM hr_employee WHERE company_id = :companyId AND id = :employeeId AND deleted_at IS NULL LIMIT 1',
    { companyId, employeeId }
  );
  if (!employee) throw createError('员工不存在', 404);
  return employee;
}

async function createContract(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const employee = await assertEmployeeExists(companyId, employeeId, connection);
    const contractDate = body.contractDate || body.signDate || body.startDate;
    const datePart = String(contractDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const uniquePart = String(Date.now()).slice(-6);
    const contractNo = String(body.contractNo || `HT${datePart}${employeeId}${uniquePart}`).trim();
    const contractType = Number(body.contractType || 2);
    const signStatus = Number(body.signStatus ?? 1);
    const renewalCount = Number(body.renewalCount || 0);
    const signDate = body.signDate || (signStatus === 1 ? contractDate : null);
    const startDate = body.startDate || contractDate;
    if (!contractNo) throw createError('合同编号不能为空');
    if (![1, 2, 3, 4].includes(contractType)) throw createError('合同类型不正确');
    if (![0, 1, 2].includes(signStatus)) throw createError('合同签署状态不正确');
    if (!contractDate) throw createError('合同日期不能为空');
    if (signStatus === 1 && !signDate) throw createError('已签合同必须填写合同日期');
    if (!Number.isInteger(renewalCount) || renewalCount < 0) throw createError('续签次数必须为非负整数');
    if (!startDate) throw createError('合同开始日期不能为空');
    if (body.endDate && body.endDate < startDate) throw createError('合同结束日期不能早于开始日期');

    const [result] = await connection.execute(
      `
      INSERT INTO hr_labor_contract
      (company_id, employee_id, contract_no, contract_type, sign_status, sign_date, start_date, end_date, renewal_count)
      VALUES
      (:companyId, :employeeId, :contractNo, :contractType, :signStatus, :signDate, :startDate, :endDate, :renewalCount)
      `,
      {
        companyId,
        employeeId,
        contractNo,
        contractType,
        signStatus,
        signDate,
        startDate,
        endDate: body.endDate || null,
        renewalCount
      }
    );

    await connection.execute(
      `
      INSERT INTO hr_operation_log
      (company_id, operator_id, module_name, biz_type, biz_id, action_type, after_data)
      VALUES (:companyId, :operatorId, '合同管理', 'contract', :contractId, 'create', :afterData)
      `,
      {
        companyId,
        operatorId,
        contractId: result.insertId,
        afterData: JSON.stringify({ employeeId, contractNo })
      }
    );

    await noticeService.createNotice(connection, {
      companyId,
      employeeId,
      title: `${employee.name}劳动合同已登记`,
      category: '合同变更',
      noticeType: signStatus === 1 ? 'success' : 'warning',
      targetView: 'roster',
      dedupeKey: `contract:${result.insertId}`
    });

    if (signStatus === 1) {
      await connection.execute(
        `UPDATE hr_employee SET contract_status='SIGNED',updated_at=NOW()
         WHERE company_id=:companyId AND id=:employeeId`,
        { companyId, employeeId }
      );
      await connection.execute(
        `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=NOW(),updated_at=NOW()
         WHERE company_id=:companyId AND employee_id=:employeeId AND task_type='CONTRACT' AND task_status IN (0,1)`,
        { companyId, employeeId, operatorId }
      );
      await connection.execute(
        `UPDATE hr_risk_alert
         SET handle_status=2,handler_id=:operatorId,handle_time=NOW(),handle_remark='劳动合同已签订',updated_at=NOW()
         WHERE company_id=:companyId AND employee_id=:employeeId AND risk_type=1 AND handle_status IN (0,1)`,
        { companyId, employeeId, operatorId }
      );
      await connection.execute(
        `UPDATE hr_employee SET lifecycle_status='ACTIVE',updated_at=NOW()
         WHERE company_id=:companyId AND id=:employeeId AND employee_status=2
           AND lifecycle_status='ONBOARDING' AND contract_status='SIGNED' AND insurance_status='ACTIVE'`,
        { companyId, employeeId }
      );
    }

    return { employeeId, contractId: result.insertId };
  });
}

async function updateSocialSecurity(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    const employee = await assertEmployeeExists(companyId, employeeId, connection);
    const requestedAction = String(body.employerInsuranceAction || '').trim().toUpperCase();
    const legacyStatus = Number(body.employerInsuranceStatus || 0);
    const employerInsuranceAction = requestedAction || (legacyStatus === 1 ? 'ADD' : legacyStatus === 2 ? 'REMOVE' : '');
    if (!['ADD', 'REMOVE'].includes(employerInsuranceAction)) throw createError('请选择雇主险增保或减保');
    const employerInsuranceStatus = employerInsuranceAction === 'ADD' ? 1 : 2;

    const [[existing]] = await connection.execute(
      'SELECT id FROM hr_social_security WHERE company_id=:companyId AND employee_id=:employeeId ORDER BY id DESC LIMIT 1',
      { companyId, employeeId }
    );

    let socialId = existing?.id || 0;
    if (existing) {
      await connection.execute(
        `UPDATE hr_social_security
         SET employer_insurance_status=:employerInsuranceStatus,updated_at=NOW()
         WHERE company_id=:companyId AND id=:socialId`,
        { companyId, socialId, employerInsuranceStatus }
      );
    } else {
      const [result] = await connection.execute(
        `INSERT INTO hr_social_security
         (company_id,employee_id,employer_insurance_status)
         VALUES (:companyId,:employeeId,:employerInsuranceStatus)`,
        { companyId, employeeId, employerInsuranceStatus }
      );
      socialId = result.insertId;
    }

    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'雇主险','employer_insurance',:socialId,:actionType,:afterData)`,
      {
        companyId,
        operatorId,
        socialId,
        actionType: employerInsuranceAction === 'ADD' ? 'add' : 'remove',
        afterData: JSON.stringify({ employeeId, employerInsuranceAction, employerInsuranceStatus })
      }
    );

    const actionName = employerInsuranceAction === 'ADD' ? '增保' : '减保';
    await noticeService.createNotice(connection, {
      companyId,
      employeeId,
      title: `${employee.name}雇主险${actionName}已登记`,
      category: '雇主险变动',
      noticeType: employerInsuranceAction === 'ADD' ? 'success' : 'warning',
      targetView: 'roster',
      dedupeKey: `employer_insurance:${socialId}:${employerInsuranceAction}`
    });

    if (employerInsuranceAction === 'ADD') {
      await connection.execute(
        `UPDATE hr_employee SET insurance_status='ACTIVE',risk_level=1,updated_at=NOW()
         WHERE company_id=:companyId AND id=:employeeId`,
        { companyId, employeeId }
      );
      await connection.execute(
        `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=NOW(),updated_at=NOW()
         WHERE company_id=:companyId AND employee_id=:employeeId AND task_type='INSURANCE' AND task_status IN (0,1)`,
        { companyId, employeeId, operatorId }
      );
      await connection.execute(
        `UPDATE hr_risk_alert SET handle_status=2,handler_id=:operatorId,handle_time=NOW(),handle_remark='雇主险已增保',updated_at=NOW()
         WHERE company_id=:companyId AND employee_id=:employeeId AND risk_type=7 AND handle_status IN (0,1)`,
        { companyId, employeeId, operatorId }
      );
    } else {
      await connection.execute(
        `UPDATE hr_employee SET insurance_status='TERMINATED',updated_at=NOW()
         WHERE company_id=:companyId AND id=:employeeId`,
        { companyId, employeeId }
      );
      await connection.execute(
        `UPDATE hr_work_task SET task_status=2,completed_by=:operatorId,completed_at=NOW(),updated_at=NOW()
         WHERE company_id=:companyId AND employee_id=:employeeId AND task_type='INSURANCE_TERMINATION' AND task_status IN (0,1)`,
        { companyId, employeeId, operatorId }
      );
      const [[resignation]] = await connection.execute(
        'SELECT id FROM hr_resignation WHERE company_id=:companyId AND employee_id=:employeeId AND completed_at IS NULL ORDER BY id DESC LIMIT 1',
        { companyId, employeeId }
      );
      if (resignation) await syncResignationCompletion(connection, companyId, resignation.id, operatorId);
    }

    await connection.execute(
      `UPDATE hr_employee
       SET lifecycle_status='ACTIVE',updated_at=NOW()
       WHERE company_id=:companyId AND id=:employeeId AND employee_status=2
         AND lifecycle_status='ONBOARDING' AND contract_status='SIGNED' AND insurance_status='ACTIVE'`,
      { companyId, employeeId }
    );

    return { employeeId, socialId, employerInsuranceAction, employerInsuranceStatus };
  });
}


async function createCertificate(companyId, employeeId, body, operatorId = 0, user = null) {
  return db.transaction(async connection => {
    await assertEmployeeScope(companyId, employeeId, user, connection);
    await assertEmployeeExists(companyId, employeeId, connection);
    if (!body.certType) throw createError('证件类型不能为空');
    if (body.expireDate && body.issueDate && body.expireDate < body.issueDate) throw createError('证件到期日期不能早于发证日期');

    const [result] = await connection.execute(
      `
      INSERT INTO hr_employee_certificate
      (company_id, employee_id, cert_type, cert_no, issue_date, expire_date, verify_status)
      VALUES
      (:companyId, :employeeId, :certType, :certNo, :issueDate, :expireDate, :verifyStatus)
      `,
      {
        companyId,
        employeeId,
        certType: Number(body.certType),
        certNo: body.certNo || null,
        issueDate: body.issueDate || null,
        expireDate: body.expireDate || null,
        verifyStatus: Number(body.verifyStatus || 0)
      }
    );

    await connection.execute(
      `
      INSERT INTO hr_operation_log
      (company_id, operator_id, module_name, biz_type, biz_id, action_type, after_data)
      VALUES (:companyId, :operatorId, '证件资料', 'certificate', :certificateId, 'create', :afterData)
      `,
      {
        companyId,
        operatorId,
        certificateId: result.insertId,
        afterData: JSON.stringify({ employeeId, certType: Number(body.certType), certNo: body.certNo || '' })
      }
    );

    return { employeeId, certificateId: result.insertId };
  });
}

function escapeCsvCell(value) {
  let text = String(value ?? '');
  // Excel 会把这些首字符识别为公式；前置单引号可保留显示值并阻止执行。
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportFilterSummary(query = {}) {
  return {
    hasKeyword: Boolean(String(query.keyword || '').trim()),
    customerId: query.customerId ? Number(query.customerId) : null,
    projectId: query.projectId ? Number(query.projectId) : null,
    employeeStatus: query.employeeStatus ? Number(query.employeeStatus) : null,
    employmentType: query.employmentType ? Number(query.employmentType) : null
  };
}

async function recordEmployeeExport(companyId, user, audit, details) {
  await db.query(
    `INSERT INTO hr_operation_log (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data,ip_address) VALUES (:companyId,:operatorId,'员工花名册','employee_export',0,:actionType,:afterData,:ipAddress)`,
    {
      companyId,
      operatorId: Number(audit.operatorId || user?.id || 0) || null,
      actionType: details.actionType,
      afterData: JSON.stringify({
        count: details.count,
        fileSha256: details.fileSha256,
        filterSummary: details.filterSummary,
        userAgent: String(audit.userAgent || '').slice(0, 120)
      }),
      ipAddress: String(audit.ipAddress || '').slice(0, 50) || null
    }
  );
}

async function exportEmployeesCsv(companyId, query, user = null, audit = {}) {
  const rows = await listEmployees(companyId, { ...query, page: 1, pageSize: 2000 }, user, { maxPageSize: 2000 });
  const header = ['姓名', '手机号', '客户单位', '岗位', '用工模式', '费用模式', '工资类型', '入职日期', '合同状态', '雇主险状态', '风险数', '员工状态'];
  const lines = [header.join(',')].concat(
    rows.list.map(row =>
      [
        row.name,
        row.phone,
        row.customerName,
        row.positionName,
        row.employmentTypeName,
        row.feeModeName,
        row.workTypeName,
        row.hireDate,
        row.contractStatusName,
        row.employerInsuranceStatusName,
        row.riskCount,
        row.employeeStatusName
      ]
        .map(escapeCsvCell)
        .join(',')
    )
  );

  const csv = `\uFEFF${lines.join('\n')}`;
  const fileSha256 = nodeCrypto.createHash('sha256').update(csv, 'utf8').digest('hex');
  const filterSummary = exportFilterSummary(query);
  await recordEmployeeExport(companyId, user, audit, {
    actionType: 'export_employee',
    count: rows.list.length,
    fileSha256,
    filterSummary
  });
  return { csv, count: rows.list.length, fileSha256, filterSummary };
}

function safeExcelText(value) {
  const text = String(value ?? '');
  return /^[=+@-]/.test(text) ? `'${text}` : text;
}

function styleWorksheet(sheet) {
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FF173650' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.eachCell(cell => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB9D5E8' } } };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columnCount).letter}1` };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'middle' };
  });
}

function colorEmployeeStatus(cell, status) {
  const colors = { 在职: 'FFE8F5E9', 离职: 'FFFFEBEE', 待入职: 'FFE3F2FD', 黑名单: 'FFFFF3E0' };
  const color = colors[status];
  if (color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

async function exportEmployeesExcel(companyId, query, user = null, audit = {}) {
  const result = await listEmployees(companyId, { ...query, page: 1, pageSize: 2000 }, user, { maxPageSize: 2000 });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '优益数字化管理系统';
  workbook.created = new Date();
  workbook.modified = new Date();

  const baseSheet = workbook.addWorksheet('基本信息');
  baseSheet.columns = [
    { header: '姓名', key: 'name', width: 12 },
    { header: '性别', key: 'genderName', width: 8 },
    { header: '身份证号', key: 'idCardNo', width: 20 },
    { header: '手机号', key: 'phone', width: 15 },
    { header: '工作单位', key: 'customerName', width: 24 },
    { header: '岗位', key: 'positionName', width: 18 },
    { header: '用工模式', key: 'employmentTypeName', width: 12 },
    { header: '费用模式', key: 'feeModeName', width: 18 },
    { header: '工资类型', key: 'workTypeName', width: 12 },
    { header: '招聘渠道', key: 'recruitmentChannelName', width: 20 },
    { header: '入职日期', key: 'hireDate', width: 12 },
    { header: '状态', key: 'employeeStatusName', width: 10 }
  ];
  result.list.forEach(employee => {
    const row = baseSheet.addRow({
      ...employee,
      name: safeExcelText(employee.name),
      customerName: safeExcelText(employee.customerName),
      positionName: safeExcelText(employee.positionName),
      feeModeName: safeExcelText(employee.feeModeName),
      recruitmentChannelName: safeExcelText(employee.recruitmentChannelName)
    });
    colorEmployeeStatus(row.getCell('employeeStatusName'), employee.employeeStatusName);
  });
  styleWorksheet(baseSheet);

  const employeeIds = result.list.map(item => Number(item.id)).filter(Number.isInteger);
  const employeeNames = new Map(result.list.map(item => [Number(item.id), item.name]));
  const employeeIdParams = { companyId };
  const employeeIdSql = employeeIds.map((employeeId, index) => {
    const key = `exportEmployeeId${index}`;
    employeeIdParams[key] = employeeId;
    return `:${key}`;
  }).join(',');

  const contracts = employeeIds.length ? await db.query(
    `SELECT employee_id,contract_no,contract_type,sign_status,start_date,end_date
     FROM hr_labor_contract
     WHERE company_id=:companyId AND employee_id IN (${employeeIdSql})
     ORDER BY employee_id,start_date DESC,id DESC`,
    employeeIdParams
  ) : [];
  const contractSheet = workbook.addWorksheet('合同信息');
  contractSheet.columns = [
    { header: '姓名', key: 'name', width: 12 },
    { header: '合同编号', key: 'contractNo', width: 22 },
    { header: '合同类型', key: 'contractType', width: 14 },
    { header: '签署状态', key: 'signStatus', width: 12 },
    { header: '开始日期', key: 'startDate', width: 12 },
    { header: '结束日期', key: 'endDate', width: 12 }
  ];
  const contractTypes = { 1: '固定期限', 2: '无固定期限', 3: '劳务协议', 4: '实习协议' };
  contracts.forEach(contract => contractSheet.addRow({
    name: safeExcelText(employeeNames.get(Number(contract.employee_id)) || ''),
    contractNo: safeExcelText(contract.contract_no),
    contractType: contractTypes[Number(contract.contract_type)] || '其他',
    signStatus: label('signStatus', contract.sign_status, '未知'),
    startDate: contract.start_date || '',
    endDate: contract.end_date || ''
  }));
  styleWorksheet(contractSheet);

  const socialRows = employeeIds.length ? await db.query(
    `SELECT s.employee_id,s.employer_insurance_status,s.employer_insurer,s.employer_policy_no,
            s.employer_start_date,s.employer_end_date,s.employer_insured_amount
     FROM hr_social_security s
     JOIN (
       SELECT employee_id,MAX(id) id FROM hr_social_security
       WHERE company_id=:companyId AND employee_id IN (${employeeIdSql}) GROUP BY employee_id
     ) latest ON latest.id=s.id
     WHERE s.company_id=:companyId
     ORDER BY s.employee_id`,
    employeeIdParams
  ) : [];
  const socialSheet = workbook.addWorksheet('雇主险信息');
  socialSheet.columns = [
    { header: '姓名', key: 'name', width: 12 },
    { header: '雇主险状态', key: 'employerInsurance', width: 14 },
    { header: '承保机构', key: 'employerInsurer', width: 18 },
    { header: '保单号', key: 'employerPolicyNo', width: 22 },
    { header: '生效日期', key: 'employerStartDate', width: 12 },
    { header: '到期日期', key: 'employerEndDate', width: 12 },
    { header: '保额', key: 'employerInsuredAmount', width: 16 }
  ];
  const employerStatuses = { 0: '未投保', 1: '保障中', 2: '已终止' };
  socialRows.forEach(social => socialSheet.addRow({
    name: safeExcelText(employeeNames.get(Number(social.employee_id)) || ''),
    employerInsurance: employerStatuses[Number(social.employer_insurance_status)] || '未知',
    employerInsurer: safeExcelText(social.employer_insurer),
    employerPolicyNo: safeExcelText(social.employer_policy_no),
    employerStartDate: social.employer_start_date || '',
    employerEndDate: social.employer_end_date || '',
    employerInsuredAmount: Number(social.employer_insured_amount || 0)
  }));
  styleWorksheet(socialSheet);
  socialSheet.getColumn('employerInsuredAmount').numFmt = '#,##0.00';

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileSha256 = nodeCrypto.createHash('sha256').update(buffer).digest('hex');
  const filterSummary = exportFilterSummary(query);
  await recordEmployeeExport(companyId, user, audit, {
    actionType: 'export_employee_xlsx',
    count: result.list.length,
    fileSha256,
    filterSummary
  });
  return { buffer, count: result.list.length, fileSha256, filterSummary };
}

module.exports = {
  getBootstrap,
  getSummary,
  getOnsiteOverview,
  listEmployees,
  listMyEmployees,
  getEmployeeDetail,
  recordSensitiveAccess,
  createEmployee,
  createEmployeesBatch,
  updateEmployee,
  transferJob,
  handleInterviewResult,
  handleArrivalResult,
  confirmOnboardingCompliance,
  onboardEmployee,
  resignEmployee,
  createContract,
  updateSocialSecurity,
  createCertificate,
  exportEmployeesCsv,
  exportEmployeesExcel,
  escapeCsvCell,
  safeExcelText,
  resolveDataScope,
  applyDataScope,
  assertEmployeeScope,
  formatRisk,
  normalizeEmploymentType,
  normalizeFeeMode,
  normalizeRecruitmentChannel,
  linkExistingTalentToEmployee,
  syncEmployeeToTalent,
  buildInternalEmployeeNo
  ,precheckEmployee
  ,validateRecruitmentSource
  ,handleTransfer
  ,updateResignationProgress
};
