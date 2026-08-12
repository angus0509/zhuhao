const db = require('../db');
const { createError } = require('../utils/response');
const { encrypt, decrypt, sha256 } = require('../utils/crypto');
const { maskIdCard, maskPhone } = require('../utils/mask');
const { projectScope, customerScope, employeeScope } = require('../utils/data-scope');
const { paging } = require('../utils/pagination');
const { assertEmployeeScope } = require('./employee.service');
const systemService = require('./system.service');
const noticeService = require('./notice.service');

const MANAGED_ROLE_SQL = systemService.MANAGED_ROLE_CODES.map(code => `'${code}'`).join(',');

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

async function createCustomer(companyId, body, operatorId = 0) {
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
      const status = [1, 2, 3, 4].includes(Number(projectBody.status)) ? Number(projectBody.status) : 2;
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
            (SELECT COUNT(*) FROM factory_staff fs WHERE fs.project_id = p.id AND fs.onsite_status = 2) onsiteCount,
            (SELECT COUNT(DISTINCT fs.employee_id) FROM factory_staff fs
              WHERE fs.project_id = p.id AND fs.onsite_status = 2
              AND NOT EXISTS (SELECT 1 FROM hr_labor_contract lc WHERE lc.company_id=p.company_id AND lc.employee_id=fs.employee_id AND lc.sign_status=1)) unsignedContractCount,
            (SELECT COUNT(DISTINCT fs.employee_id) FROM factory_staff fs
              WHERE fs.project_id = p.id AND fs.onsite_status = 2
              AND NOT EXISTS (SELECT 1 FROM hr_social_security ss WHERE ss.company_id=p.company_id AND ss.employee_id=fs.employee_id
                AND ss.id=(SELECT MAX(ss2.id) FROM hr_social_security ss2 WHERE ss2.company_id=p.company_id AND ss2.employee_id=fs.employee_id)
                AND ss.employer_insurance_status=1)) uninsuredCount,
            (SELECT COUNT(DISTINCT ra.id) FROM factory_staff fs JOIN hr_risk_alert ra ON ra.employee_id=fs.employee_id AND ra.company_id=p.company_id
              WHERE fs.project_id=p.id AND fs.onsite_status=2 AND ra.handle_status IN (0,1)) openRiskCount,
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
      endDate: body.endDate || null, status: Number(body.status || 2)
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
  const params = { companyId, status: query.status ? Number(query.status) : null, pageSize, offset };
  const scopeFilter = employeeScope(user, params, 'e', 'j');
  const where = `a.company_id = :companyId AND (:status IS NULL OR a.advance_status = :status)${scopeFilter}`;
  const total = await db.first(`SELECT COUNT(*) total FROM salary_advance a
    JOIN hr_employee e ON e.id=a.employee_id AND e.company_id=a.company_id
    LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
    LEFT JOIN labor_project p ON p.id=a.project_id AND p.company_id=a.company_id
    WHERE ${where}`, params);
  const list = await db.query(
    `SELECT a.id, a.apply_no applyNo, a.employee_id employeeId, e.name employeeName, e.employee_no employeeNo,
            a.apply_amount applyAmount, a.approved_amount approvedAmount, a.apply_reason applyReason,
            a.advance_status advanceStatus, a.outstanding_amount outstandingAmount, a.created_at createdAt,
            a.paid_at paidAt, COALESCE(a.paid_at,a.created_at) advanceAt,
            CASE WHEN a.advance_status IN (4,5) THEN a.approved_amount ELSE 0 END paidAmount,
            creator.real_name recordedByName, creator.username recordedByUsername,
            c.customer_name customerName, p.project_name projectName
     FROM salary_advance a JOIN hr_employee e ON e.id = a.employee_id AND e.company_id=a.company_id
     LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
     LEFT JOIN crm_customer c ON c.id=j.customer_id AND c.company_id=e.company_id
     LEFT JOIN labor_project p ON p.id=a.project_id AND p.company_id=a.company_id
     LEFT JOIN sys_user creator ON creator.id=a.created_by AND (creator.company_id=a.company_id OR creator.company_id IS NULL)
     WHERE ${where}
     ORDER BY a.id DESC LIMIT :pageSize OFFSET :offset`, params
  );
  return { page, pageSize, total: Number(total.total), list };
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
       WHERE p.company_id=:companyId AND p.id=:projectId AND p.status IN (1,2) ${projectScope(user, projectParams, 'p')}`,
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

async function payrollOverview(companyId, user) {
  const params = { companyId };
  const projectFilter = projectScope(user, params, 'b_project');
  const summary = await db.first(
    `SELECT COUNT(*) batchCount, COALESCE(SUM(total_gross),0) totalGross,
            COALESCE(SUM(CASE WHEN batch_status=5 THEN total_net ELSE 0 END),0) totalNet
     FROM salary_batch b
     LEFT JOIN labor_project b_project ON b_project.id = b.project_id AND b_project.company_id = b.company_id
     WHERE b.company_id = :companyId ${projectFilter}`, params
  );
  const pendingReceipts = await db.first(
    `SELECT COUNT(*) total FROM salary_detail d
     JOIN salary_batch db_batch ON db_batch.id = d.batch_id AND db_batch.company_id = d.company_id
     LEFT JOIN labor_project d_project ON d_project.id = db_batch.project_id AND d_project.company_id = db_batch.company_id
     WHERE d.company_id = :companyId AND d.receipt_status = 1 ${projectScope(user, params, 'd_project')}`, params
  );
  const batches = await db.query(
    `SELECT b.id, b.batch_no batchNo, b.salary_month salaryMonth, b.payroll_type payrollType,
            b.batch_status batchStatus, b.total_gross grossTotal, b.total_net netTotal,
            p.project_name projectName, COUNT(d.id) employeeCount,
            COALESCE(SUM(d.advance_deduction),0) advanceDeduction,
            SUM(CASE WHEN d.receipt_status IN (0,1) THEN 1 ELSE 0 END) unsignedCount,
            b.created_at createdAt
     FROM salary_batch b
     LEFT JOIN labor_project p ON p.id = b.project_id AND p.company_id = b.company_id
     LEFT JOIN salary_detail d ON d.batch_id = b.id AND d.company_id = b.company_id
     WHERE b.company_id = :companyId ${projectScope(user, params, 'p')}
     GROUP BY b.id, p.project_name ORDER BY b.salary_month DESC, b.id DESC LIMIT 20`, params
  );
  const statusNames = { 1: '草稿', 2: '核算中', 3: '待复核', 4: '待发放', 5: '已发放', 6: '已归档' };
  return {
    ...summary,
    grossTotal: Number(summary.totalGross || 0),
    netTotal: Number(summary.totalNet || 0),
    unsignedTotal: Number(pendingReceipts.total),
    pendingReceiptCount: Number(pendingReceipts.total),
    batches: batches.map(item => ({
      ...item,
      employeeCount: Number(item.employeeCount || 0),
      unsignedCount: Number(item.unsignedCount || 0),
      status: Number(item.batchStatus) === 5 ? 'PUBLISHED' : `STATUS_${item.batchStatus}`,
      statusName: statusNames[item.batchStatus] || '未知'
    }))
  };
}

function payrollAmount(value, fieldName) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) throw createError(`${fieldName}必须为非负数字`);
  return Math.round(amount * 100) / 100;
}

async function createPayrollBatch(companyId, body, operatorId, user) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(body.salaryMonth || ''))) throw createError('工资月份格式应为 YYYY-MM');
  if (!body.projectId) throw createError('请选择所属项目');
  if (!Array.isArray(body.rows) || !body.rows.length) throw createError('请至少录入一名员工工资');
  if (body.rows.length > 500) throw createError('单个工资批次最多500人');

  const projectParams = { companyId, projectId: Number(body.projectId) };
  const project = await db.first(
    `SELECT p.id, p.customer_id customerId, p.project_name projectName
     FROM labor_project p
     WHERE p.company_id=:companyId AND p.id=:projectId AND p.status=1 ${projectScope(user, projectParams, 'p')}`,
    projectParams
  );
  if (!project) throw createError('项目不存在或无项目权限', 403);

  return db.transaction(async connection => {
    const [[existing]] = await connection.execute(
      `SELECT id FROM salary_batch
       WHERE company_id=:companyId AND project_id=:projectId AND salary_month=:salaryMonth AND batch_status<>6 LIMIT 1`,
      { companyId, projectId: project.id, salaryMonth: body.salaryMonth }
    );
    if (existing) throw createError('该项目本月已存在未归档工资批次');

    const batchNo = `GZ${String(body.salaryMonth).replace('-', '')}${String(Date.now()).slice(-8)}`;
    const [batchResult] = await connection.execute(
      `INSERT INTO salary_batch
       (company_id,project_id,batch_no,salary_month,payroll_type,batch_status,total_gross,total_net,created_by)
       VALUES (:companyId,:projectId,:batchNo,:salaryMonth,:payrollType,1,0,0,:operatorId)`,
      {
        companyId,
        projectId: project.id,
        batchNo,
        salaryMonth: body.salaryMonth,
        payrollType: Number(body.payrollType || 3),
        operatorId
      }
    );

    const seenEmployees = new Set();
    let totalGross = 0;
    let totalNet = 0;
    for (let index = 0; index < body.rows.length; index += 1) {
      const row = body.rows[index] || {};
      if (!row.employeeNo) throw createError(`第${index + 1}行员工工号不能为空`);
      const [[employee]] = await connection.execute(
        `SELECT e.id, e.name FROM hr_employee e
         JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
         WHERE e.company_id=:companyId AND e.employee_no=:employeeNo AND e.employee_status=2
           AND e.deleted_at IS NULL AND j.customer_id=:customerId AND j.project_id=:projectId LIMIT 1`,
        { companyId, employeeNo: String(row.employeeNo).trim(), customerId: project.customerId, projectId: project.id }
      );
      if (!employee) throw createError(`第${index + 1}行员工不存在、已离职或不属于该项目客户`);
      if (seenEmployees.has(employee.id)) throw createError(`第${index + 1}行员工重复`);
      seenEmployees.add(employee.id);

      const amounts = {
        baseSalary: payrollAmount(row.baseSalary, '基本工资'),
        positionSalary: payrollAmount(row.positionSalary, '岗位工资'),
        performanceSalary: payrollAmount(row.performanceSalary, '绩效工资'),
        allowanceAmount: payrollAmount(row.allowanceAmount, '补贴'),
        pieceAmount: payrollAmount(row.pieceAmount, '计件工资'),
        overtime15Amount: payrollAmount(row.overtime15Amount, '1.5倍加班费'),
        overtime20Amount: payrollAmount(row.overtime20Amount, '2倍加班费'),
        overtime30Amount: payrollAmount(row.overtime30Amount, '3倍加班费'),
        socialDeduction: payrollAmount(row.socialDeduction, '社保扣款'),
        taxDeduction: payrollAmount(row.taxDeduction, '个税扣款'),
        advanceDeduction: payrollAmount(row.advanceDeduction, '预支扣回'),
        otherDeduction: payrollAmount(row.otherDeduction, '其他扣款')
      };
      const gross = amounts.baseSalary + amounts.positionSalary + amounts.performanceSalary + amounts.allowanceAmount
        + amounts.pieceAmount + amounts.overtime15Amount + amounts.overtime20Amount + amounts.overtime30Amount;
      const deductions = amounts.socialDeduction + amounts.taxDeduction + amounts.advanceDeduction + amounts.otherDeduction;
      if (deductions > gross) throw createError(`第${index + 1}行扣款合计不能超过应发工资`);
      const net = Math.round((gross - deductions) * 100) / 100;
      totalGross += gross;
      totalNet += net;

      await connection.execute(
        `INSERT INTO salary_detail
         (company_id,batch_id,employee_id,base_salary,position_salary,performance_salary,allowance_amount,
          piece_amount,overtime_15_amount,overtime_20_amount,overtime_30_amount,gross_amount,
          social_deduction,tax_deduction,advance_deduction,other_deduction,net_amount,receipt_status)
         VALUES (:companyId,:batchId,:employeeId,:baseSalary,:positionSalary,:performanceSalary,:allowanceAmount,
          :pieceAmount,:overtime15Amount,:overtime20Amount,:overtime30Amount,:grossAmount,
          :socialDeduction,:taxDeduction,:advanceDeduction,:otherDeduction,:netAmount,0)`,
        {
          companyId,
          batchId: batchResult.insertId,
          employeeId: employee.id,
          ...amounts,
          grossAmount: Math.round(gross * 100) / 100,
          netAmount: net
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
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'create',:afterData)`,
      {
        companyId,
        operatorId,
        batchId: batchResult.insertId,
        afterData: JSON.stringify({ batchNo, salaryMonth: body.salaryMonth, projectId: project.id, employeeCount: seenEmployees.size })
      }
    );
    return { batchId: batchResult.insertId, batchNo, employeeCount: seenEmployees.size };
  });
}

