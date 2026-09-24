const fs = require('fs/promises');
const path = require('path');
const db = require('../db');
const nodeCrypto = require('node:crypto');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { createError } = require('../utils/response');
const { encrypt, decrypt, sha256 } = require('../utils/crypto');
const { maskIdCard, maskPhone } = require('../utils/mask');
const { projectScope, customerScope, employeeScope } = require('../utils/data-scope');
const { paging } = require('../utils/pagination');
const { assertEmployeeScope } = require('./employee.service');
const systemService = require('./system.service');
const noticeService = require('./notice.service');
const smsDeliveryService = require('./sms-delivery.service');
const officialNotificationService = require('./official-notification.service').createOfficialNotificationService();
const appEnv = require('../config/env');
const payrollImportProfileService = require('./payroll-import-profile.service');
const { normalizeItemSnapshot } = require('./payroll-item-snapshot.service');

const MANAGED_ROLE_SQL = systemService.MANAGED_ROLE_CODES.map(code => `'${code}'`).join(',');

const PDF_FONT_PATH = path.resolve(__dirname, '..', 'assets', 'fonts', 'NotoSansSC-Regular.ttf');
const PDF_UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
let pdfFontBytesPromise = null;
function loadPdfFontBytes() {
  if (!pdfFontBytesPromise) pdfFontBytesPromise = fs.readFile(PDF_FONT_PATH);
  return pdfFontBytesPromise;
}

async function listCustomers(companyId, query, user) {
  const { page, pageSize, offset } = paging(query);
  const params = { companyId, keyword: `%${query.keyword || ''}%`, pageSize, offset };
  const keywordWhere = query.keyword ? 'AND (c.customer_name LIKE :keyword OR c.contact_name LIKE :keyword OR c.contact_phone LIKE :keyword)' : '';
  const scope = customerScope(user, params, 'c');
  const total = await db.first(`SELECT COUNT(*) total FROM crm_customer c WHERE c.company_id = :companyId ${keywordWhere} ${scope}`, params);
  const list = await db.query(
    `SELECT id, customer_name customerName, unified_credit_code unifiedCreditCode, contact_name contactName,
            contact_phone contactPhone, address, status, remark, created_at createdAt
     FROM crm_customer c WHERE c.company_id = :companyId ${keywordWhere}
       ${scope}
     ORDER BY id DESC LIMIT :pageSize OFFSET :offset`,
    params
  );
  return { page, pageSize, total: Number(total.total), list };
}

async function createCustomer(companyId, body, operatorId = 0, user = null) {
  const customerName = String(body.customerName || body.clientName || '').trim();
  if (!customerName) throw createError('客户名称不能为空');
  const serviceTypes = { 劳务派遣: 1, 岗位外包: 2, 灵活用工: 3, RPO招聘: 4 };
  const serviceType = Number(body.serviceType) || serviceTypes[body.serviceType] || 2;

  return db.transaction(async connection => {
    const [[duplicated]] = await connection.execute(
      'SELECT id FROM crm_customer WHERE company_id=:companyId AND customer_name=:customerName LIMIT 1',
      { companyId, customerName }
    );
    if (duplicated) throw createError('该客户单位已存在，请勿重复录入');

    const [customerResult] = await connection.execute(
      `INSERT INTO crm_customer
       (company_id, customer_name, unified_credit_code, contact_name, contact_phone, address, status, remark)
       VALUES (:companyId, :customerName, :creditCode, :contactName, :contactPhone, :address, 1, :remark)`,
      {
        companyId, customerName, creditCode: body.unifiedCreditCode || null,
        contactName: body.contactName || null, contactPhone: body.contactPhone || null,
        address: body.address || body.worksiteName || null,
        remark: body.remark || body.settlementCycle || null
      }
    );
    const customerId = customerResult.insertId;
    const projectCode = `XM${Date.now()}${customerId}`;
    const projectName = String(body.projectName || `${customerName}用工项目`).trim();
    const [projectResult] = await connection.execute(
      `INSERT INTO labor_project
       (company_id, customer_id, project_code, project_name, service_type, factory_name, factory_address,
        manager_user_id, status)
       VALUES (:companyId, :customerId, :projectCode, :projectName, :serviceType, :factoryName, :factoryAddress,
        :managerUserId, 2)`,
      {
        companyId, customerId, projectCode, projectName, serviceType,
        factoryName: body.worksiteName || customerName,
        factoryAddress: body.factoryAddress || body.worksiteName || null,
        managerUserId: operatorId || null
      }
    );
    if (Number(user?.dataScope) === 5 && Number(operatorId) > 0) {
      await connection.execute(
        `INSERT IGNORE INTO sys_user_project (user_id, project_id)
         SELECT u.id,:projectId FROM sys_user u
         WHERE u.id=:operatorId AND u.company_id=:companyId AND u.status=1`,
        { companyId, operatorId: Number(operatorId), projectId: projectResult.insertId }
      );
    }
    return { customerId, projectId: projectResult.insertId, projectCode, effective: true };
  });
}

async function getCustomerDetail(companyId, customerId, user) {
  const params = { companyId, customerId };
  const customer = await db.first(
    `SELECT c.id, c.customer_name customerName, c.contact_name contactName,
            c.contact_phone contactPhone, c.address, c.status,
            COALESCE(c.remark,'月结30天') settlementCycle
     FROM crm_customer c
     WHERE c.company_id=:companyId AND c.id=:customerId ${customerScope(user, params, 'c')}`,
    params
  );
  if (!customer) throw createError('客户单位不存在或无权查看', 404);

  const projectParams = { companyId, customerId };
  const projects = await db.query(
    `SELECT p.id, p.project_code projectCode, p.project_name projectName,
            p.service_type serviceType, p.factory_name worksiteName,
            p.factory_address factoryAddress, p.status,
            u.real_name managerName, p.created_at createdAt
     FROM labor_project p
     LEFT JOIN sys_user u ON u.id=p.manager_user_id
     WHERE p.company_id=:companyId AND p.customer_id=:customerId ${projectScope(user, projectParams, 'p')}
     ORDER BY p.id`,
    projectParams
  );
  return { customer, projects };
}

async function updateCustomerPortfolio(companyId, customerId, body, operatorId, user) {
  const current = await getCustomerDetail(companyId, customerId, user);
  const customerName = String(body.customerName || '').trim();
  if (!customerName) throw createError('客户名称不能为空');
  const projects = Array.isArray(body.projects) ? body.projects : [];
  if (projects.length > 100) throw createError('单个客户项目数量不能超过100个');
  const accessibleProjectIds = new Set(current.projects.map(item => Number(item.id)));
  const serviceTypes = { 劳务派遣: 1, 岗位外包: 2, 灵活用工: 3, RPO招聘: 4 };

  return db.transaction(async connection => {
    const [[duplicated]] = await connection.execute(
      `SELECT id FROM crm_customer
       WHERE company_id=:companyId AND customer_name=:customerName AND id<>:customerId LIMIT 1`,
      { companyId, customerName, customerId }
    );
    if (duplicated) throw createError('该客户名称已被其他客户使用');

    await connection.execute(
      `UPDATE crm_customer SET customer_name=:customerName, contact_name=:contactName,
       contact_phone=:contactPhone, address=:address, remark=:settlementCycle, status=1
       WHERE company_id=:companyId AND id=:customerId`,
      {
        companyId, customerId, customerName,
        contactName: body.contactName || null,
        contactPhone: body.contactPhone || null,
        address: body.address || null,
        settlementCycle: body.settlementCycle || null
      }
    );

    let createdCount = 0;
    let updatedCount = 0;
    for (const projectBody of projects) {
      const projectName = String(projectBody.projectName || '').trim();
      if (!projectName) throw createError('项目名称不能为空');
      const serviceType = Number(projectBody.serviceType) || serviceTypes[projectBody.serviceType] || 2;
      const status = [2, 3, 4].includes(Number(projectBody.status)) ? Number(projectBody.status) : 2;
      const projectId = Number(projectBody.id || 0);
      if (projectId) {
        if (!accessibleProjectIds.has(projectId)) throw createError('项目不存在或无权修改', 403);
        await connection.execute(
          `UPDATE labor_project SET project_name=:projectName, service_type=:serviceType,
           factory_name=:worksiteName, factory_address=:factoryAddress, status=:status
           WHERE company_id=:companyId AND customer_id=:customerId AND id=:projectId`,
          {
            companyId, customerId, projectId, projectName, serviceType, status,
            worksiteName: projectBody.worksiteName || customerName,
            factoryAddress: projectBody.factoryAddress || projectBody.worksiteName || null
          }
        );
        updatedCount += 1;
      } else {
        const projectCode = `XM${Date.now()}${customerId}${createdCount + 1}`;
        await connection.execute(
          `INSERT INTO labor_project
           (company_id,customer_id,project_code,project_name,service_type,factory_name,factory_address,
            manager_user_id,status)
           VALUES (:companyId,:customerId,:projectCode,:projectName,:serviceType,:worksiteName,:factoryAddress,
            :managerUserId,:status)`,
          {
            companyId, customerId, projectCode, projectName, serviceType, status,
            worksiteName: projectBody.worksiteName || customerName,
            factoryAddress: projectBody.factoryAddress || projectBody.worksiteName || null,
            managerUserId: operatorId || null
          }
        );
        createdCount += 1;
      }
    }
    return { customerId, createdProjectCount: createdCount, updatedProjectCount: updatedCount };
  });
}

async function listProjects(companyId, query, user) {
  const { page, pageSize, offset } = paging(query);
  const params = { companyId, scopeUserId: user.id, pageSize, offset };
  const scope = projectScope(user, params, 'p');
  const total = await db.first(`SELECT COUNT(*) total FROM labor_project p WHERE p.company_id = :companyId ${scope}`, params);
  const list = await db.query(
    `SELECT p.id, p.customer_id customerId, p.project_code projectCode, p.project_name projectName, p.service_type serviceType,
            p.factory_name factoryName, p.factory_address factoryAddress, p.start_date startDate,
            p.end_date endDate, p.status, c.customer_name customerName, u.real_name managerName,
            (SELECT GROUP_CONCAT(DISTINCT onsite_user.real_name ORDER BY onsite_user.real_name SEPARATOR '、')
             FROM sys_user_project onsite_up
             JOIN sys_user onsite_user ON onsite_user.id=onsite_up.user_id AND onsite_user.company_id=p.company_id AND onsite_user.status=1
             JOIN sys_user_role onsite_ur ON onsite_ur.user_id=onsite_user.id
             JOIN sys_role onsite_role ON onsite_role.id=onsite_ur.role_id AND onsite_role.company_id=p.company_id
               AND onsite_role.status=1 AND onsite_role.role_code='onsite_staff'
             WHERE onsite_up.project_id=p.id) onsiteManagerNames,
            (SELECT COUNT(DISTINCT project_employee.id)
              FROM hr_employee_job project_job
              JOIN hr_employee project_employee ON project_employee.id=project_job.employee_id AND project_employee.company_id=project_job.company_id
              WHERE project_job.project_id = p.id AND project_job.job_status = 1
                AND project_employee.employee_status = 2 AND project_employee.deleted_at IS NULL) onsiteCount,
            (SELECT COUNT(DISTINCT project_employee.id)
              FROM hr_employee_job project_job
              JOIN hr_employee project_employee ON project_employee.id=project_job.employee_id AND project_employee.company_id=project_job.company_id
              WHERE project_job.project_id = p.id AND project_job.job_status = 1
                AND project_employee.employee_status = 2 AND project_employee.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM hr_labor_contract lc WHERE lc.company_id=p.company_id AND lc.employee_id=project_employee.id AND lc.sign_status=1)) unsignedContractCount,
            (SELECT COUNT(DISTINCT project_employee.id)
              FROM hr_employee_job project_job
              JOIN hr_employee project_employee ON project_employee.id=project_job.employee_id AND project_employee.company_id=project_job.company_id
              WHERE project_job.project_id = p.id AND project_job.job_status = 1
                AND project_employee.employee_status = 2 AND project_employee.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM hr_social_security ss WHERE ss.company_id=p.company_id AND ss.employee_id=project_employee.id
                AND ss.id=(SELECT MAX(ss2.id) FROM hr_social_security ss2 WHERE ss2.company_id=p.company_id AND ss2.employee_id=project_employee.id)
                AND ss.employer_insurance_status=1)) uninsuredCount,
            (SELECT COUNT(DISTINCT ra.id)
              FROM hr_employee_job project_job
              JOIN hr_employee project_employee ON project_employee.id=project_job.employee_id AND project_employee.company_id=project_job.company_id
              JOIN hr_risk_alert ra ON ra.employee_id=project_employee.id AND ra.company_id=p.company_id
              WHERE project_job.project_id=p.id AND project_job.job_status=1
                AND project_employee.employee_status=2 AND project_employee.deleted_at IS NULL
                AND ra.handle_status IN (0,1)) openRiskCount,
            (SELECT COALESCE(SUM(sa.outstanding_amount),0) FROM salary_advance sa WHERE sa.company_id=p.company_id AND sa.project_id=p.id) advanceOutstanding,
            (SELECT COALESCE(SUM(sb.total_net),0) FROM salary_batch sb WHERE sb.company_id=p.company_id AND sb.project_id=p.id AND sb.batch_status=5) payrollNet
     FROM labor_project p JOIN crm_customer c ON c.id = p.customer_id AND c.company_id = p.company_id
     LEFT JOIN sys_user u ON u.id = p.manager_user_id
     WHERE p.company_id = :companyId ${scope} ORDER BY p.id DESC LIMIT :pageSize OFFSET :offset`, params
  );
  return {
    page, pageSize, total: Number(total.total),
    list: list.map(item => ({
      ...item,
      onsiteCount: Number(item.onsiteCount || 0),
      unsignedContractCount: Number(item.unsignedContractCount || 0),
      uninsuredCount: Number(item.uninsuredCount || 0),
      openRiskCount: Number(item.openRiskCount || 0),
      advanceOutstanding: Number(item.advanceOutstanding || 0),
      payrollNet: Number(item.payrollNet || 0)
    }))
  };
}

async function createProject(companyId, body, user) {
  const customerId = Number(body.customerId || body.clientId || 0);
  const serviceTypes = { 劳务派遣: 1, 岗位外包: 2, 灵活用工: 3, RPO招聘: 4 };
  const serviceType = Number(body.serviceType) || serviceTypes[body.serviceType] || 2;
  const projectCode = body.projectCode || `XM${Date.now()}`;
  if (!customerId || !body.projectName) throw createError('客户和项目名称不能为空');
  const params = { companyId, customerId };
  const customer = await db.first(
    `SELECT c.id FROM crm_customer c WHERE c.company_id = :companyId AND c.id = :customerId ${customerScope(user, params, 'c')}`,
    params
  );
  if (!customer) throw createError('客户不存在或无权限', 403);
  const result = await db.query(
    `INSERT INTO labor_project
     (company_id, customer_id, project_code, project_name, service_type, factory_name, factory_address,
      manager_user_id, start_date, end_date, status)
     VALUES (:companyId, :customerId, :projectCode, :projectName, :serviceType, :factoryName, :factoryAddress,
      :managerUserId, :startDate, :endDate, :status)`,
    {
      companyId, customerId, projectCode, projectName: body.projectName,
      serviceType, factoryName: body.factoryName || body.worksiteName || null, factoryAddress: body.factoryAddress || null,
      managerUserId: body.managerUserId ? Number(body.managerUserId) : null, startDate: body.startDate || null,
      endDate: body.endDate || null,
      status: [2, 3, 4].includes(Number(body.status)) ? Number(body.status) : 2
    }
  );
  return { projectId: result.insertId };
}

