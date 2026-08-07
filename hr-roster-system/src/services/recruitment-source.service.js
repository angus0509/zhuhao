const db = require('../db');
const { createError } = require('../utils/response');
const { employeeScope } = require('../utils/data-scope');

const CHANNEL_TYPES = { 1: '内部招聘人', 2: '合作供应商', 3: '线上平台', 4: '员工推荐', 5: '线下招聘', 9: '其他' };

function normalizeChannel(body = {}) {
  const channelName = String(body.channelName || '').trim();
  if (!channelName) throw createError('招聘渠道名称不能为空');
  if (channelName.length > 100) throw createError('招聘渠道名称最多100个字符');
  const channelType = CHANNEL_TYPES[Number(body.channelType)] ? Number(body.channelType) : 9;
  const recruiterId = body.recruiterId ? Number(body.recruiterId) : null;
  const supplierId = body.supplierId ? Number(body.supplierId) : null;
  if (recruiterId && supplierId) throw createError('一个招聘渠道不能同时关联招聘人和供应商');
  return { channelName, channelType, recruiterId, supplierId, status: Number(body.status) === 0 ? 0 : 1, remark: String(body.remark || '').trim() || null };
}

async function listChannels(companyId, user = null) {
  const params = { companyId };
  const scopeSql = employeeScope(user, params, 'e', 'j');
  const rows = await db.query(
    `SELECT rc.id,rc.channel_name channelName,rc.channel_type channelType,rc.recruiter_id recruiterId,
            rc.supplier_id supplierId,rc.status,rc.remark,rec.recruiter_name recruiterName,
            rs.supplier_name supplierName,COALESCE(es.employeeCount,0) employeeCount,
            COALESCE(es.activeEmployeeCount,0) activeEmployeeCount,
            COALESCE(es.customerCount,0) customerCount,es.employeeNames,es.customerNames,es.feeModes
     FROM hr_recruitment_channel rc
     LEFT JOIN hr_recruiter rec ON rec.id=rc.recruiter_id AND rec.company_id=rc.company_id
     LEFT JOIN hr_recruitment_supplier rs ON rs.id=rc.supplier_id AND rs.company_id=rc.company_id
     LEFT JOIN (
       SELECT e.recruitment_channel_id channelId,COUNT(DISTINCT e.id) employeeCount,
              COUNT(DISTINCT CASE WHEN e.employee_status=2 THEN e.id END) activeEmployeeCount,
              COUNT(DISTINCT j.customer_id) customerCount,
              GROUP_CONCAT(DISTINCT e.name ORDER BY e.name SEPARATOR '、') employeeNames,
              GROUP_CONCAT(DISTINCT cu.customer_name ORDER BY cu.customer_name SEPARATOR '、') customerNames,
              GROUP_CONCAT(DISTINCT j.fee_mode ORDER BY j.fee_mode SEPARATOR '、') feeModes
       FROM hr_employee e
       LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
       LEFT JOIN crm_customer cu ON cu.id=j.customer_id AND cu.company_id=e.company_id
       WHERE e.company_id=:companyId AND e.deleted_at IS NULL AND e.recruitment_channel_id IS NOT NULL${scopeSql}
       GROUP BY e.recruitment_channel_id
     ) es ON es.channelId=rc.id
     WHERE rc.company_id=:companyId
     ORDER BY rc.status DESC,employeeCount DESC,rc.channel_name`,
    params
  );
  return rows.map(row => ({
    ...row,
    channelTypeName: CHANNEL_TYPES[Number(row.channelType)] || '其他',
    employeeCount: Number(row.employeeCount || 0),
    activeEmployeeCount: Number(row.activeEmployeeCount || 0),
    customerCount: Number(row.customerCount || 0),
    employeeNames: row.employeeNames || '',
    customerNames: row.customerNames || '',
    feeModes: row.feeModes || ''
  }));
}

async function listChannelEmployees(companyId, channelId, user = null) {
  const params = { companyId, channelId };
  const scopeSql = employeeScope(user, params, 'e', 'j');
  const channel = await db.first(
    'SELECT id,channel_name channelName FROM hr_recruitment_channel WHERE company_id=:companyId AND id=:channelId',
    params
  );
  if (!channel) throw createError('招聘渠道不存在', 404);
  const rows = await db.query(
    `SELECT e.id,e.name,e.employee_status employeeStatus,cu.customer_name customerName,
            p.position_name positionName,j.fee_mode feeMode,j.hire_date hireDate
     FROM hr_employee e
     LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
     LEFT JOIN crm_customer cu ON cu.id=j.customer_id AND cu.company_id=e.company_id
     LEFT JOIN hr_position p ON p.id=j.position_id AND p.company_id=e.company_id
     WHERE e.company_id=:companyId AND e.recruitment_channel_id=:channelId AND e.deleted_at IS NULL${scopeSql}
     ORDER BY e.employee_status=2 DESC,cu.customer_name,e.id DESC
     LIMIT 200`,
    params
  );
  return { ...channel, rows };
}

async function createChannel(companyId, body, operatorId) {
  const item = normalizeChannel(body);
  try {
    const result = await db.query(
      `INSERT INTO hr_recruitment_channel
       (company_id,channel_name,channel_type,recruiter_id,supplier_id,status,remark,created_by)
       VALUES (:companyId,:channelName,:channelType,:recruiterId,:supplierId,:status,:remark,:operatorId)`,
      { companyId, operatorId, ...item }
    );
    return { channelId: result.insertId };
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw createError('该招聘渠道已存在');
    throw error;
  }
}