async function publishPayrollBatch(companyId, batchId, operatorId, user) {
  const params = { companyId, batchId };
  const batch = await db.first(
    `SELECT b.id,b.project_id,b.batch_status,b.total_net,b.salary_month
     FROM salary_batch b JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     WHERE b.company_id=:companyId AND b.id=:batchId ${projectScope(user, params, 'p')}`,
    params
  );
  if (!batch) throw createError('工资批次不存在或无项目权限', 403);
  if (Number(batch.batch_status) !== 4) throw createError('工资批次必须复核通过并处于待发放状态后才能发布');
  if (Number(batch.total_net) <= 0) throw createError('实发工资合计必须大于0');

  return db.transaction(async connection => {
    const [updateResult] = await connection.execute(
      `UPDATE salary_batch SET batch_status=5,paid_at=NOW(),updated_at=NOW()
       WHERE company_id=:companyId AND id=:batchId AND batch_status=4`,
      { companyId, batchId }
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
       VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,'publish',JSON_OBJECT('status',5))`,
      { companyId, operatorId, batchId }
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
    return { batchId };
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
  const targetStatus = approved ? 4 : 1;
  if (!approved && !String(body.remark || '').trim()) throw createError('退回工资批次时必须填写原因');
  const params = { companyId, batchId };
  const batch = await db.first(
    `SELECT b.id,b.batch_status FROM salary_batch b
     JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
     WHERE b.company_id=:companyId AND b.id=:batchId ${projectScope(user, params, 'p')}`,
    params
  );
  if (!batch) throw createError('工资批次不存在或无项目权限', 403);
  if (Number(batch.batch_status) !== 3) throw createError('仅待复核工资批次可执行复核');
  const result = await db.query(
    'UPDATE salary_batch SET batch_status=:targetStatus,updated_at=NOW() WHERE company_id=:companyId AND id=:batchId AND batch_status=3',
    { companyId, batchId, targetStatus }
  );
  if (!result.affectedRows) throw createError('工资批次状态已变化，请刷新后重试');
  await db.query(
    `INSERT INTO hr_operation_log
     (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
     VALUES (:companyId,:operatorId,'工资管理','salary_batch',:batchId,:actionType,:afterData)`,
    {
      companyId,
      operatorId,
      batchId,
      actionType: approved ? 'review_approved' : 'review_rejected',
      afterData: JSON.stringify({ status: targetStatus, remark: String(body.remark || '').trim() })
    }
  );
  return { batchId, batchStatus: targetStatus };
}

async function operationsHome(companyId, user) {
  const params = { companyId };
  const employeeFilter = (alias = 'e', jobAlias = 'j') => employeeScope(user, params, alias, jobAlias);
  const projectFilter = projectScope(user, params, 'home_project');
  const [workforce, talents, finance, pendingContracts, pendingInsurance, unsignedPayslips, activeProjects, onsiteEmployees, serviceRequests] = await Promise.all([
    db.first(`SELECT COUNT(*) total,
      SUM(employee_status = 2) active,
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
    db.first(`SELECT COUNT(*) total FROM labor_project p WHERE p.company_id = :companyId AND p.status = 1 ${projectScope(user, params, 'p')}`, params),
    db.first(`SELECT COUNT(*) total FROM factory_staff fs JOIN labor_project p ON p.id=fs.project_id AND p.company_id=fs.company_id
      WHERE fs.company_id = :companyId AND fs.onsite_status = 2 ${projectScope(user, params, 'p')}`, params),
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
    CONTRACT: ['合同待签署', 'roster'],
    DOCUMENT: ['员工资料待补', 'roster'],
    OFFBOARD: ['离职交接待办', 'roster'],
    INSURANCE_TERMINATION: ['离职待减雇主险', 'roster'],
    TRANSFER_ACCEPTANCE: ['跨项目转岗待接收', 'tasks']
  };
  const lifecycleTodos = lifecycleTasks
    .filter(item => !['CONTRACT', 'INSURANCE'].includes(item.taskType))
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
      active: Number(workforce.active || 0),
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
      { id: 'contract', title: '员工合同待处理', count: Number(pendingContracts.total || 0), view: 'risk', tone: 'red' },
      { id: 'insurance', title: '雇主险待增保', count: Number(pendingInsurance.total || 0), view: 'roster', tone: 'red' },
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
  payrollOverview, createPayrollBatch, submitPayrollBatch, reviewPayrollBatch, publishPayrollBatch,
  operationsHome, listNotices, permissionOverview, createSystemUser
};