async function listFactoryStaff(companyId, query, user) {
  const { page, pageSize, offset } = paging(query);
  const params = { companyId, scopeUserId: user.id, projectId: query.projectId ? Number(query.projectId) : null, pageSize, offset };
  const where = `fs.company_id = :companyId AND (:projectId IS NULL OR fs.project_id = :projectId) ${projectScope(user, params, 'p')}`;
  const total = await db.first(`SELECT COUNT(*) total FROM factory_staff fs JOIN labor_project p ON p.id = fs.project_id WHERE ${where}`, params);
  const list = await db.query(
    `SELECT fs.id, fs.project_id projectId, p.project_name projectName, fs.employee_id employeeId,
            e.employee_no employeeNo, e.name employeeName, e.phone, fs.factory_area factoryArea,
            fs.workshop, fs.shift_name shiftName, fs.dormitory, fs.entry_date entryDate,
            fs.exit_date exitDate, fs.onsite_status onsiteStatus, u.real_name onsiteManagerName, fs.remark
     FROM factory_staff fs JOIN labor_project p ON p.id = fs.project_id
     JOIN hr_employee e ON e.id = fs.employee_id AND e.company_id = fs.company_id
     LEFT JOIN sys_user u ON u.id = fs.onsite_manager_id
     WHERE ${where} ORDER BY fs.id DESC LIMIT :pageSize OFFSET :offset`, params
  );
  return { page, pageSize, total: Number(total.total), list: list.map(item => ({ ...item, phone: maskPhone(item.phone) })) };
}

async function createFactoryStaff(companyId, body, user) {
  if (!body.projectId || !body.employeeId || !body.entryDate) throw createError('项目、员工和进厂日期不能为空');
  await assertEmployeeScope(companyId, Number(body.employeeId), user);
  const projectParams = { companyId, projectId: Number(body.projectId) };
  const project = await db.first(
    `SELECT p.id FROM labor_project p WHERE p.company_id = :companyId AND p.id = :projectId ${projectScope(user, projectParams, 'p')}`,
    projectParams
  );
  if (!project) throw createError('项目不存在或无项目权限', 403);
  const employee = await db.first('SELECT id FROM hr_employee WHERE company_id = :companyId AND id = :employeeId AND employee_status IN (1,2) AND deleted_at IS NULL', { companyId, employeeId: Number(body.employeeId) });
  if (!employee) throw createError('员工不存在或状态不可进厂');
  const activeRecord = await db.first(
    'SELECT id FROM factory_staff WHERE company_id = :companyId AND project_id = :projectId AND employee_id = :employeeId AND onsite_status IN (1,2,3) LIMIT 1',
    { companyId, projectId: Number(body.projectId), employeeId: Number(body.employeeId) }
  );
  if (activeRecord) throw createError('该员工在此项目已有未结束的驻厂记录');
  const result = await db.query(
    `INSERT INTO factory_staff
     (company_id, project_id, employee_id, factory_area, workshop, shift_name, dormitory, entry_date,
      onsite_manager_id, onsite_status, remark)
     VALUES (:companyId, :projectId, :employeeId, :factoryArea, :workshop, :shiftName, :dormitory, :entryDate,
      :managerId, :status, :remark)`,
    {
      companyId, projectId: Number(body.projectId), employeeId: Number(body.employeeId), factoryArea: body.factoryArea || null,
      workshop: body.workshop || body.factoryArea || null, shiftName: body.shiftName || null, dormitory: body.dormitory || null,
      entryDate: body.entryDate, managerId: body.onsiteManagerId ? Number(body.onsiteManagerId) : null,
      status: Number(body.onsiteStatus || 2), remark: body.remark || null
    }
  );
  return { factoryStaffId: result.insertId };
}

async function listBlacklist(companyId, query) {
  const { page, pageSize, offset } = paging(query);
  const params = { companyId, keyword: `%${query.keyword || ''}%`, pageSize, offset };
  const filter = query.keyword ? 'AND (person_name LIKE :keyword OR phone LIKE :keyword OR blacklist_reason LIKE :keyword)' : '';
  const total = await db.first(`SELECT COUNT(*) total FROM person_blacklist WHERE company_id = :companyId ${filter}`, params);
  const rows = await db.query(
    `SELECT b.*, p.project_name source_project_name, u.real_name created_by_name
     FROM person_blacklist b LEFT JOIN labor_project p ON p.id = b.source_project_id
     LEFT JOIN sys_user u ON u.id = b.created_by
     WHERE b.company_id = :companyId ${filter} ORDER BY b.status DESC, b.id DESC LIMIT :pageSize OFFSET :offset`, params
  );
  return {
    page, pageSize, total: Number(total.total),
    list: rows.map(row => ({
      id: row.id, personName: row.person_name, idCardNo: maskIdCard(decrypt(row.id_card_no)), phone: maskPhone(row.phone),
      blacklistReason: row.blacklist_reason, riskLevel: row.risk_level, sourceProjectName: row.source_project_name || row.source_name || '',
      evidenceUrl: row.evidence_url || '', status: row.status, createdByName: row.created_by_name || '', createdAt: row.created_at
    }))
  };
}

async function createBlacklist(companyId, body, operatorId) {
  const personName = body.personName || body.name;
  const blacklistReason = body.blacklistReason || body.reason;
  if (!personName || !body.idCardNo || !blacklistReason) throw createError('姓名、身份证号码和黑名单原因不能为空');
  if (!/^\d{17}[\dXx]$/.test(body.idCardNo)) throw createError('身份证号格式不正确');
  const result = await db.query(
    `INSERT INTO person_blacklist
     (company_id, person_name, id_card_no, id_card_hash, phone, blacklist_reason, risk_level,
      source_project_id, source_name, evidence_url, created_by)
     VALUES (:companyId, :personName, :idCardNo, :idCardHash, :phone, :reason, :riskLevel,
      :sourceProjectId, :sourceName, :evidenceUrl, :operatorId)`,
    {
      companyId, personName, idCardNo: encrypt(body.idCardNo), idCardHash: sha256(body.idCardNo),
      phone: body.phone || null, reason: blacklistReason, riskLevel: Number(body.riskLevel) || ({ 高: 3, 中: 2, 低: 1 }[body.riskLevel] || 2),
      sourceProjectId: body.sourceProjectId ? Number(body.sourceProjectId) : null,
      sourceName: body.sourceName || body.source || null,
      evidenceUrl: body.evidenceUrl || null, operatorId
    }
  );
  return { blacklistId: result.insertId };
}

async function createBlacklistBatch(companyId, rows, operatorId) {
  if (!Array.isArray(rows) || rows.length === 0) throw createError('批量黑名单不能为空');
  if (rows.length > 200) throw createError('单次最多录入200人');
  const errors = [];
  let successCount = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    try {
      await createBlacklist(companyId, row, operatorId);
      successCount += 1;
    } catch (error) {
      const message = error.code === 'ER_DUP_ENTRY' ? '该身份证号码已在公司黑名单中' : error.message;
      errors.push({ row: index + 1, name: row.name || row.personName || '', message });
    }
  }
  return { total: rows.length, successCount, failureCount: errors.length, errors };
}

async function listAdvances(companyId, query, user) {
  const { page, pageSize, offset } = paging(query);
  const month = String(query.month || '').trim();
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw createError('月份格式不正确，请使用YYYY-MM');
  let monthStart = null;
  let monthEnd = null;
  if (month) {
    const [year, monthNumber] = month.split('-').map(Number);
    monthStart = `${month}-01 00:00:00`;
    const nextMonth = monthNumber === 12
      ? `${year + 1}-01`
      : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
    monthEnd = `${nextMonth}-01 00:00:00`;
  }
  const params = {
    companyId,
    status: query.status ? Number(query.status) : null,
    monthStart,
    monthEnd,
    pageSize,
    offset
  };
  const scopeFilter = employeeScope(user, params, 'e', 'j');
  const monthFilter = month
    ? ' AND COALESCE(a.paid_at,a.created_at) >= :monthStart AND COALESCE(a.paid_at,a.created_at) < :monthEnd'
    : '';
  const where = `a.company_id = :companyId AND (:status IS NULL OR a.advance_status = :status)${monthFilter}${scopeFilter}`;
  const total = await db.first(`SELECT COUNT(*) total FROM salary_advance a
    JOIN hr_employee e ON e.id=a.employee_id AND e.company_id=a.company_id
    LEFT JOIN hr_employee_job j ON j.id=(
      SELECT j2.id FROM hr_employee_job j2
      WHERE j2.employee_id=e.id AND j2.company_id=e.company_id
      ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
    )
    LEFT JOIN labor_project p ON p.id=a.project_id AND p.company_id=a.company_id
    WHERE ${where}`, params);
  const [summary, list] = await Promise.all([
    db.first(
      `SELECT COUNT(*) summaryCount,
              COALESCE(SUM(CASE WHEN a.advance_status IN (4,5) THEN a.approved_amount ELSE 0 END),0) summaryPaidAmount,
              COALESCE(SUM(CASE WHEN a.advance_status=5 THEN a.approved_amount ELSE 0 END),0) summaryRecoveredAmount,
              COALESCE(SUM(a.outstanding_amount),0) summaryOutstandingAmount
       FROM salary_advance a
       JOIN hr_employee e ON e.id=a.employee_id AND e.company_id=a.company_id
       LEFT JOIN hr_employee_job j ON j.id=(
         SELECT j2.id FROM hr_employee_job j2
         WHERE j2.employee_id=e.id AND j2.company_id=e.company_id
         ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
       )
       WHERE ${where}`,
      params
    ),
    db.query(
    `SELECT a.id, a.apply_no applyNo, a.employee_id employeeId, e.name employeeName, e.employee_no employeeNo,
            a.apply_amount applyAmount, a.approved_amount approvedAmount, a.apply_reason applyReason,
            a.advance_status advanceStatus, a.outstanding_amount outstandingAmount, a.created_at createdAt,
            a.paid_at paidAt, COALESCE(a.paid_at,a.created_at) advanceAt,
            CASE WHEN a.advance_status IN (4,5) THEN a.approved_amount ELSE 0 END paidAmount,
            creator.real_name recordedByName, creator.username recordedByUsername,
            c.customer_name customerName, p.project_name projectName
     FROM salary_advance a JOIN hr_employee e ON e.id = a.employee_id AND e.company_id=a.company_id
     LEFT JOIN hr_employee_job j ON j.id=(
       SELECT j2.id FROM hr_employee_job j2
       WHERE j2.employee_id=e.id AND j2.company_id=e.company_id
       ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
     )
     LEFT JOIN crm_customer c ON c.id=j.customer_id AND c.company_id=e.company_id
     LEFT JOIN labor_project p ON p.id=a.project_id AND p.company_id=a.company_id
     LEFT JOIN sys_user creator ON creator.id=a.created_by AND (creator.company_id=a.company_id OR creator.company_id IS NULL)
     WHERE ${where}
     ORDER BY a.id DESC LIMIT :pageSize OFFSET :offset`, params
    )
  ]);
  return {
    page,
    pageSize,
    total: Number(total.total),
    month,
    summary: {
      count: Number(summary?.summaryCount || 0),
      advanceAmount: Number(summary?.summaryPaidAmount || 0),
      recoveredAmount: Number(summary?.summaryRecoveredAmount || 0),
      outstandingAmount: Number(summary?.summaryOutstandingAmount || 0)
    },
    list
  };
}

function normalizeAdvanceAt(value) {
  const raw = String(value || '').trim();
  const matched = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!matched) throw createError('请选择正确的预支时间');
  const normalized = `${matched[1]} ${matched[2]}:${matched[3] || '00'}`;
  const timestamp = new Date(`${matched[1]}T${matched[2]}:${matched[3] || '00'}+08:00`).getTime();
  if (!Number.isFinite(timestamp)) throw createError('预支时间格式不正确');
  const now = Date.now();
  if (timestamp > now + 10 * 60 * 1000) throw createError('预支时间不能晚于当前时间');
  if (timestamp < now - 366 * 24 * 60 * 60 * 1000) throw createError('只能补录最近一年内的预支记录');
  return normalized;
}