async function updateChannel(companyId, channelId, body) {
  const item = normalizeChannel(body);
  const result = await db.query(
    `UPDATE hr_recruitment_channel SET channel_name=:channelName,channel_type=:channelType,
       recruiter_id=:recruiterId,supplier_id=:supplierId,status=:status,remark=:remark,updated_at=NOW()
     WHERE company_id=:companyId AND id=:channelId`,
    { companyId, channelId, ...item }
  );
  if (!result.affectedRows) throw createError('招聘渠道不存在', 404);
  return { channelId };
}

async function listRecruiters(companyId) {
  return db.query(
    `SELECT id,recruiter_no recruiterNo,recruiter_name recruiterName,phone,primary_project_id primaryProjectId,status
     FROM hr_recruiter WHERE company_id=:companyId ORDER BY status DESC,recruiter_name,id`,
    { companyId }
  );
}

async function createRecruiter(companyId, body, operatorId) {
  if (!body.recruiterName) throw createError('招聘人姓名不能为空');
  const recruiterNo = String(body.recruiterNo || `ZP${Date.now()}`).slice(0, 32);
  const result = await db.query(
    `INSERT INTO hr_recruiter
     (company_id,recruiter_no,recruiter_name,phone,user_id,primary_project_id,status,created_by)
     VALUES (:companyId,:recruiterNo,:recruiterName,:phone,:userId,:projectId,1,:operatorId)`,
    {
      companyId,
      recruiterNo,
      recruiterName: String(body.recruiterName).trim(),
      phone: body.phone || null,
      userId: body.userId ? Number(body.userId) : null,
      projectId: body.primaryProjectId ? Number(body.primaryProjectId) : null,
      operatorId
    }
  );
  return { recruiterId: result.insertId };
}

async function updateRecruiter(companyId, recruiterId, body) {
  if (!body.recruiterName) throw createError('招聘人姓名不能为空');
  const result = await db.query(
    `UPDATE hr_recruiter SET recruiter_name=:recruiterName,phone=:phone,
       primary_project_id=:projectId,status=:status,updated_at=NOW()
     WHERE company_id=:companyId AND id=:recruiterId`,
    {
      companyId,
      recruiterId,
      recruiterName: String(body.recruiterName).trim(),
      phone: body.phone || null,
      projectId: body.primaryProjectId ? Number(body.primaryProjectId) : null,
      status: Number(body.status) === 0 ? 0 : 1
    }
  );
  if (!result.affectedRows) throw createError('招聘人不存在', 404);
  return { recruiterId };
}

async function listSuppliers(companyId) {
  return db.query(
    `SELECT id,supplier_no supplierNo,supplier_name supplierName,credit_code creditCode,
            contact_name contactName,contact_phone contactPhone,contract_start_date contractStartDate,
            contract_end_date contractEndDate,risk_level riskLevel,status
     FROM hr_recruitment_supplier WHERE company_id=:companyId ORDER BY status DESC,supplier_name,id`,
    { companyId }
  );
}

async function createSupplier(companyId, body, operatorId) {
  if (!body.supplierName) throw createError('供应商名称不能为空');
  if (body.contractStartDate && body.contractEndDate && body.contractEndDate < body.contractStartDate) {
    throw createError('供应商合同结束日期不能早于开始日期');
  }
  const supplierNo = String(body.supplierNo || `GYS${Date.now()}`).slice(0, 32);
  const result = await db.query(
    `INSERT INTO hr_recruitment_supplier
     (company_id,supplier_no,supplier_name,credit_code,contact_name,contact_phone,contract_start_date,
      contract_end_date,risk_level,status,created_by)
     VALUES (:companyId,:supplierNo,:supplierName,:creditCode,:contactName,:contactPhone,:startDate,
             :endDate,:riskLevel,1,:operatorId)`,
    {
      companyId,
      supplierNo,
      supplierName: String(body.supplierName).trim(),
      creditCode: body.creditCode || null,
      contactName: body.contactName || null,
      contactPhone: body.contactPhone || null,
      startDate: body.contractStartDate || null,
      endDate: body.contractEndDate || null,
      riskLevel: [1, 2, 3].includes(Number(body.riskLevel)) ? Number(body.riskLevel) : 1,
      operatorId
    }
  );
  return { supplierId: result.insertId };
}

async function updateSupplier(companyId, supplierId, body) {
  if (!body.supplierName) throw createError('供应商名称不能为空');
  if (body.contractStartDate && body.contractEndDate && body.contractEndDate < body.contractStartDate) {
    throw createError('供应商合同结束日期不能早于开始日期');
  }
  const result = await db.query(
    `UPDATE hr_recruitment_supplier SET supplier_name=:supplierName,credit_code=:creditCode,
       contact_name=:contactName,contact_phone=:contactPhone,contract_start_date=:startDate,
       contract_end_date=:endDate,risk_level=:riskLevel,status=:status,updated_at=NOW()
     WHERE company_id=:companyId AND id=:supplierId`,
    {
      companyId,
      supplierId,
      supplierName: String(body.supplierName).trim(),
      creditCode: body.creditCode || null,
      contactName: body.contactName || null,
      contactPhone: body.contactPhone || null,
      startDate: body.contractStartDate || null,
      endDate: body.contractEndDate || null,
      riskLevel: [1, 2, 3].includes(Number(body.riskLevel)) ? Number(body.riskLevel) : 1,
      status: Number(body.status) === 0 ? 0 : 1
    }
  );
  if (!result.affectedRows) throw createError('供应商不存在', 404);
  return { supplierId };
}

module.exports = {
  CHANNEL_TYPES, normalizeChannel, listChannels, listChannelEmployees, createChannel, updateChannel,
  listRecruiters, createRecruiter, updateRecruiter, listSuppliers, createSupplier, updateSupplier
};