async function createAdvance(companyId, body, operatorId, user) {
  const applyReason = body.applyReason || body.purpose;
  if (!body.employeeId || !body.applyAmount || !applyReason) throw createError('员工、预支金额和原因不能为空');
  const amount = Number(body.applyAmount);
  if (amount <= 0) throw createError('预支金额必须大于0');
  if (amount > 2000) throw createError('单笔预支金额不能超过2000元');
  const onsiteRecord = body.recordMode === 'onsite';
  const advanceAt = onsiteRecord ? normalizeAdvanceAt(body.advanceAt) : null;
  await assertEmployeeScope(companyId, Number(body.employeeId), user);
  const employee = await db.first(
    `SELECT e.id, j.customer_id customerId FROM hr_employee e
     LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
     WHERE e.company_id=:companyId AND e.id=:employeeId AND e.employee_status=2 AND e.deleted_at IS NULL LIMIT 1`,
    { companyId, employeeId: Number(body.employeeId) }
  );
  if (!employee) throw createError('仅在职员工可申请工资预支');
  const customerId = body.customerId ? Number(body.customerId) : Number(employee.customerId || 0);
  if (!customerId || customerId !== Number(employee.customerId)) throw createError('所选客户单位与员工当前客户单位不一致');
  const projectId = body.projectId ? Number(body.projectId) : null;
  if (Number(user?.dataScope) === 5 && !projectId) throw createError('授权项目范围账号申请预支时必须选择项目');
  if (projectId) {
    const projectParams = { companyId, projectId };
    const project = await db.first(
      `SELECT p.id,p.customer_id customerId FROM labor_project p
       WHERE p.company_id=:companyId AND p.id=:projectId AND p.status=2 ${projectScope(user, projectParams, 'p')}`,
      projectParams
    );
    if (!project) throw createError('项目不存在或无项目权限', 403);
    if (Number(project.customerId) !== customerId) {
      throw createError('员工当前所属客户单位与所选项目不一致');
    }
  }
  const balance = await db.first('SELECT COALESCE(SUM(outstanding_amount),0) total FROM salary_advance WHERE company_id = :companyId AND employee_id = :employeeId AND advance_status IN (2,4)', { companyId, employeeId: Number(body.employeeId) });
  // 预支额度属于企业规则，不能由前端请求自行提高。
  const limit = 3000;
  if (Number(balance.total) + amount > limit) throw createError(`超过预支额度，当前可用额度为${Math.max(limit - Number(balance.total), 0)}元`);
  const applyNo = `YZ${Date.now()}`;
  const result = await db.query(
    `INSERT INTO salary_advance
     (company_id, project_id, employee_id, apply_no, apply_amount, approved_amount, apply_reason,
      advance_status, approval_remark, paid_at, paid_by, outstanding_amount, created_by)
     VALUES (:companyId, :projectId, :employeeId, :applyNo, :amount, :approvedAmount, :reason,
             :advanceStatus, :approvalRemark, :paidAt, :paidBy, :outstandingAmount, :operatorId)`,
    {
      companyId,
      projectId,
      employeeId: Number(body.employeeId),
      applyNo,
      amount,
      approvedAmount: onsiteRecord ? amount : null,
      reason: String(applyReason).trim().slice(0, 255),
      advanceStatus: onsiteRecord ? 4 : 1,
      approvalRemark: onsiteRecord ? '驻厂现场登记' : null,
      paidAt: advanceAt,
      paidBy: onsiteRecord ? operatorId : null,
      outstandingAmount: onsiteRecord ? amount : 0,
      operatorId
    }
  );
  if (onsiteRecord) {
    // 财务敏感操作只记录对象、项目和状态，不在审计日志中写入金额与用途明文。
    await db.query(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'驻厂预支','salary_advance',:advanceId,'create_onsite_record',
               JSON_OBJECT('employeeId',:employeeId,'projectId',:projectId,'status','recorded'))`,
      { companyId, operatorId, advanceId: result.insertId, employeeId: Number(body.employeeId), projectId }
    );
  }
  return { advanceId: result.insertId, applyNo, recorded: onsiteRecord, advanceAt };
}

async function assertAdvanceScope(companyId, advanceId, user) {
  const params = { companyId, advanceId };
  const employeeFilter = employeeScope(user, params, 'e', 'j');
  const projectFilter = Number(user?.dataScope) === 5 ? projectScope(user, params, 'p') : '';
  const advance = await db.first(
    `SELECT a.id,a.employee_id,a.apply_amount,a.advance_status,e.name employee_name FROM salary_advance a
     JOIN hr_employee e ON e.id=a.employee_id AND e.company_id=a.company_id
     LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
     LEFT JOIN labor_project p ON p.id=a.project_id AND p.company_id=a.company_id
     WHERE a.company_id=:companyId AND a.id=:advanceId ${employeeFilter} ${projectFilter} LIMIT 1`,
    params
  );
  if (!advance) throw createError('预支申请不存在或无数据权限', 403);
  return advance;
}

async function approveAdvance(companyId, advanceId, body, operatorId, user) {
  if (![2, 3].includes(Number(body.status))) throw createError('审批状态仅支持通过或驳回');
  const approvedAmount = Number(body.approvedAmount || 0);
  const advance = await assertAdvanceScope(companyId, advanceId, user);
  if (Number(advance.advance_status) !== 1) throw createError('申请不存在或已审批');
  if (Number(body.status) === 2 && (approvedAmount <= 0 || approvedAmount > Number(advance.apply_amount))) {
    throw createError('审批金额必须大于0且不能超过申请金额');
  }
  const result = await db.query(
    `UPDATE salary_advance SET advance_status = :status, approved_amount = :approvedAmount,
     approver_id = :operatorId, approved_at = NOW(), approval_remark = :remark
     WHERE company_id = :companyId AND id = :advanceId AND advance_status = 1`,
    { companyId, advanceId, status: Number(body.status), approvedAmount: Number(body.status) === 2 ? approvedAmount : 0, operatorId, remark: body.remark || null }
  );
  if (!result.affectedRows) throw createError('申请不存在或已审批');
  if (Number(body.status) === 2) {
    await noticeService.createNotice(db.pool, {
      companyId,
      employeeId: advance.employee_id,
      title: `${advance.employee_name}预支${approvedAmount.toFixed(2)}元已审批通过`,
      category: '预支审批',
      noticeType: 'success',
      targetView: 'advances',
      dedupeKey: `advance-approved:${advanceId}`
    });
  }
  return { advanceId };
}

async function payAdvance(companyId, advanceId, operatorId, user) {
  const advance = await assertAdvanceScope(companyId, advanceId, user);
  if (Number(advance.advance_status) !== 2) throw createError('申请不存在或当前状态不可放款');
  const result = await db.query(
    `UPDATE salary_advance SET advance_status = 4, paid_at = NOW(), paid_by = :operatorId,
     outstanding_amount = approved_amount WHERE company_id = :companyId AND id = :advanceId AND advance_status = 2`,
    { companyId, advanceId, operatorId }
  );
  if (!result.affectedRows) throw createError('申请不存在或当前状态不可放款');
  return { advanceId };
}

async function payrollOverview(companyId, user, query = {}) {
  const requested = paging(query, { defaultPageSize: 20, maxPageSize: 50 });
  const salaryMonth = String(query.salaryMonth || '').trim();
  if (salaryMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(salaryMonth)) {
    throw createError('工资月份格式不正确');
  }
  const status = String(query.status || 'all').trim().toLowerCase();
  const allowedStatuses = new Set(['all', 'published', 'pending', 'failed', 'unsigned', 'unread']);
  if (!allowedStatuses.has(status)) throw createError('工资批次筛选状态无效');
  const params = {
    companyId,
    pageSize: requested.pageSize,
    offset: requested.offset,
    salaryMonth,
    status
  };
  const batchFilters = [];
  if (salaryMonth) batchFilters.push('b.salary_month = :salaryMonth');
  if (status === 'published') batchFilters.push('b.batch_status=5');
  if (status === 'pending') batchFilters.push('b.batch_status IN (1,2,3,4)');
  if (status === 'failed') {
    batchFilters.push(`b.batch_status=5 AND EXISTS(
      SELECT 1 FROM salary_detail failed_detail
      WHERE failed_detail.company_id=b.company_id AND failed_detail.batch_id=b.id
        AND failed_detail.receipt_status=0
    )`);
  }
  if (status === 'unsigned') {
    batchFilters.push(`b.batch_status=5 AND EXISTS(
      SELECT 1 FROM salary_detail unsigned_detail
      WHERE unsigned_detail.company_id=b.company_id AND unsigned_detail.batch_id=b.id
        AND unsigned_detail.receipt_status=1
    )`);
  }
  if (status === 'unread') {
    batchFilters.push(`b.batch_status=5 AND EXISTS(
      SELECT 1 FROM salary_detail unread_detail
      WHERE unread_detail.company_id=b.company_id AND unread_detail.batch_id=b.id
        AND NOT EXISTS(
          SELECT 1 FROM salary_receipt_log unread_view
          WHERE unread_view.company_id=unread_detail.company_id
            AND unread_view.salary_detail_id=unread_detail.id
            AND unread_view.employee_id=unread_detail.employee_id
            AND unread_view.action_type='VIEW'
        )
    )`);
  }
  const batchFilterSql = batchFilters.length ? ` AND ${batchFilters.join(' AND ')}` : '';
  const projectFilter = projectScope(user, params, 'b_project');
  const summary = await db.first(
    `SELECT COUNT(*) batchCount,
            COALESCE(SUM(CASE WHEN batch_status=5 THEN total_gross ELSE 0 END),0) totalGross,
            COALESCE(SUM(CASE WHEN batch_status=5 THEN total_net ELSE 0 END),0) totalNet,
            COALESCE(SUM(CASE WHEN batch_status IN (1,2,3,4) THEN 1 ELSE 0 END),0) pendingBatchCount
     FROM salary_batch b
     LEFT JOIN labor_project b_project ON b_project.id = b.project_id AND b_project.company_id = b.company_id
     WHERE b.company_id = :companyId ${projectFilter}`, params
  );
  const publishedMetrics = await db.first(
    `SELECT COUNT(d.id) employeeTotal,
            COALESCE(SUM(EXISTS(
              SELECT 1 FROM salary_receipt_log overview_view
              WHERE overview_view.company_id=d.company_id AND overview_view.salary_detail_id=d.id
                AND overview_view.employee_id=d.employee_id AND overview_view.action_type='VIEW'
            )),0) viewedTotal,
            COALESCE(SUM(CASE WHEN d.receipt_status=2 THEN 1 ELSE 0 END),0) signedTotal,
            COALESCE(SUM(CASE WHEN d.receipt_status=1 THEN 1 ELSE 0 END),0) unsignedTotal
     FROM salary_detail d
     JOIN salary_batch db_batch ON db_batch.id = d.batch_id AND db_batch.company_id = d.company_id
     LEFT JOIN labor_project d_project ON d_project.id = db_batch.project_id AND d_project.company_id = db_batch.company_id
     WHERE d.company_id = :companyId AND db_batch.batch_status=5 ${projectScope(user, params, 'd_project')}`, params
  );
  const filteredSummary = await db.first(
    `SELECT COUNT(*) filteredBatchCount
     FROM salary_batch b
     LEFT JOIN labor_project b_project ON b_project.id=b.project_id AND b_project.company_id=b.company_id
     WHERE b.company_id=:companyId ${projectScope(user, params, 'b_project')}${batchFilterSql}`,
    params
  );
  const pageSize = requested.pageSize;
  const total = Number(filteredSummary.filteredBatchCount || 0);
  const page = Math.min(requested.page, Math.max(1, Math.ceil(total / pageSize)));
  params.offset = (page - 1) * pageSize;
  const batches = await db.query(
    `SELECT b.id, b.batch_no batchNo, b.salary_month salaryMonth, b.payroll_type payrollType,
            b.batch_status batchStatus, b.total_gross grossTotal, b.total_net netTotal,
            b.view_expires_minutes viewExpiresMinutes,
            p.project_name projectName, COUNT(d.id) employeeCount,
            COALESCE(SUM(d.advance_deduction),0) advanceDeduction,
            SUM(CASE WHEN b.batch_status=5 AND d.receipt_status IN (1,2,3) THEN 1 ELSE 0 END) deliverySuccessCount,
            SUM(CASE WHEN b.batch_status=5 AND d.receipt_status=0 THEN 1 ELSE 0 END) deliveryFailedCount,
            SUM(CASE WHEN d.receipt_status=2 THEN 1 ELSE 0 END) signedCount,
            SUM(CASE WHEN d.receipt_status=1 THEN 1 ELSE 0 END) unsignedCount,
            SUM(EXISTS(
              SELECT 1 FROM salary_receipt_log overview_view
              WHERE overview_view.company_id=d.company_id AND overview_view.salary_detail_id=d.id
                AND overview_view.employee_id=d.employee_id AND overview_view.action_type='VIEW'
            )) viewedCount,
            SUM(EXISTS(
              SELECT 1 FROM salary_receipt_log withdraw_view
              WHERE withdraw_view.company_id=d.company_id AND withdraw_view.salary_detail_id=d.id
                AND withdraw_view.employee_id=d.employee_id AND withdraw_view.action_type='VIEW'
            )) withdrawViewedCount,
            SUM(EXISTS(
              SELECT 1 FROM salary_signature withdraw_signature
              WHERE withdraw_signature.company_id=d.company_id AND withdraw_signature.salary_detail_id=d.id
                AND withdraw_signature.employee_id=d.employee_id AND withdraw_signature.status=1
            )) withdrawSignatureCount,
            SUM(d.receipt_status IN (2,3)) withdrawReceiptCount,
            SUM(EXISTS(
              SELECT 1 FROM salary_dispute withdraw_dispute
              WHERE withdraw_dispute.company_id=d.company_id AND withdraw_dispute.salary_detail_id=d.id
                AND withdraw_dispute.employee_id=d.employee_id
            )) withdrawDisputeCount,
            b.created_at createdAt
     FROM salary_batch b
     LEFT JOIN labor_project p ON p.id = b.project_id AND p.company_id = b.company_id
     LEFT JOIN salary_detail d ON d.batch_id = b.id AND d.company_id = b.company_id
     WHERE b.company_id = :companyId ${projectScope(user, params, 'p')}${batchFilterSql}
     GROUP BY b.id, p.project_name ORDER BY b.salary_month DESC, b.id DESC
     LIMIT :pageSize OFFSET :offset`, params
  );
  const statusNames = { 1: '草稿', 2: '核算中', 3: '待复核', 4: '待发放', 5: '已发放', 6: '已归档' };
  function withdrawState(item) {
    if (Number(item.batchStatus) !== 5) return { canWithdraw: false, withdrawBlockedReason: '' };
    if (Number(item.signedCount || 0) > 0) {
      return { canWithdraw: false, withdrawBlockedReason: '已有员工签收，不可撤回' };
    }
    if (Number(item.withdrawDisputeCount || 0) > 0) {
      return { canWithdraw: false, withdrawBlockedReason: '已有员工提交异议，不可撤回' };
    }
    if (Number(item.withdrawSignatureCount || 0) > 0) {
      return { canWithdraw: false, withdrawBlockedReason: '已有员工签名，不可撤回' };
    }
    if (Number(item.withdrawViewedCount || 0) > 0) {
      return { canWithdraw: false, withdrawBlockedReason: '已有员工查看，不可撤回' };
    }
    if (Number(item.withdrawReceiptCount || 0) > 0) {
      return { canWithdraw: false, withdrawBlockedReason: '已有员工处理工资条，不可撤回' };
    }
    return { canWithdraw: true, withdrawBlockedReason: '' };
  }
  return {
    ...summary,
    grossTotal: Number(summary.totalGross || 0),
    netTotal: Number(summary.totalNet || 0),
    employeeTotal: Number(publishedMetrics.employeeTotal || 0),
    viewedTotal: Number(publishedMetrics.viewedTotal || 0),
    signedTotal: Number(publishedMetrics.signedTotal || 0),
    unsignedTotal: Number(publishedMetrics.unsignedTotal || 0),
    pendingReceiptCount: Number(publishedMetrics.unsignedTotal || 0),
    pendingBatchCount: Number(summary.pendingBatchCount || 0),
    page,
    pageSize,
    total,
    batches: batches.map(item => {
      const withdrawal = withdrawState(item);
      return {
        ...item,
        employeeCount: Number(item.employeeCount || 0),
        deliverySuccessCount: Number(item.deliverySuccessCount || 0),
        deliveryFailedCount: Number(item.deliveryFailedCount || 0),
        signedCount: Number(item.signedCount || 0),
        unsignedCount: Number(item.unsignedCount || 0),
        viewedCount: Number(item.viewedCount || 0),
        viewExpiresMinutes: item.viewExpiresMinutes == null ? null : Number(item.viewExpiresMinutes),
        status: Number(item.batchStatus) === 5 ? 'PUBLISHED' : `STATUS_${item.batchStatus}`,
        statusName: statusNames[item.batchStatus] || '未知',
        ...withdrawal
      };
    })
  };
}

function payrollDisputeStatusName(status) {
  return { 0: '待处理', 1: '处理中', 2: '已解决', 3: '已驳回' }[Number(status)] || '未知';
}

async function listPayrollDisputes(companyId, query = {}, user) {
  const { page, pageSize, offset } = paging(query, { defaultPageSize: 20, maxPageSize: 50 });
  const statusText = String(query.handleStatus ?? '').trim();
  const handleStatus = statusText === '' ? null : Number(statusText);
  if (handleStatus !== null && ![0, 1, 2, 3].includes(handleStatus)) {
    throw createError('工资异议状态无效');
  }
  const params = { companyId, pageSize, offset };
  const statusWhere = handleStatus === null ? '' : ' AND sd.handle_status=:handleStatus';
  if (handleStatus !== null) params.handleStatus = handleStatus;
  const scope = projectScope(user, params, 'p');
  const fromSql = `FROM salary_dispute sd
    JOIN salary_detail d ON d.id=sd.salary_detail_id AND d.company_id=sd.company_id
    JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
    JOIN hr_employee e ON e.id=sd.employee_id AND e.company_id=sd.company_id
    LEFT JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
    LEFT JOIN crm_customer c ON c.id=p.customer_id AND c.company_id=p.company_id`;
  const totalRow = await db.first(
    `SELECT COUNT(*) total ${fromSql}
     WHERE sd.company_id=:companyId${statusWhere} ${scope}`,
    params
  );
  const rows = await db.query(
    `SELECT sd.id,sd.salary_detail_id salaryDetailId,sd.employee_id employeeId,
            e.name employeeName,c.customer_name customerName,p.project_name projectName,
            b.id batchId,b.batch_no batchNo,b.salary_month salaryMonth,
            d.gross_amount grossAmount,d.net_amount netAmount,
            sd.dispute_reason disputeReason,sd.handle_status handleStatus,
            sd.handle_remark handleRemark,handler.real_name handlerName,
            sd.created_at createdAt,sd.handled_at handledAt
     ${fromSql}
     LEFT JOIN sys_user handler ON handler.id=sd.handler_id AND handler.company_id=sd.company_id
     WHERE sd.company_id=:companyId${statusWhere} ${scope}
     ORDER BY (sd.handle_status IN (0,1)) DESC,sd.created_at DESC,sd.id DESC
     LIMIT :pageSize OFFSET :offset`,
    params
  );
  return {
    page,
    pageSize,
    total: Number(totalRow?.total || 0),
    list: rows.map(item => ({
      ...item,
      id: Number(item.id),
      salaryDetailId: Number(item.salaryDetailId),
      employeeId: Number(item.employeeId),
      batchId: Number(item.batchId),
      grossAmount: Number(item.grossAmount || 0),
      netAmount: Number(item.netAmount || 0),
      handleStatus: Number(item.handleStatus),
      handleStatusName: payrollDisputeStatusName(item.handleStatus)
    }))
  };
}

async function handlePayrollDispute(companyId, disputeId, body = {}, operatorId, user) {
  const action = String(body.action || '').trim().toLowerCase();
  const targetStatusMap = { processing: 1, resolve: 2, reject: 3 };
  const targetStatus = targetStatusMap[action];
  if (!targetStatus) throw createError('工资异议处理操作无效');
  const remark = String(body.remark || '').trim();
  if (remark.length < 5 || remark.length > 500) throw createError('处理说明需填写5至500字');

  const scopeParams = { companyId, disputeId: Number(disputeId) };
  const scoped = await db.first(
    `SELECT sd.id,sd.salary_detail_id,sd.employee_id,sd.handle_status,
            b.project_id,e.name employee_name,b.salary_month
     FROM salary_dispute sd
     JOIN salary_detail d ON d.id=sd.salary_detail_id AND d.company_id=sd.company_id
     JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
     JOIN hr_employee e ON e.id=sd.employee_id AND e.company_id=sd.company_id
     LEFT JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     WHERE sd.company_id=:companyId AND sd.id=:disputeId ${projectScope(user, scopeParams, 'p')}`,
    scopeParams
  );
  if (!scoped) throw createError('工资异议不存在或无项目权限', 404);

  return db.transaction(async connection => {
    const [[current]] = await connection.execute(
      `SELECT sd.id,sd.salary_detail_id,sd.employee_id,sd.handle_status,
              b.project_id,e.name employee_name,b.salary_month
       FROM salary_dispute sd
       JOIN salary_detail d ON d.id=sd.salary_detail_id AND d.company_id=sd.company_id
       JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       JOIN hr_employee e ON e.id=sd.employee_id AND e.company_id=sd.company_id
       WHERE sd.company_id=:companyId AND sd.id=:disputeId LIMIT 1 FOR UPDATE`,
      { companyId, disputeId: Number(disputeId) }
    );
    if (!current) throw createError('工资异议不存在', 404);
    const currentStatus = Number(current.handle_status);
    if (currentStatus === targetStatus) {
      return { disputeId: Number(disputeId), handleStatus: targetStatus, handleStatusName: payrollDisputeStatusName(targetStatus) };
    }
    if (![0, 1].includes(currentStatus)) throw createError('工资异议已经完成处理，不能重复变更');

    const [updateResult] = await connection.execute(
      `UPDATE salary_dispute SET handle_status=:targetStatus,handler_id=:operatorId,
       handle_remark=:remark,handled_at=${targetStatus === 1 ? 'NULL' : 'NOW()'},updated_at=NOW()
       WHERE company_id=:companyId AND id=:disputeId AND handle_status IN (0,1)`,
      { companyId, disputeId: Number(disputeId), targetStatus, operatorId, remark }
    );
    if (!updateResult.affectedRows) throw createError('工资异议状态已变化，请刷新后重试');

    if (targetStatus === 2 || targetStatus === 3) {
      await connection.execute(
        `UPDATE salary_detail SET receipt_status=1,receipt_at=NULL,updated_at=NOW()
         WHERE company_id=:companyId AND id=:salaryDetailId AND employee_id=:employeeId AND receipt_status=3`,
        {
          companyId,
          salaryDetailId: Number(current.salary_detail_id),
          employeeId: Number(current.employee_id)
        }
      );
    }
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_dispute',:disputeId,:actionType,:afterData)`,
      {
        companyId,
        operatorId,
        disputeId: Number(disputeId),
        actionType: `dispute_${action}`,
        afterData: JSON.stringify({ handleStatus: targetStatus, remark })
      }
    );
    await noticeService.createNotice(connection, {
      companyId,
      employeeId: Number(current.employee_id),
      projectId: Number(current.project_id || 0) || null,
      title: targetStatus === 1
        ? `${current.salary_month}工资异议已开始处理`
        : `${current.salary_month}工资异议${targetStatus === 2 ? '已解决' : '已核对驳回'}，请重新查看工资条`,
      category: '工资异议',
      noticeType: targetStatus === 3 ? 'warning' : 'success',
      targetView: 'payroll',
      dedupeKey: `payroll-dispute:${disputeId}:${targetStatus}`
    });
    return {
      disputeId: Number(disputeId),
      handleStatus: targetStatus,
      handleStatusName: payrollDisputeStatusName(targetStatus)
    };
  });
}

function payrollBatchStatusName(status) {
  return { 1: '草稿', 2: '核算中', 3: '待复核', 4: '待发放', 5: '已发放', 6: '已归档' }[Number(status)] || '未知';
}

function managerPayslipStatus(item, batchStatus) {
  if (Number(batchStatus) !== 5 || Number(item.receiptStatus) === 0) return '未发布';
  if (Number(item.openDisputeId || 0) > 0 || Number(item.receiptStatus) === 3) return '有异议';
  if (Number(item.receiptStatus) === 2) return '已签收';
  return Number(item.viewed || 0) === 1 ? '待签字' : '待查看';
}

function managerDeliveryStatus(item, batchStatus) {
  if (Number(batchStatus) !== 5) return '未发放';
  return [1, 2, 3].includes(Number(item.receiptStatus)) ? '发放成功' : '发放失败';
}

function managerSmsStatus(status) {
  return {
    PENDING: '待发送', SENDING: '发送中', SENT: '发送成功', FAILED: '发送失败',
    SKIPPED_NO_PHONE: '无有效手机号', CANCELLED: '已取消'
  }[String(status || '')] || '未创建通知';
}

function parseItemsForManager(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function getPayrollBatchDetail(companyId, batchId, query = {}, user) {
  const { page, pageSize, offset } = paging(query, { defaultPageSize: 20, maxPageSize: 100 });
  const params = { companyId, batchId: Number(batchId), pageSize, offset };
  const scope = projectScope(user, params, 'p');
  const batch = await db.first(
    `SELECT b.id,b.batch_no batchNo,b.salary_month salaryMonth,b.batch_status batchStatus,
            b.employee_view_enabled employeeViewEnabled,b.view_once viewOnce,b.view_expires_minutes viewExpiresMinutes,
            b.total_gross grossTotal,b.total_net netTotal,b.paid_at paidAt,
            p.project_name projectName,c.customer_name customerName
     FROM salary_batch b
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     LEFT JOIN crm_customer c ON c.id=p.customer_id AND c.company_id=p.company_id
     WHERE b.company_id=:companyId AND b.id=:batchId ${scope}`,
    params
  );
  if (!batch) throw createError('工资批次不存在或无项目权限', 404);

  const progress = await db.first(
    `SELECT COUNT(d.id) total,
            SUM(CASE WHEN NOT EXISTS(
              SELECT 1 FROM employee_wechat_binding wb
              WHERE wb.company_id=d.company_id AND wb.employee_id=d.employee_id AND wb.binding_status=1
            ) THEN 1 ELSE 0 END) unboundCount,
            SUM(CASE WHEN d.receipt_status=1 AND NOT EXISTS(
              SELECT 1 FROM salary_receipt_log view_log
              WHERE view_log.company_id=d.company_id AND view_log.salary_detail_id=d.id
                AND view_log.employee_id=d.employee_id AND view_log.action_type='VIEW'
            ) THEN 1 ELSE 0 END) pendingViewCount,
            SUM(CASE WHEN d.receipt_status=1 AND EXISTS(
              SELECT 1 FROM salary_receipt_log view_log
              WHERE view_log.company_id=d.company_id AND view_log.salary_detail_id=d.id
                AND view_log.employee_id=d.employee_id AND view_log.action_type='VIEW'
            ) THEN 1 ELSE 0 END) pendingSignCount,
            SUM(CASE WHEN d.receipt_status=2 THEN 1 ELSE 0 END) signedCount,
            SUM(CASE WHEN d.receipt_status=3 OR EXISTS(
              SELECT 1 FROM salary_dispute open_dispute
              WHERE open_dispute.company_id=d.company_id AND open_dispute.salary_detail_id=d.id
                AND open_dispute.employee_id=d.employee_id AND open_dispute.handle_status IN (0,1)
            ) THEN 1 ELSE 0 END) disputeCount
     FROM salary_detail d
     JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     WHERE d.company_id=:companyId AND d.batch_id=:batchId ${scope}`,
    params
  );
  const rows = await db.query(
    `SELECT d.id,d.employee_id employeeId,e.name employeeName,e.phone,
            dept.dept_name deptName,
            d.gross_amount grossAmount,d.net_amount netAmount,d.receipt_status receiptStatus,
            d.item_snapshot itemSnapshot,
            d.receipt_at receiptAt,
            EXISTS(
              SELECT 1 FROM salary_receipt_log view_log
              WHERE view_log.company_id=d.company_id AND view_log.salary_detail_id=d.id
                AND view_log.employee_id=d.employee_id AND view_log.action_type='VIEW'
            ) viewed,
            EXISTS(
              SELECT 1 FROM employee_wechat_binding wb
              WHERE wb.company_id=d.company_id AND wb.employee_id=d.employee_id AND wb.binding_status=1
            ) wechatBound,
            signature.signed_name signedName,signature.signed_at signedAt,
            signature.attachment_id signatureAttachmentId,
            sms.delivery_status smsDeliveryStatus,sms.error_summary smsErrorSummary,
            dispute.id openDisputeId
     FROM salary_detail d
     JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
     JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
     LEFT JOIN hr_employee_job job ON job.employee_id=e.id AND job.company_id=e.company_id AND job.job_status=1
     LEFT JOIN hr_department dept ON dept.id=job.dept_id AND dept.company_id=e.company_id
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     LEFT JOIN salary_signature signature ON signature.company_id=d.company_id
       AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
     LEFT JOIN sms_delivery_job sms ON sms.id=(
       SELECT latest_sms.id FROM sms_delivery_job latest_sms
       WHERE latest_sms.company_id=d.company_id AND latest_sms.batch_id=d.batch_id
         AND latest_sms.payslip_id=d.id AND latest_sms.employee_id=d.employee_id
         AND latest_sms.business_type='PAYSLIP_PUBLISHED'
       ORDER BY latest_sms.id DESC LIMIT 1
     )
     LEFT JOIN salary_dispute dispute ON dispute.company_id=d.company_id
       AND dispute.salary_detail_id=d.id AND dispute.employee_id=d.employee_id
       AND dispute.handle_status IN (0,1)
     WHERE d.company_id=:companyId AND d.batch_id=:batchId ${scope}
     ORDER BY d.id LIMIT :pageSize OFFSET :offset`,
    params
  );
  const total = Number(progress?.total || 0);
  const signedCount = Number(progress?.signedCount || 0);
  return {
    batch: {
      ...batch,
      id: Number(batch.id),
      batchStatus: Number(batch.batchStatus),
      employeeViewEnabled: Number(batch.employeeViewEnabled ?? 1),
      viewOnce: Number(batch.viewOnce || 0),
      viewExpiresMinutes: batch.viewExpiresMinutes == null ? null : Number(batch.viewExpiresMinutes),
      grossTotal: Number(batch.grossTotal || 0),
      netTotal: Number(batch.netTotal || 0),
      statusName: payrollBatchStatusName(batch.batchStatus)
    },
    progress: {
      total,
      unboundCount: Number(progress?.unboundCount || 0),
      pendingViewCount: Number(progress?.pendingViewCount || 0),
      pendingSignCount: Number(progress?.pendingSignCount || 0),
      signedCount,
      disputeCount: Number(progress?.disputeCount || 0),
      signedRate: total ? Math.round((signedCount / total) * 100) : 0
    },
    page,
    pageSize,
    total,
    list: rows.map(item => {
      const { itemSnapshot, ...rest } = item;
      const items = parseItemsForManager(itemSnapshot);
      return {
        ...rest,
        id: Number(item.id),
        employeeId: Number(item.employeeId),
        deptName: item.deptName || '',
        phoneMasked: maskPhone(item.phone),
        items,
        grossAmount: Number(item.grossAmount || 0),
        netAmount: Number(item.netAmount || 0),
        receiptStatus: Number(item.receiptStatus || 0),
        viewed: Boolean(Number(item.viewed || 0)),
        wechatBound: Boolean(Number(item.wechatBound || 0)),
        signatureAttachmentId: Number(item.signatureAttachmentId || 0),
        deliveryStatus: managerDeliveryStatus(item, batch.batchStatus),
        smsStatusName: managerSmsStatus(item.smsDeliveryStatus),
        smsErrorSummary: smsDeliveryService.formatErrorSummary('', item.smsErrorSummary),
        signaturePreviewUrl: Number(item.signatureAttachmentId || 0)
          ? `/api/payroll/payslips/${Number(item.id)}/signature`
          : null,
        displayStatus: managerPayslipStatus(item, batch.batchStatus)
      };
    })
  };
}

function escapePayrollCsvCell(value) {
  let text = String(value ?? '');
  // 防止 Excel 将员工姓名等字段识别为公式并执行。
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportPayrollBatchCsv(companyId, batchId, type, user, audit = {}) {
  const exportType = String(type || '').trim().toLowerCase();
  if (!['delivery', 'receipt'].includes(exportType)) throw createError('工资条导出类型无效');
  const params = { companyId, batchId: Number(batchId) };
  const scope = projectScope(user, params, 'p');
  const batch = await db.first(
    `SELECT b.id,b.batch_no batchNo,b.salary_month salaryMonth,b.batch_status batchStatus,
            p.project_name projectName,c.customer_name customerName
     FROM salary_batch b
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     LEFT JOIN crm_customer c ON c.id=p.customer_id AND c.company_id=p.company_id
     WHERE b.company_id=:companyId AND b.id=:batchId ${scope}`,
    params
  );
  if (!batch) throw createError('工资批次不存在或无项目权限', 404);

  const rows = await db.query(
    `SELECT d.id,e.name employeeName,e.phone,d.gross_amount grossAmount,d.net_amount netAmount,
            d.receipt_status receiptStatus,d.receipt_at receiptAt,
            EXISTS(
              SELECT 1 FROM salary_receipt_log view_log
              WHERE view_log.company_id=d.company_id AND view_log.salary_detail_id=d.id
                AND view_log.employee_id=d.employee_id AND view_log.action_type='VIEW'
            ) viewed,
            signature.signed_name signedName,signature.signed_at signedAt,
            sms.delivery_status smsDeliveryStatus,sms.error_summary smsErrorSummary,
            dispute.id openDisputeId
     FROM salary_detail d
     JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
     JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     LEFT JOIN salary_signature signature ON signature.company_id=d.company_id
       AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
     LEFT JOIN sms_delivery_job sms ON sms.id=(
       SELECT latest_sms.id FROM sms_delivery_job latest_sms
       WHERE latest_sms.company_id=d.company_id AND latest_sms.batch_id=d.batch_id
         AND latest_sms.payslip_id=d.id AND latest_sms.employee_id=d.employee_id
         AND latest_sms.business_type='PAYSLIP_PUBLISHED'
       ORDER BY latest_sms.id DESC LIMIT 1
     )
     LEFT JOIN salary_dispute dispute ON dispute.company_id=d.company_id
       AND dispute.salary_detail_id=d.id AND dispute.employee_id=d.employee_id
       AND dispute.handle_status IN (0,1)
     WHERE d.company_id=:companyId AND d.batch_id=:batchId ${scope}
     ORDER BY e.name,d.id`,
    params
  );

  const normalized = rows.map(item => ({
    ...item,
    phoneMasked: maskPhone(item.phone),
    grossAmount: Number(item.grossAmount || 0).toFixed(2),
    netAmount: Number(item.netAmount || 0).toFixed(2),
    deliveryStatus: managerDeliveryStatus(item, batch.batchStatus),
    smsStatusName: managerSmsStatus(item.smsDeliveryStatus),
    displayStatus: managerPayslipStatus(item, batch.batchStatus),
    viewedName: Number(item.viewed || 0) === 1 ? '已查看' : '未查看',
    feedbackName: Number(item.openDisputeId || 0) > 0 || Number(item.receiptStatus) === 3 ? '员工有反馈' : '无反馈'
  }));
  const common = item => [
    item.employeeName, item.phoneMasked, batch.customerName || '', batch.projectName || '', batch.salaryMonth || ''
  ];
  const header = exportType === 'receipt'
    ? ['姓名', '手机号', '客户单位', '所属项目', '工资月份', '实发工资', '查看状态', '签收状态', '签收姓名', '签名时间', '签收时间', '员工反馈']
    : ['姓名', '手机号', '客户单位', '所属项目', '工资月份', '应发工资', '实发工资', '发放状态', '短信状态', '查看与签收', '员工反馈'];
  const lines = [header].concat(normalized.map(item => exportType === 'receipt'
    ? [...common(item), item.netAmount, item.viewedName, item.displayStatus, item.signedName || '', item.signedAt || '', item.receiptAt || '', item.feedbackName]
    : [...common(item), item.grossAmount, item.netAmount, item.deliveryStatus, item.smsStatusName, item.displayStatus, item.feedbackName]));
  const csv = `\uFEFF${lines.map(line => line.map(escapePayrollCsvCell).join(',')).join('\n')}`;
  const actionType = exportType === 'receipt' ? 'export_payroll_receipts' : 'export_payroll_delivery';
  await db.query(
    `INSERT INTO hr_operation_log
     (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data,ip_address)
     VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,:actionType,:afterData,:ipAddress)`,
    {
      companyId,
      operatorId: Number(audit.operatorId || user?.id || 0) || null,
      batchId: Number(batchId),
      actionType,
      afterData: JSON.stringify({
        exportType,
        count: normalized.length,
        fileSha256: nodeCrypto.createHash('sha256').update(csv, 'utf8').digest('hex'),
        userAgent: String(audit.userAgent || '').slice(0, 120)
      }),
      ipAddress: String(audit.ipAddress || '').slice(0, 50) || null
    }
  );
  return { csv, count: normalized.length, batchNo: batch.batchNo, salaryMonth: batch.salaryMonth };
}

// 工资条签收记录 PDF 导出（含员工手写签名图片）
async function exportPayrollReceiptPdf(companyId, batchId, user, audit = {}) {
  const params = { companyId, batchId: Number(batchId) };
  const scope = projectScope(user, params, 'p');
  const batch = await db.first(
    `SELECT b.id,b.batch_no batchNo,b.salary_month salaryMonth,b.batch_status batchStatus,
            p.project_name projectName,c.customer_name customerName
     FROM salary_batch b
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     LEFT JOIN crm_customer c ON c.id=p.customer_id AND c.company_id=p.company_id
     WHERE b.company_id=:companyId AND b.id=:batchId ${scope}`,
    params
  );
  if (!batch) throw createError('工资批次不存在或无项目权限', 404);

  const rows = await db.query(
    `SELECT d.id,e.name employeeName,e.phone,d.net_amount netAmount,
            d.receipt_status receiptStatus,d.receipt_at receiptAt,
            EXISTS(
              SELECT 1 FROM salary_receipt_log view_log
              WHERE view_log.company_id=d.company_id AND view_log.salary_detail_id=d.id
                AND view_log.employee_id=d.employee_id AND view_log.action_type='VIEW'
            ) viewed,
            signature.signed_name signedName,signature.signed_at signedAt,
            attachment.storage_path signatureStoragePath,
            dispute.id openDisputeId
     FROM salary_detail d
     JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
     JOIN hr_employee e ON e.id=d.employee_id AND e.company_id=d.company_id
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     LEFT JOIN salary_signature signature ON signature.company_id=d.company_id
       AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
     LEFT JOIN hr_attachment attachment ON attachment.id=signature.attachment_id
       AND attachment.company_id=signature.company_id AND attachment.biz_type='payslip_signature'
       AND attachment.biz_id=d.id AND attachment.status=1
     LEFT JOIN salary_dispute dispute ON dispute.company_id=d.company_id
       AND dispute.salary_detail_id=d.id AND dispute.employee_id=d.employee_id
       AND dispute.handle_status IN (0,1)
     WHERE d.company_id=:companyId AND d.batch_id=:batchId ${scope}
     ORDER BY e.name,d.id`,
    params
  );

  const fontBytes = await loadPdfFontBytes();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  // 嵌入完整字体而非子集：fontkit 子集化会损坏部分 CJK 字形数据导致乱码。
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });

  const normalized = [];
  let signedCount = 0;
  for (const item of rows) {
    const isSigned = Number(item.receiptStatus) === 2 && !!item.signatureStoragePath;
    if (isSigned) signedCount += 1;
    let signatureImage = null;
    if (isSigned) {
      const absolutePath = path.resolve(PDF_UPLOAD_ROOT, String(item.signatureStoragePath || ''));
      if (absolutePath.startsWith(`${PDF_UPLOAD_ROOT}${path.sep}`)) {
        try {
          signatureImage = await pdfDoc.embedPng(await fs.readFile(absolutePath));
        } catch (_error) {
          signatureImage = null;
        }
      }
    }
    normalized.push({
      employeeName: item.employeeName,
      phoneMasked: maskPhone(item.phone),
      netAmount: Number(item.netAmount || 0).toFixed(2),
      displayStatus: managerPayslipStatus(item, batch.batchStatus),
      receiptAt: item.receiptAt || '',
      signedAt: item.signedAt || '',
      signatureImage
    });
  }

  const PAGE_WIDTH = 842;
  const PAGE_HEIGHT = 595;
  const MARGIN = 40;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const FONT_TITLE = 16;
  const FONT_META = 9;
  const FONT_HEADER = 9;
  const FONT_CELL = 9;
  const HEADER_HEIGHT = 22;
  const ROW_HEIGHT = 26;
  const SIGNATURE_MAX_WIDTH = 210;
  const SIGNATURE_MAX_HEIGHT = 18;
  const textColor = rgb(0.1, 0.1, 0.1);
  const mutedColor = rgb(0.6, 0.6, 0.6);
  const headerBg = rgb(0.93, 0.93, 0.93);
  const lineColor = rgb(0.75, 0.75, 0.75);

  const columns = [
    { label: '序号', width: 34, align: 'center' },
    { label: '姓名', width: 108, align: 'left' },
    { label: '手机号', width: 96, align: 'left' },
    { label: '实发工资', width: 90, align: 'right' },
    { label: '签收状态', width: 76, align: 'center' },
    { label: '签收时间', width: 118, align: 'left' },
    { label: '签名', width: 240, align: 'center' }
  ];
  const colX = [];
  let cursorX = MARGIN;
  for (const col of columns) {
    colX.push(cursorX);
    cursorX += col.width;
  }

  function baseline(centerY, size) {
    // CJK 字形视觉中心约在基线以上 0.35em，据此将文本垂直居中于单元格。
    return centerY - size * 0.35;
  }
  function fitCellText(text, size, maxWidth) {
    const value = String(text ?? '');
    if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
    let result = value;
    while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
      result = result.slice(0, -1);
    }
    return `${result}…`;
  }
  function drawHeaderRow(page, topY) {
    page.drawRectangle({ x: MARGIN, y: topY - HEADER_HEIGHT, width: CONTENT_WIDTH, height: HEADER_HEIGHT, color: headerBg });
    const centerY = topY - HEADER_HEIGHT / 2;
    for (let ci = 0; ci < columns.length; ci += 1) {
      const col = columns[ci];
      const measured = font.widthOfTextAtSize(col.label, FONT_HEADER);
      const tx = col.align === 'right'
        ? colX[ci] + col.width - measured - 4
        : col.align === 'center' ? colX[ci] + (col.width - measured) / 2 : colX[ci] + 4;
      page.drawText(col.label, { x: tx, y: baseline(centerY, FONT_HEADER), size: FONT_HEADER, font, color: textColor });
    }
    page.drawLine({ start: { x: MARGIN, y: topY - HEADER_HEIGHT }, end: { x: MARGIN + CONTENT_WIDTH, y: topY - HEADER_HEIGHT }, thickness: 0.5, color: lineColor });
  }
  function drawDataRow(page, topY, index, item) {
    const centerY = topY - ROW_HEIGHT / 2;
    const values = [
      String(index + 1),
      item.employeeName,
      item.phoneMasked,
      item.netAmount,
      item.displayStatus,
      item.receiptAt || item.signedAt || '-'
    ];
    for (let ci = 0; ci < 6; ci += 1) {
      const col = columns[ci];
      const text = fitCellText(values[ci], FONT_CELL, col.width - 8);
      const measured = font.widthOfTextAtSize(text, FONT_CELL);
      const tx = col.align === 'right'
        ? colX[ci] + col.width - measured - 4
        : col.align === 'center' ? colX[ci] + (col.width - measured) / 2 : colX[ci] + 4;
      page.drawText(text, { x: tx, y: baseline(centerY, FONT_CELL), size: FONT_CELL, font, color: textColor });
    }
    const sigCol = columns[6];
    if (item.signatureImage) {
      const scale = Math.min(
        SIGNATURE_MAX_WIDTH / item.signatureImage.width,
        SIGNATURE_MAX_HEIGHT / item.signatureImage.height,
        1
      );
      const width = item.signatureImage.width * scale;
      const height = item.signatureImage.height * scale;
      page.drawImage(item.signatureImage, {
        x: colX[6] + (sigCol.width - width) / 2,
        y: centerY - height / 2,
        width,
        height
      });
    } else {
      const text = '—';
      const measured = font.widthOfTextAtSize(text, FONT_CELL);
      page.drawText(text, { x: colX[6] + (sigCol.width - measured) / 2, y: baseline(centerY, FONT_CELL), size: FONT_CELL, font, color: mutedColor });
    }
    page.drawLine({ start: { x: MARGIN, y: topY - ROW_HEIGHT }, end: { x: MARGIN + CONTENT_WIDTH, y: topY - ROW_HEIGHT }, thickness: 0.5, color: lineColor });
  }

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let topY = PAGE_HEIGHT - MARGIN;
  page.drawText('工资条签收记录', { x: MARGIN, y: topY - FONT_TITLE, size: FONT_TITLE, font, color: textColor });
  topY -= FONT_TITLE + 8;
  const metaText = `客户单位：${batch.customerName || '-'}　项目：${batch.projectName || '-'}　工资月份：${batch.salaryMonth || '-'}　批次号：${batch.batchNo || '-'}`;
  page.drawText(metaText, { x: MARGIN, y: topY - FONT_META, size: FONT_META, font, color: textColor });
  topY -= FONT_META + 4;
  const summaryText = `总人数 ${normalized.length} 人 · 已签收 ${signedCount} 人 · 未签收 ${normalized.length - signedCount} 人`;
  page.drawText(summaryText, { x: MARGIN, y: topY - FONT_META, size: FONT_META, font, color: textColor });
  topY -= FONT_META + 12;
  drawHeaderRow(page, topY);
  topY -= HEADER_HEIGHT;

  for (let i = 0; i < normalized.length; i += 1) {
    if (topY - ROW_HEIGHT < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      topY = PAGE_HEIGHT - MARGIN;
      drawHeaderRow(page, topY);
      topY -= HEADER_HEIGHT;
    }
    drawDataRow(page, topY, i, normalized[i]);
    topY -= ROW_HEIGHT;
  }

  const pdfBytes = await pdfDoc.save();
  const fileSha256 = nodeCrypto.createHash('sha256').update(pdfBytes).digest('hex');
  await db.query(
    `INSERT INTO hr_operation_log
     (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data,ip_address)
     VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,:actionType,:afterData,:ipAddress)`,
    {
      companyId,
      operatorId: Number(audit.operatorId || user?.id || 0) || null,
      batchId: Number(batchId),
      actionType: 'export_payroll_receipts_pdf',
      afterData: JSON.stringify({
        count: normalized.length,
        signedCount,
        fileSha256,
        userAgent: String(audit.userAgent || '').slice(0, 120)
      }),
      ipAddress: String(audit.ipAddress || '').slice(0, 50) || null
    }
  );
  return { buffer: Buffer.from(pdfBytes), count: normalized.length, batchNo: batch.batchNo, salaryMonth: batch.salaryMonth };
}

function payrollAmount(value, fieldName) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) throw createError(`${fieldName}必须为非负数字`);
  return Math.round(amount * 100) / 100;
}

function normalizePayrollAmounts(row = {}) {
  const amounts = {
    baseSalary: 0,
    positionSalary: 0,
    performanceSalary: 0,
    allowanceAmount: 0,
    pieceAmount: 0,
    overtime15Amount: 0,
    overtime20Amount: 0,
    overtime30Amount: 0,
    socialDeduction: 0,
    taxDeduction: 0,
    advanceDeduction: 0,
    otherDeduction: 0
  };
  const hasImportedGross = row.grossAmount !== undefined && row.grossAmount !== null
    && String(row.grossAmount).trim() !== '';
  const hasImportedNet = row.netAmount !== undefined && row.netAmount !== null && String(row.netAmount).trim() !== '';
  const grossAmount = hasImportedGross ? payrollAmount(row.grossAmount, '应发工资') : 0;
  const netAmount = hasImportedNet ? payrollAmount(row.netAmount, '实发工资') : 0;
  return {
    amounts,
    grossAmount,
    netAmount,
    warnings: []
  };
}

const payrollAdvisoryPatterns = [
  /实发工资不能超过应发工资/,
  /实发工资与应发工资、扣款明细无法对应/,
  /扣款合计不能超过应发工资/,
  /应发工资.*与收入明细合计.*不一致/,
  /应发与实发相差.*未列明对应扣款/
];

function classifyPayrollImportMessages(row = {}) {
  const errors = [];
  const warnings = Array.isArray(row.warnings)
    ? row.warnings.map(String).filter(message => message && !payrollAdvisoryPatterns.some(pattern => pattern.test(message)))
    : [];
  for (const message of Array.isArray(row.errors) ? row.errors.map(String).filter(Boolean) : []) {
    if (!payrollAdvisoryPatterns.some(pattern => pattern.test(message))) errors.push(message);
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

function normalizePayrollImportMetadata(body = {}) {
  const present = body.headerSignature != null || body.sourceHeaders != null || body.mapping != null;
  if (!present) return null;
  return {
    headerSignature: payrollImportProfileService.normalizeSignature(body.headerSignature),
    sourceHeaders: payrollImportProfileService.normalizeHeaders(body.sourceHeaders),
    mapping: payrollImportProfileService.normalizeMapping(body.mapping)
  };
}

function assertDynamicNetMatches(itemSnapshot, mapping, netAmount) {
  const netMapping = (mapping || []).find(item => item.target === 'netAmount' && item.includeInPayslip === true);
  if (!netMapping) return;
  const netItem = itemSnapshot.slice().reverse().find(item => item.label === netMapping.sourceHeader);
  const snapshotNet = Number(String(netItem?.value ?? '')
    .replace(/^\s*(?:RMB|CNY)\s*/i, '')
    .replace(/[￥¥,，\s]/g, '')
    .replace(/(?:人民币|元|RMB|CNY)$/i, ''));
  if (!netItem || !Number.isFinite(snapshotNet) || Math.abs(snapshotNet - Number(netAmount)) > 0.01) {
    throw createError('动态工资项目中的实发工资与系统核算结果不一致');
  }
}

function payrollEmployeeIdentity(row = {}, index = 0) {
  const params = {};
  if (String(row.employeeNo || '').trim()) {
    params.employeeNo = String(row.employeeNo).trim();
    return { where: 'e.employee_no=:employeeNo', params };
  }
  if (String(row.idCardNo || '').trim()) {
    params.idCardHash = sha256(row.idCardNo);
    return { where: 'e.id_card_hash=:idCardHash', params };
  }
  if (String(row.employeeName || '').trim()) {
    params.employeeName = String(row.employeeName).trim();
    if (String(row.phone || '').trim()) {
      params.phone = String(row.phone).trim();
      return { where: 'e.name=:employeeName AND e.phone=:phone', params };
    }
    return { where: 'e.name=:employeeName', params };
  }
  if (String(row.phone || '').trim()) {
    params.phone = String(row.phone).trim();
    return { where: 'e.phone=:phone', params };
  }
  throw createError(`第${index + 1}行缺少员工身份信息`);
}

async function resolvePayrollEmployee(executeRows, companyId, project, row, index) {
  const identity = payrollEmployeeIdentity(row, index);
  const params = {
    companyId,
    customerId: Number(project.customerId),
    projectId: Number(project.id),
    ...identity.params
  };
  const employees = await executeRows(
    `SELECT e.id,e.name,e.employee_no employeeNo
     FROM hr_employee e
     WHERE e.company_id=:companyId AND ${identity.where} AND e.employee_status IN (2,3)
       AND e.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM hr_employee_job project_job
         WHERE project_job.employee_id=e.id AND project_job.company_id=e.company_id
           AND project_job.customer_id=:customerId AND project_job.project_id=:projectId
       )
     ORDER BY e.id LIMIT 2`,
    params
  );
  if (!employees.length) throw createError(`第${index + 1}行员工不存在或不属于所选项目`);
  if (employees.length > 1) throw createError(`第${index + 1}行存在重名员工，请增加手机号、工号或身份证号识别`);
  return employees[0];
}

async function previewPayrollBatch(companyId, body, user) {
  if (!body.projectId) throw createError('请选择所属项目');
  if (!Array.isArray(body.rows) || !body.rows.length) throw createError('请至少导入一名员工工资');
  if (body.rows.length > 500) throw createError('单个工资批次最多500人');
  const importMetadata = normalizePayrollImportMetadata(body);
  const projectParams = { companyId, projectId: Number(body.projectId) };
  const project = await db.first(
    `SELECT p.id,p.customer_id customerId,p.project_name projectName
     FROM labor_project p
     WHERE p.company_id=:companyId AND p.id=:projectId AND p.status=2 ${projectScope(user, projectParams, 'p')}`,
    projectParams
  );
  if (!project) throw createError('项目不存在或无项目权限', 403);

  const seenEmployees = new Set();
  const rows = [];
  for (let index = 0; index < body.rows.length; index += 1) {
    const source = body.rows[index] || {};
    const messages = classifyPayrollImportMessages(source);
    const errors = [...messages.errors];
    const warnings = [...messages.warnings];
    let employee = null;
    let payroll = null;
    let itemSnapshot = [];
    try {
      payroll = normalizePayrollAmounts(source);
      warnings.push(...payroll.warnings);
      itemSnapshot = normalizeItemSnapshot(source.itemSnapshot);
      assertDynamicNetMatches(itemSnapshot, importMetadata?.mapping, payroll.netAmount);
    } catch (error) {
      errors.push(error.message);
    }
    try {
      employee = await resolvePayrollEmployee((sql, params) => db.query(sql, params), companyId, project, source, index);
      if (seenEmployees.has(Number(employee.id))) throw createError(`第${index + 1}行员工重复`);
      seenEmployees.add(Number(employee.id));
    } catch (error) {
      errors.push(error.message);
    }
    rows.push({
      rowNumber: Number(source.rowNumber || index + 1),
      employeeId: employee ? Number(employee.id) : null,
      employeeName: employee?.name || String(source.employeeName || '').trim(),
      employeeNo: employee?.employeeNo || String(source.employeeNo || '').trim(),
      sourceRowNo: Number(source.sourceRowNo || source.rowNumber || index + 1),
      itemSnapshot,
      ...(payroll ? { ...payroll.amounts, grossAmount: payroll.grossAmount, netAmount: payroll.netAmount } : {}),
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)]
    });
  }
  const errorRows = rows.filter(item => item.errors.length > 0).length;
  const warningRows = rows.filter(item => item.warnings.length > 0).length;
  return {
    projectId: Number(project.id),
    projectName: project.projectName,
    totalRows: rows.length,
    validRows: rows.length - errorRows,
    errorRows,
    warningRows,
    rows
  };
}

async function createPayrollBatch(companyId, body, operatorId, user) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.salaryMonth || ''))) throw createError('工资月份格式应为 YYYY-MM');
  if (!body.projectId) throw createError('请选择所属项目');
  if (!Array.isArray(body.rows) || !body.rows.length) throw createError('请至少录入一名员工工资');
  if (body.rows.length > 500) throw createError('单个工资批次最多500人');
  const importMetadata = normalizePayrollImportMetadata(body);
  const viewPolicy = normalizePayslipViewPolicy(body);

  const projectParams = { companyId, projectId: Number(body.projectId) };
  const project = await db.first(
    `SELECT p.id, p.customer_id customerId, p.project_name projectName
     FROM labor_project p
     WHERE p.company_id=:companyId AND p.id=:projectId AND p.status=2 ${projectScope(user, projectParams, 'p')}`,
    projectParams
  );
  if (!project) throw createError('项目不存在或无项目权限', 403);

  return db.transaction(async connection => {
    const hasImportProfile = importMetadata !== null;
    let importProfileId = null;
    if (hasImportProfile) {
      const profile = await payrollImportProfileService.upsertProfile(connection, {
        companyId,
        projectId: project.id,
        headerSignature: importMetadata.headerSignature,
        sourceHeaders: importMetadata.sourceHeaders,
        mapping: importMetadata.mapping,
        operatorId
      });
      importProfileId = profile.profileId;
    }
    const sourceSheetName = String(body.sheetName || '').trim();
    if (sourceSheetName.length > 100) throw createError('工作表名称最多100个字符');

    const batchNo = `GZ${String(body.salaryMonth).replace('-', '')}${String(Date.now()).slice(-8)}`;
    const [batchResult] = await connection.execute(
      `INSERT INTO salary_batch
       (company_id,project_id,batch_no,salary_month,payroll_type,batch_status,total_gross,total_net,
        import_profile_id,source_sheet_name,employee_view_enabled,view_once,view_expires_minutes,created_by)
       VALUES (:companyId,:projectId,:batchNo,:salaryMonth,:payrollType,3,0,0,
        :importProfileId,:sourceSheetName,:employeeViewEnabled,:viewOnce,:viewExpiresMinutes,:operatorId)`,
      {
        companyId,
        projectId: project.id,
        batchNo,
        salaryMonth: body.salaryMonth,
        payrollType: Number(body.payrollType || 3),
        importProfileId,
        sourceSheetName: sourceSheetName || null,
        ...viewPolicy,
        operatorId
      }
    );

    const seenEmployees = new Set();
    let totalGross = 0;
    let totalNet = 0;
    for (let index = 0; index < body.rows.length; index += 1) {
      const row = body.rows[index] || {};
      const messages = classifyPayrollImportMessages(row);
      if (messages.errors.length) throw createError(`第${index + 1}行${messages.errors[0]}`);
      const employee = await resolvePayrollEmployee(
        async (sql, params) => {
          const [employees] = await connection.execute(sql, params);
          return employees;
        },
        companyId,
        project,
        row,
        index
      );
      if (seenEmployees.has(employee.id)) throw createError(`第${index + 1}行员工重复`);
      seenEmployees.add(employee.id);

      let normalized;
      let itemSnapshot;
      try {
        normalized = normalizePayrollAmounts(row);
        itemSnapshot = normalizeItemSnapshot(row.itemSnapshot);
        assertDynamicNetMatches(itemSnapshot, importMetadata?.mapping, normalized.netAmount);
      } catch (error) {
        throw createError(`第${index + 1}行${error.message}`);
      }
      const { amounts, grossAmount: gross, netAmount: net } = normalized;
      totalGross += gross;
      totalNet += net;

      await connection.execute(
        `INSERT INTO salary_detail
         (company_id,batch_id,employee_id,base_salary,position_salary,performance_salary,allowance_amount,
          piece_amount,overtime_15_amount,overtime_20_amount,overtime_30_amount,gross_amount,
          social_deduction,tax_deduction,advance_deduction,other_deduction,net_amount,item_snapshot,source_row_no,receipt_status)
         VALUES (:companyId,:batchId,:employeeId,:baseSalary,:positionSalary,:performanceSalary,:allowanceAmount,
          :pieceAmount,:overtime15Amount,:overtime20Amount,:overtime30Amount,:grossAmount,
          :socialDeduction,:taxDeduction,:advanceDeduction,:otherDeduction,:netAmount,:itemSnapshot,:sourceRowNo,0)`,
        {
          companyId,
          batchId: batchResult.insertId,
          employeeId: employee.id,
          ...amounts,
          grossAmount: gross,
          netAmount: net,
          itemSnapshot: itemSnapshot.length ? JSON.stringify(itemSnapshot) : null,
          sourceRowNo: Number(row.sourceRowNo || row.rowNumber || index + 1)
        }
      );
    }

    await connection.execute(
      `UPDATE salary_batch SET total_gross=:totalGross,total_net=:totalNet WHERE id=:batchId AND company_id=:companyId`,
      {
        companyId,
        batchId: batchResult.insertId,
        totalGross: Math.round(totalGross * 100) / 100,
        totalNet: Math.round(totalNet * 100) / 100
      }
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'upload_submit_review',:afterData)`,
      {
        companyId,
        operatorId,
        batchId: batchResult.insertId,
        afterData: JSON.stringify({
          batchNo,
          salaryMonth: body.salaryMonth,
          projectId: project.id,
          employeeCount: seenEmployees.size,
          profileId: importProfileId,
          headerSignature: hasImportProfile ? String(body.headerSignature || '') : null
        })
      }
    );
    return {
      batchId: batchResult.insertId,
      batchNo,
      batchStatus: 3,
      statusName: payrollBatchStatusName(3),
      employeeCount: seenEmployees.size
    };
  });
}

function normalizePayslipViewPolicy(body = {}) {
  const employeeViewEnabled = body.employeeViewEnabled === false || Number(body.employeeViewEnabled) === 0 ? 0 : 1;
  const viewOnce = Number(body.viewOnce || 0) === 1 ? 1 : 0;
  const rawMinutes = body.viewExpiresMinutes;
  const viewExpiresMinutes = rawMinutes === null || rawMinutes === '' || rawMinutes === undefined
    ? null
    : Number(rawMinutes);
  if (viewOnce && !employeeViewEnabled) throw createError('阅后即焚必须先开启员工端查看权限');
  if (viewExpiresMinutes !== null && (!Number.isInteger(viewExpiresMinutes) || viewExpiresMinutes < 1 || viewExpiresMinutes > 43200)) {
    throw createError('工资条有效查看时间应为1至43200分钟');
  }
  return { employeeViewEnabled, viewOnce, viewExpiresMinutes };
}

async function updatePayrollViewPolicy(companyId, batchId, body = {}, operatorId, user) {
  const policy = normalizePayslipViewPolicy(body);
  const params = { companyId, batchId: Number(batchId), operatorId };
  if (!Number.isSafeInteger(params.batchId) || params.batchId <= 0) throw createError('工资批次参数无效');
  const scope = projectScope(user, params, 'p');
  return db.transaction(async connection => {
    const [[batch]] = await connection.execute(
      `SELECT b.id,b.batch_status batchStatus,b.employee_view_enabled employeeViewEnabled,
              b.view_once viewOnce,b.view_expires_minutes viewExpiresMinutes
       FROM salary_batch b JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       WHERE b.company_id=:companyId AND b.id=:batchId ${scope} LIMIT 1 FOR UPDATE`, params
    );
    if (!batch) throw createError('工资批次不存在或无项目权限', 404);
    if (![1, 2, 3, 4].includes(Number(batch.batchStatus))) throw createError('工资批次已发布或归档，不能修改查看策略', 409);
    await connection.execute(
      `UPDATE salary_batch SET employee_view_enabled=:employeeViewEnabled,view_once=:viewOnce,
       view_expires_minutes=:viewExpiresMinutes,updated_at=NOW()
       WHERE company_id=:companyId AND id=:batchId`, { ...params, ...policy }
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,before_data,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'update_view_policy',
        JSON_OBJECT('employeeViewEnabled',:beforeEmployeeViewEnabled,'viewOnce',:beforeViewOnce,'viewExpiresMinutes',:beforeViewExpiresMinutes),
        JSON_OBJECT('employeeViewEnabled',:employeeViewEnabled,'viewOnce',:viewOnce,'viewExpiresMinutes',:viewExpiresMinutes))`,
      { ...params, ...policy, beforeEmployeeViewEnabled: Number(batch.employeeViewEnabled), beforeViewOnce: Number(batch.viewOnce), beforeViewExpiresMinutes: batch.viewExpiresMinutes }
    );
    return { batchId: params.batchId, ...policy };
  });
}

async function finalizePayrollPublication(connection, { companyId, batchId, batch, operatorId, fromStatus, actionType }) {
    const [updateResult] = await connection.execute(
      `UPDATE salary_batch SET batch_status=5,paid_at=NOW(),updated_at=NOW()
       WHERE company_id=:companyId AND id=:batchId AND batch_status=:fromStatus`,
      { companyId, batchId, fromStatus }
    );
    if (!updateResult.affectedRows) throw createError('工资批次状态已变化，请刷新后重试');
    await connection.execute(
      `UPDATE salary_detail SET receipt_status=1,updated_at=NOW()
       WHERE company_id=:companyId AND batch_id=:batchId AND receipt_status=0`,
      { companyId, batchId }
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,:actionType,JSON_OBJECT('status',5))`,
      { companyId, operatorId, batchId, actionType }
    );
    await noticeService.createNotice(connection, {
      companyId,
      projectId: batch.project_id,
      title: `${batch.salary_month}工资条已发布，请及时跟进员工签收`,
      category: '薪资通知',
      noticeType: 'success',
      targetView: 'payroll',
      dedupeKey: `payroll-published:${batchId}`
    });
    const sms = await smsDeliveryService.enqueuePublishedJobs(connection, {
      companyId,
      batchId,
      salaryMonth: batch.salary_month,
      operatorId
    });
    let official = { queued: 0 };
    if (appEnv.wechatOfficial.enabled) {
      official = await officialNotificationService.enqueuePublishedJobs(connection, {
        companyId,
        batchId,
        salaryMonth: batch.salary_month,
        operatorId
      });
    }
    return {
      batchId,
      smsQueued: sms.queued,
      smsSkippedNoPhone: sms.skippedNoPhone,
      officialQueued: official.queued
    };
}

async function publishPayrollBatch(companyId, batchId, operatorId, user) {
  const params = { companyId, batchId };
  return db.transaction(async connection => {
    const [[batch]] = await connection.execute(
      `SELECT b.id,b.project_id,b.batch_status,b.total_net,b.salary_month
       FROM salary_batch b JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       WHERE b.company_id=:companyId AND b.id=:batchId ${projectScope(user, params, 'p')}
       LIMIT 1 FOR UPDATE`,
      params
    );
    if (!batch) throw createError('工资批次不存在或无项目权限', 403);
    if (Number(batch.batch_status) !== 4) throw createError('仅历史待发放工资批次可以单独发布');
    if (Number(batch.total_net) <= 0) throw createError('实发工资合计必须大于0');
    return finalizePayrollPublication(connection, {
      companyId,
      batchId,
      batch,
      operatorId,
      fromStatus: 4,
      actionType: 'publish'
    });
  });
}

async function withdrawPayrollBatch(companyId, batchId, body = {}, operatorId, user) {
  if (body.confirmed !== true) throw createError('请确认撤回工资条');
  const reason = String(body.reason || '').trim();
  if (reason.length < 5 || reason.length > 200) throw createError('撤回原因需填写5至200字');
  const normalizedBatchId = Number(batchId);
  if (!Number.isSafeInteger(normalizedBatchId) || normalizedBatchId <= 0) throw createError('工资批次参数无效');
  const params = { companyId, batchId: normalizedBatchId, reason, operatorId };
  const scope = projectScope(user, params, 'p');

  return db.transaction(async connection => {
    const [batchRows] = await connection.execute(
      `SELECT b.id,b.batch_status batchStatus,b.salary_month salaryMonth,b.project_id projectId
       FROM salary_batch b
       JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       WHERE b.company_id=:companyId AND b.id=:batchId ${scope}
       LIMIT 1 FOR UPDATE`,
      params
    );
    const batch = batchRows[0];
    if (!batch) throw createError('工资批次不存在或无项目权限', 404);
    if (Number(batch.batchStatus) !== 5) throw createError('仅已发放的工资条可以撤回');

    const [evidenceRows] = await connection.execute(
      `SELECT
         SUM(EXISTS(
           SELECT 1 FROM salary_receipt_log receipt_log
           WHERE receipt_log.company_id=d.company_id AND receipt_log.salary_detail_id=d.id
             AND receipt_log.employee_id=d.employee_id AND receipt_log.action_type='VIEW'
         )) viewCount,
         SUM(EXISTS(
           SELECT 1 FROM salary_signature signature
           WHERE signature.company_id=d.company_id AND signature.salary_detail_id=d.id
             AND signature.employee_id=d.employee_id AND signature.status=1
         )) signatureCount,
         SUM(d.receipt_status IN (2,3)) receiptCount,
         SUM(EXISTS(
           SELECT 1 FROM salary_dispute dispute
           WHERE dispute.company_id=d.company_id AND dispute.salary_detail_id=d.id
             AND dispute.employee_id=d.employee_id
         )) disputeCount
       FROM salary_detail d
       WHERE d.company_id=:companyId AND d.batch_id=:batchId`,
      params
    );
    const evidence = evidenceRows[0] || {};
    if (Number(evidence.viewCount || 0) > 0
      || Number(evidence.signatureCount || 0) > 0
      || Number(evidence.receiptCount || 0) > 0
      || Number(evidence.disputeCount || 0) > 0) {
      throw createError('已有员工查看、签名、签收或提交异议，不能撤回工资条', 409);
    }

    const [batchUpdate] = await connection.execute(
      `UPDATE salary_batch SET batch_status=4,paid_at=NULL,updated_at=NOW()
       WHERE company_id=:companyId AND id=:batchId AND batch_status=5`,
      params
    );
    if (!batchUpdate.affectedRows) throw createError('工资批次状态已变化，请刷新后重试', 409);
    await connection.execute(
      `UPDATE salary_detail SET receipt_status=0,receipt_at=NULL,updated_at=NOW()
       WHERE company_id=:companyId AND batch_id=:batchId AND receipt_status=1`,
      params
    );
    await connection.execute(
      `UPDATE sms_delivery_job
       SET error_summary=LEFT(CONCAT('工资条已撤回；原状态：',delivery_status,
             CASE WHEN error_summary IS NULL OR error_summary='' THEN '' ELSE CONCAT('；',error_summary) END),255),
           dedupe_key=CONCAT(LEFT(dedupe_key,145),':WITHDRAWN:',id),
           delivery_status='CANCELLED',updated_at=NOW()
       WHERE company_id=:companyId AND batch_id=:batchId AND delivery_status<>'CANCELLED'`,
      params
    );
    await connection.execute(
      `UPDATE wechat_official_notification_job
       SET error_summary=LEFT(CONCAT('工资条已撤回；原状态：',delivery_status,
             CASE WHEN error_summary IS NULL OR error_summary='' THEN '' ELSE CONCAT('；',error_summary) END),255),
           dedupe_key=CONCAT(LEFT(dedupe_key,145),':WITHDRAWN:',id),
           delivery_status='CANCELLED',updated_at=NOW()
       WHERE company_id=:companyId AND batch_id=:batchId
         AND delivery_status IN ('PENDING','SENDING')`,
      params
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,before_data,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'withdraw',
         JSON_OBJECT('status',5,'salaryMonth',:salaryMonth),
         JSON_OBJECT('status',4,'reason',:reason))`,
      { ...params, salaryMonth: batch.salaryMonth }
    );
    return { batchId: normalizedBatchId, batchStatus: 4, statusName: payrollBatchStatusName(4) };
  });
}

async function deletePayrollBatch(companyId, batchId, body = {}, operatorId, user) {
  if (body.confirmed !== true) throw createError('请确认删除工资批次');
  const reason = String(body.reason || '').trim();
  if (reason.length < 5 || reason.length > 200) throw createError('删除原因需填写5至200字');
  const normalizedBatchId = Number(batchId);
  if (!Number.isSafeInteger(normalizedBatchId) || normalizedBatchId <= 0) throw createError('工资批次参数无效');
  const params = { companyId, batchId: normalizedBatchId, reason, operatorId };
  const scope = projectScope(user, params, 'p');

  return db.transaction(async connection => {
    const [batchRows] = await connection.execute(
      `SELECT b.id,b.batch_status batchStatus,b.batch_no batchNo,b.salary_month salaryMonth,b.project_id projectId,
              b.source_type sourceType,b.calculation_run_id calculationRunId,
              EXISTS(
                SELECT 1 FROM wage_calculation_runs wage_run
                WHERE wage_run.company_id=b.company_id AND wage_run.salary_batch_id=b.id
              ) wageRunLinked
       FROM salary_batch b
       JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       WHERE b.company_id=:companyId AND b.id=:batchId ${scope}
       LIMIT 1 FOR UPDATE`,
      params
    );
    const batch = batchRows[0];
    if (!batch) throw createError('工资批次不存在或无项目权限', 404);
    if (![1, 4].includes(Number(batch.batchStatus))) {
      throw createError('仅已退回或已撤回的工资批次可以删除');
    }
    if (batch.sourceType === 'ATTENDANCE_AUTO'
      || Number(batch.calculationRunId || 0) > 0
      || Number(batch.wageRunLinked || 0) > 0) {
      throw createError('考勤自动算薪生成的工资批次不能删除，请在工资计算记录中处理', 409);
    }

    const [evidenceRows] = await connection.execute(
      `SELECT COUNT(d.id) detailCount,
         SUM(EXISTS(
           SELECT 1 FROM salary_receipt_log receipt_log
           WHERE receipt_log.company_id=d.company_id AND receipt_log.salary_detail_id=d.id
             AND receipt_log.employee_id=d.employee_id
         )) viewCount,
         SUM(EXISTS(
           SELECT 1 FROM salary_signature signature
           WHERE signature.company_id=d.company_id AND signature.salary_detail_id=d.id
             AND signature.employee_id=d.employee_id
         )) signatureCount,
         SUM(d.receipt_status IN (1,2,3)) receiptCount,
         SUM(EXISTS(
           SELECT 1 FROM salary_dispute dispute
           WHERE dispute.company_id=d.company_id AND dispute.salary_detail_id=d.id
             AND dispute.employee_id=d.employee_id
         )) disputeCount
       FROM salary_detail d
       WHERE d.company_id=:companyId AND d.batch_id=:batchId`,
      params
    );
    const evidence = evidenceRows[0] || {};
    if (Number(evidence.viewCount || 0) > 0
      || Number(evidence.signatureCount || 0) > 0
      || Number(evidence.receiptCount || 0) > 0
      || Number(evidence.disputeCount || 0) > 0) {
      throw createError('已有员工查看、签名、签收或提交异议，不能删除工资批次', 409);
    }

    await connection.execute(
      `UPDATE sms_delivery_job
       SET error_summary=CASE WHEN delivery_status IN ('PENDING','SENDING')
             THEN LEFT(CONCAT('工资批次已删除；',COALESCE(error_summary,'')),255) ELSE error_summary END,
           delivery_status=CASE WHEN delivery_status IN ('PENDING','SENDING') THEN 'CANCELLED' ELSE delivery_status END,
           batch_id=NULL,payslip_id=NULL,updated_at=NOW()
       WHERE company_id=:companyId AND batch_id=:batchId`,
      params
    );
    await connection.execute(
      `UPDATE wechat_official_notification_job
       SET error_summary=CASE WHEN delivery_status IN ('PENDING','SENDING')
             THEN LEFT(CONCAT('工资批次已删除；',COALESCE(error_summary,'')),255) ELSE error_summary END,
           delivery_status=CASE WHEN delivery_status IN ('PENDING','SENDING') THEN 'CANCELLED' ELSE delivery_status END,
           batch_id=NULL,payslip_id=NULL,updated_at=NOW()
       WHERE company_id=:companyId AND batch_id=:batchId`,
      params
    );
    await connection.execute(
      'DELETE FROM salary_detail WHERE company_id=:companyId AND batch_id=:batchId',
      params
    );
    const [batchDelete] = await connection.execute(
      'DELETE FROM salary_batch WHERE company_id=:companyId AND id=:batchId AND batch_status IN (1,4)',
      params
    );
    if (!batchDelete.affectedRows) throw createError('工资批次状态已变化，请刷新后重试', 409);
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,before_data,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'delete',
         JSON_OBJECT('batchNo',:batchNo,'salaryMonth',:salaryMonth,'projectId',:projectId,
           'status',:batchStatus,'employeeCount',:employeeCount),
         JSON_OBJECT('deleted',TRUE,'reason',:reason))`,
      {
        ...params,
        batchNo: batch.batchNo,
        salaryMonth: batch.salaryMonth,
        projectId: batch.projectId,
        batchStatus: Number(batch.batchStatus),
        employeeCount: Number(evidence.detailCount || 0)
      }
    );
    return { batchId: normalizedBatchId, deleted: true };
  });
}

async function getPayrollSmsSummary(companyId, batchId, user) {
  return smsDeliveryService.getBatchSummary({ companyId, batchId, user });
}

async function createPayrollSmsReminders(companyId, batchId, body, operatorId, user) {
  return smsDeliveryService.enqueueReminderJobs({
    companyId, batchId, operatorId, user, confirmed: body.confirmed
  });
}

async function retryPayrollSms(companyId, batchId, body, operatorId, user) {
  return smsDeliveryService.retryFailedJobs({
    companyId, batchId, operatorId, user, confirmed: body.confirmed
  });
}

async function submitPayrollBatch(companyId, batchId, operatorId, user) {
  const params = { companyId, batchId };
  const batch = await db.first(
    `SELECT b.id,b.batch_status FROM salary_batch b
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     WHERE b.company_id=:companyId AND b.id=:batchId ${projectScope(user, params, 'p')}`,
    params
  );
  if (!batch) throw createError('工资批次不存在或无项目权限', 403);
  if (Number(batch.batch_status) !== 1) throw createError('仅草稿工资批次可提交复核');
  const result = await db.query(
    'UPDATE salary_batch SET batch_status=3,updated_at=NOW() WHERE company_id=:companyId AND id=:batchId AND batch_status=1',
    { companyId, batchId }
  );
  if (!result.affectedRows) throw createError('工资批次状态已变化，请刷新后重试');
  await db.query(
    `INSERT INTO hr_operation_log
     (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
     VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'submit_review',JSON_OBJECT('status',3))`,
    { companyId, operatorId, batchId }
  );
  return { batchId };
}

async function reviewPayrollBatch(companyId, batchId, body, operatorId, user) {
  const approved = Number(body.approved) === 1 || body.approved === true;
  if (!approved && !String(body.remark || '').trim()) throw createError('退回工资批次时必须填写原因');
  const params = { companyId, batchId };
  return db.transaction(async connection => {
    const [[batch]] = await connection.execute(
      `SELECT b.id,b.project_id,b.batch_status,b.total_net,b.salary_month
       FROM salary_batch b
       JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
       WHERE b.company_id=:companyId AND b.id=:batchId ${projectScope(user, params, 'p')}
       LIMIT 1 FOR UPDATE`,
      params
    );
    if (!batch) throw createError('工资批次不存在或无项目权限', 403);
    if (Number(batch.batch_status) !== 3) throw createError('仅待复核工资批次可执行复核');
    if (approved) {
      if (Number(batch.total_net) <= 0) throw createError('实发工资合计必须大于0');
      const published = await finalizePayrollPublication(connection, {
        companyId,
        batchId,
        batch,
        operatorId,
        fromStatus: 3,
        actionType: 'review_publish'
      });
      return { ...published, batchStatus: 5, statusName: payrollBatchStatusName(5) };
    }

    const [result] = await connection.execute(
      'UPDATE salary_batch SET batch_status=1,updated_at=NOW() WHERE company_id=:companyId AND id=:batchId AND batch_status=3',
      { companyId, batchId }
    );
    if (!result.affectedRows) throw createError('工资批次状态已变化，请刷新后重试');
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'review_rejected',:afterData)`,
      {
      companyId,
      operatorId,
      batchId,
        afterData: JSON.stringify({ status: 1, remark: String(body.remark || '').trim() })
      }
    );
    return { batchId, batchStatus: 1, statusName: payrollBatchStatusName(1) };
  });
}

async function operationsHome(companyId, user) {
  const params = { companyId };
  const employeeFilter = (alias = 'e', jobAlias = 'j') => employeeScope(user, params, alias, jobAlias);
  const projectFilter = projectScope(user, params, 'home_project');
  const [workforce, talents, finance, pendingContracts, pendingInsurance, unsignedPayslips, activeProjects, onsiteEmployees, serviceRequests] = await Promise.all([
    db.first(`SELECT COUNT(*) total,
      SUM(employee_status = 6) interview,
      SUM(employee_status = 1) pending_arrival,
      SUM(employee_status = 2) active,
      SUM(employee_status = 5) not_joined,
      SUM(employee_status = 3) employee_left
      FROM hr_employee e
      LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
      WHERE e.company_id = :companyId AND e.deleted_at IS NULL ${employeeFilter('e', 'j')}`, params),
    db.first(`SELECT COUNT(*) total FROM talent_candidate t WHERE t.company_id = :companyId
      ${Number(user?.dataScope) === 1 ? '' : ' AND t.owner_user_id = :scopeUserId'}`, params),
    db.first(`SELECT
      COALESCE(SUM(CASE WHEN advance_status IN (4,5) THEN approved_amount ELSE 0 END),0) advance_paid,
      COALESCE(SUM(outstanding_amount),0) advance_outstanding
      FROM salary_advance a LEFT JOIN labor_project home_project ON home_project.id=a.project_id AND home_project.company_id=a.company_id
      WHERE a.company_id = :companyId ${projectFilter}`, params),
    db.first(`SELECT COUNT(*) total FROM hr_employee e
      LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
      WHERE e.company_id = :companyId AND e.employee_status = 2 AND e.deleted_at IS NULL
      AND e.lifecycle_status <> 'OFFBOARDING'
      AND NOT EXISTS (SELECT 1 FROM hr_labor_contract c WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1)
      ${employeeFilter('e', 'j')}`, params),
    db.first(`SELECT COUNT(*) total FROM hr_employee e
      LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
      WHERE e.company_id = :companyId AND e.employee_status = 2 AND e.deleted_at IS NULL
      AND e.lifecycle_status <> 'OFFBOARDING'
      AND NOT EXISTS (
        SELECT 1 FROM hr_social_security es
        WHERE es.id=(SELECT es2.id FROM hr_social_security es2 WHERE es2.company_id=e.company_id AND es2.employee_id=e.id ORDER BY es2.id DESC LIMIT 1)
          AND es.employer_insurance_status=1
          AND (es.employer_end_date IS NULL OR es.employer_end_date >= CURRENT_DATE())
      )
      ${employeeFilter('e', 'j')}`, params),
    db.first(`SELECT COUNT(*) total FROM salary_detail d JOIN salary_batch db_batch ON db_batch.id=d.batch_id AND db_batch.company_id=d.company_id
      LEFT JOIN labor_project d_project ON d_project.id=db_batch.project_id AND d_project.company_id=db_batch.company_id
      WHERE d.company_id = :companyId AND d.receipt_status IN (0,1) ${projectScope(user, params, 'd_project')}`, params),
    db.first(`SELECT COUNT(*) total FROM labor_project p WHERE p.company_id = :companyId AND p.status = 2 ${projectScope(user, params, 'p')}`, params),
    db.first(`SELECT COUNT(DISTINCT home_employee.id) total
      FROM hr_employee_job home_job
      JOIN hr_employee home_employee ON home_employee.id=home_job.employee_id AND home_employee.company_id=home_job.company_id
      JOIN labor_project p ON p.id=home_job.project_id AND p.company_id=home_job.company_id
      WHERE home_job.company_id = :companyId AND home_job.job_status = 1
        AND home_employee.employee_status = 2 AND home_employee.deleted_at IS NULL
        ${projectScope(user, params, 'p')}`, params),
    db.first(`SELECT
      SUM(r.status IN (0,1,2)) pending,
      SUM(r.status IN (1,2)) in_progress,
      SUM(r.status = 3) completed
      FROM client_service_request r LEFT JOIN labor_project p ON p.id=r.project_id AND p.company_id=r.company_id
      WHERE r.company_id = :companyId ${projectScope(user, params, 'p')}`, params)
  ]);
  const payroll = await db.first(`SELECT COALESCE(SUM(b.total_net),0) total FROM salary_batch b
    LEFT JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
    WHERE b.company_id = :companyId AND b.batch_status=5 ${projectScope(user, params, 'p')}`, params);
  const pendingAdvance = await db.first(`SELECT COUNT(*) total FROM salary_advance a
    LEFT JOIN labor_project p ON p.id=a.project_id AND p.company_id=a.company_id
    WHERE a.company_id = :companyId AND a.advance_status = 1 ${projectScope(user, params, 'p')}`, params);
  const taskParams = { companyId };
  const lifecycleTasks = await db.query(
    `SELECT t.task_type taskType,MAX(t.risk_level) riskLevel,COUNT(*) count
     FROM hr_work_task t
     LEFT JOIN hr_employee e ON e.id=t.employee_id AND e.company_id=t.company_id
     LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
     WHERE t.company_id=:companyId AND t.task_status IN (0,1) AND t.task_type<>'PAYROLL_SETTLEMENT'
       ${employeeScope(user, taskParams, 'e', 'j')}
     GROUP BY t.task_type ORDER BY MAX(t.risk_level) DESC,COUNT(*) DESC`,
    taskParams
  );
  const taskConfig = {
    ARRIVAL: ['待确认到岗', 'roster'],
    INSURANCE: ['到岗待增雇主险', 'roster'],
    DOCUMENT: ['员工资料待补', 'roster'],
    OFFBOARD: ['离职交接待办', 'roster'],
    INSURANCE_TERMINATION: ['离职待减雇主险', 'roster'],
    TRANSFER_ACCEPTANCE: ['跨项目转岗待接收', 'tasks']
  };
  const lifecycleTodos = lifecycleTasks
    .filter(item => !['CONTRACT', 'INSURANCE', 'ONBOARDING_COMPLIANCE'].includes(item.taskType))
    .filter(item => item.taskType !== 'INSURANCE_TERMINATION')
    .map(item => ({
    id: `lifecycle-${item.taskType}`,
    title: taskConfig[item.taskType]?.[0] || item.taskType,
    count: Number(item.count || 0),
    view: taskConfig[item.taskType]?.[1] || 'roster',
    tone: Number(item.riskLevel) === 3 ? 'red' : Number(item.riskLevel) === 2 ? 'amber' : 'blue'
    }));

  return {
    workforce: {
      total: Number(workforce.total || 0),
      interview: Number(workforce.interview || 0),
      pendingArrival: Number(workforce.pending_arrival || 0),
      active: Number(workforce.active || 0),
      notJoined: Number(workforce.not_joined || 0),
      left: Number(workforce.employee_left || 0),
      talents: Number(talents.total || 0)
    },
    finance: {
      advancePaid: Number(finance.advance_paid || 0),
      advanceOutstanding: Number(finance.advance_outstanding || 0),
      payrollNet: Number(payroll.total || 0)
    },
    delivery: {
      activeProjects: Number(activeProjects.total || 0),
      onsiteEmployees: Number(onsiteEmployees.total || 0),
      pendingServiceRequests: Number(serviceRequests.pending || 0),
      inProgressServiceRequests: Number(serviceRequests.in_progress || 0),
      completedServiceRequests: Number(serviceRequests.completed || 0)
    },
    compliance: {
      pendingContracts: Number(pendingContracts.total || 0),
      pendingInsurance: Number(pendingInsurance.total || 0),
      unsignedPayslips: Number(unsignedPayslips.total || 0)
    },
    todos: [
      ...lifecycleTodos,
      { id: 'advance', title: '预支待审批', count: Number(pendingAdvance.total || 0), view: 'advances', tone: 'amber' },
      { id: 'payslip', title: '工资条待签收', count: Number(unsignedPayslips.total || 0), view: 'payroll', tone: 'blue' }
    ].filter(item => item.count > 0)
  };
}

async function listNotices(companyId, user, query = {}) {
  return noticeService.listNotices(companyId, user, query.limit);
}

async function permissionOverview(companyId) {
  const [roles, users] = await Promise.all([
    db.query(`SELECT r.id, r.role_name roleName, r.role_code roleCode, r.data_scope dataScopeCode, r.status,
      COUNT(DISTINCT ur.user_id) userCount,
      GROUP_CONCAT(DISTINCT p.permission_name ORDER BY p.id SEPARATOR '、') permissionNames
      FROM sys_role r LEFT JOIN sys_user_role ur ON ur.role_id=r.id
      LEFT JOIN sys_role_permission rp ON rp.role_id=r.id LEFT JOIN sys_permission p ON p.id=rp.permission_id
      WHERE r.company_id = :companyId AND r.status=1 AND r.role_code IN (${MANAGED_ROLE_SQL})
      GROUP BY r.id ORDER BY r.id`, { companyId }),
    db.query(`SELECT u.id, u.username, u.real_name realName, u.phone, u.status,
      GROUP_CONCAT(DISTINCT r.role_name ORDER BY r.id SEPARATOR '、') roleNames,
      GROUP_CONCAT(DISTINCT p.project_name ORDER BY p.id SEPARATOR '、') projectNames
      FROM sys_user u LEFT JOIN sys_user_role ur ON ur.user_id = u.id
      LEFT JOIN sys_role r ON r.id = ur.role_id AND r.status=1 AND r.role_code IN (${MANAGED_ROLE_SQL})
      LEFT JOIN sys_user_project up ON up.user_id = u.id LEFT JOIN labor_project p ON p.id = up.project_id
      WHERE u.company_id = :companyId GROUP BY u.id ORDER BY u.id`, { companyId })
  ]);
  const scopeNames = { 1: '全公司', 2: '本部门及下级', 3: '本部门', 4: '本人', 5: '授权项目' };
  return {
    roles: roles.map(role => ({ ...role, dataScope: scopeNames[role.dataScopeCode] || '自定义', permissions: role.permissionNames ? role.permissionNames.split('、') : [] })),
    users: users.map(user => ({
      ...user, mobile: maskPhone(user.phone), orgName: '公司总部',
      roleName: user.roleNames || '未授权',
      projectNames: user.projectNames ? user.projectNames.split('、') : [], dataScope: user.roleNames || '未授权'
    }))
  };
}

async function createSystemUser(companyId, body) {
  return systemService.createUser(companyId, {
    ...body,
    phone: body.phone || body.mobile || null,
    roleIds: body.roleIds?.length ? body.roleIds : body.roleId ? [body.roleId] : []
  });
}

module.exports = {
  listCustomers, createCustomer, getCustomerDetail, updateCustomerPortfolio,
  listProjects, createProject, listFactoryStaff, createFactoryStaff,
  listBlacklist, createBlacklist, createBlacklistBatch, listAdvances, createAdvance, approveAdvance, payAdvance,
  payrollOverview, listPayrollDisputes, handlePayrollDispute, getPayrollBatchDetail, exportPayrollBatchCsv, exportPayrollReceiptPdf, previewPayrollBatch,
  createPayrollBatch, updatePayrollViewPolicy, normalizePayslipViewPolicy, submitPayrollBatch, reviewPayrollBatch, publishPayrollBatch, withdrawPayrollBatch, deletePayrollBatch,
  getPayrollSmsSummary, createPayrollSmsReminders, retryPayrollSms,
  operationsHome, listNotices, permissionOverview, createSystemUser
};
