const db = require('../db');
const { createError } = require('../utils/response');
const { label } = require('../utils/dictionaries');
const { employeeScope } = require('../utils/data-scope');
const { formatRisk, resolveDataScope, applyDataScope } = require('./employee.service');
const noticeService = require('./notice.service');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createRiskIfNotExists(connection, risk) {
  const [result] = await connection.execute(
    `
    INSERT IGNORE INTO hr_risk_alert
    (company_id, employee_id, risk_type, risk_level, risk_title, risk_desc, risk_key, handle_status)
    VALUES
    (:companyId, :employeeId, :riskType, :riskLevel, :riskTitle, :riskDesc, :riskKey, 0)
    `,
    risk
  );

  if (result.affectedRows > 0) {
    await noticeService.createNotice(connection, {
      companyId: risk.companyId,
      employeeId: risk.employeeId,
      title: risk.riskDesc || risk.riskTitle,
      category: '风险提醒',
      noticeType: Number(risk.riskLevel) === 3 ? 'risk' : 'warning',
      targetView: 'risk',
      dedupeKey: `risk:${risk.riskKey}`
    });
  }

  return result.affectedRows > 0 ? 1 : 0;
}

async function scanMissingContracts(connection, companyId) {
  const [employees] = await connection.execute(
    `
    SELECT e.id, e.name
    FROM hr_employee e
    WHERE e.company_id = :companyId
      AND e.employee_status = 2
      AND e.lifecycle_status <> 'OFFBOARDING'
      AND e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM hr_labor_contract c
        WHERE c.company_id = e.company_id
          AND c.employee_id = e.id
          AND c.sign_status = 1
      )
    `,
    { companyId }
  );

  let created = 0;
  for (const employee of employees) {
    created += await createRiskIfNotExists(connection, {
      companyId,
      employeeId: employee.id,
      riskType: 1,
      riskLevel: 3,
      riskTitle: '在职员工未签合同',
      riskDesc: `${employee.name}当前无有效已签劳动合同`,
      riskKey: `contract_missing:${employee.id}`
    });
  }
  return created;
}

async function scanContractExpire(connection, companyId) {
  const current = today();
  const after30Days = addDays(current, 30);
  const [contracts] = await connection.execute(
    `
    SELECT c.id, c.employee_id, c.contract_no, c.end_date, e.name
    FROM hr_labor_contract c
    JOIN hr_employee e ON e.id = c.employee_id AND e.company_id = c.company_id
    WHERE c.company_id = :companyId
      AND c.sign_status = 1
      AND c.end_date IS NOT NULL
      AND c.end_date <= :after30Days
      AND e.employee_status = 2
      AND e.deleted_at IS NULL
    `,
    { companyId, after30Days }
  );

  let created = 0;
  for (const contract of contracts) {
    const expired = contract.end_date < current;
    created += await createRiskIfNotExists(connection, {
      companyId,
      employeeId: contract.employee_id,
      riskType: 2,
      riskLevel: expired ? 3 : 2,
      riskTitle: expired ? '劳动合同已过期' : '劳动合同即将到期',
      riskDesc: `${contract.name}合同${contract.contract_no}结束日期为${contract.end_date}`,
      riskKey: `contract_expire:${contract.id}`
    });
  }
  return created;
}

async function scanCertificateExpire(connection, companyId) {
  const current = today();
  const after30Days = addDays(current, 30);
  const [certificates] = await connection.execute(
    `
    SELECT cert.id, cert.employee_id, cert.cert_type, cert.cert_no, cert.expire_date, e.name
    FROM hr_employee_certificate cert
    JOIN hr_employee e ON e.id = cert.employee_id AND e.company_id = cert.company_id
    WHERE cert.company_id = :companyId
      AND cert.expire_date IS NOT NULL
      AND cert.expire_date <= :after30Days
      AND e.employee_status = 2
      AND e.deleted_at IS NULL
    `,
    { companyId, after30Days }
  );

  const certTypeMap = { 1: '身份证', 2: '健康证', 3: '上岗证', 4: '特种作业证', 5: '学历证' };
  let created = 0;
  for (const cert of certificates) {
    const expired = cert.expire_date < current;
    created += await createRiskIfNotExists(connection, {
      companyId,
      employeeId: cert.employee_id,
      riskType: 4,
      riskLevel: expired ? 3 : 2,
      riskTitle: expired ? '员工证件已过期' : '员工证件即将过期',
      riskDesc: `${cert.name}${certTypeMap[cert.cert_type] || '证件'}到期日期为${cert.expire_date}`,
      riskKey: `cert_expire:${cert.id}`
    });
  }
  return created;
}

async function scanSpecialWorkCertificate(connection, companyId) {
  const current = today();
  const [employees] = await connection.execute(
    `
    SELECT e.id, e.name, p.position_name
    FROM hr_employee e
    JOIN hr_employee_job j ON j.employee_id = e.id AND j.company_id = e.company_id AND j.job_status = 1
    JOIN hr_position p ON p.id = j.position_id AND p.company_id = e.company_id
    WHERE e.company_id = :companyId
      AND e.employee_status = 2
      AND e.deleted_at IS NULL
      AND p.is_special_work = 1
      AND NOT EXISTS (
        SELECT 1 FROM hr_employee_certificate cert
        WHERE cert.company_id = e.company_id
          AND cert.employee_id = e.id
          AND cert.cert_type = 4
          AND cert.verify_status = 1
          AND (cert.expire_date IS NULL OR cert.expire_date >= :current)
      )
    `,
    { companyId, current }
  );

  let created = 0;
  for (const employee of employees) {
    created += await createRiskIfNotExists(connection, {
      companyId,
      employeeId: employee.id,
      riskType: 5,
      riskLevel: 3,
      riskTitle: '特殊工种证件缺失',
      riskDesc: `${employee.name}当前岗位为${employee.position_name}，但无有效特种作业证`,
      riskKey: `special_work_cert_missing:${employee.id}`
    });
  }
  return created;
}

async function scanEmployerInsurance(connection, companyId) {
  const current = today();
  const [employees] = await connection.execute(
    `SELECT e.id,e.name,s.id social_id,s.employer_insurance_status,s.employer_end_date
     FROM hr_employee e
     LEFT JOIN hr_social_security s ON s.id=(
       SELECT s2.id FROM hr_social_security s2
       WHERE s2.company_id=e.company_id AND s2.employee_id=e.id ORDER BY s2.id DESC LIMIT 1
     )
     WHERE e.company_id=:companyId AND e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
       AND (COALESCE(s.employer_insurance_status,0)<>1 OR (s.employer_end_date IS NOT NULL AND s.employer_end_date<:current))`,
    { companyId, current }
  );
  let created = 0;
  for (const employee of employees) {
    const missing = Number(employee.employer_insurance_status || 0) !== 1;
    const expired = !missing && employee.employer_end_date < current;
    created += await createRiskIfNotExists(connection, {
      companyId,
      employeeId: employee.id,
      riskType: 7,
      riskLevel: 3,
      riskTitle: missing ? '新员工雇主险未增保' : '员工雇主险已失效',
      riskDesc: missing
        ? `${employee.name}入职后尚未办理雇主险增保`
        : `${employee.name}雇主险已于${employee.employer_end_date}失效，请重新增保`,
      riskKey: `employer_insurance_missing:${employee.id}`
    });
  }
  return created;
}

async function scanRisks(companyId) {
  return db.transaction(async connection => {
    // 简化后的入职合规只保留未签劳动合同和未生效雇主险两项。
    await connection.execute(
      `UPDATE hr_risk_alert SET handle_status=2,handle_time=NOW(),handle_remark='已移出入职合规中心'
       WHERE company_id=:companyId AND risk_type NOT IN (1,7) AND handle_status IN (0,1)`,
      { companyId }
    );
    // 修复历史关联状态：实际已经签订合同或雇主险有效时，自动关闭遗留提醒。
    await connection.execute(
      `UPDATE hr_risk_alert r
       SET r.handle_status=2,r.handle_time=NOW(),r.handle_remark='系统核验：劳动合同已签订'
       WHERE r.company_id=:companyId AND r.risk_type=1 AND r.handle_status IN (0,1)
         AND EXISTS (SELECT 1 FROM hr_labor_contract c
           WHERE c.company_id=r.company_id AND c.employee_id=r.employee_id AND c.sign_status=1)`,
      { companyId }
    );
    // 若合同被撤销、雇主险减保或已经失效，重新打开此前系统办结的核心提醒。
    await connection.execute(
      `UPDATE hr_risk_alert r
       JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
       SET r.handle_status=0,r.handler_id=NULL,r.handle_time=NULL,r.handle_remark='系统复查：劳动合同当前未签订'
       WHERE r.company_id=:companyId AND r.risk_type=1 AND r.handle_status=2
         AND e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM hr_labor_contract c
           WHERE c.company_id=r.company_id AND c.employee_id=r.employee_id AND c.sign_status=1)`,
      { companyId }
    );
    await connection.execute(
      `UPDATE hr_risk_alert r
       JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
       SET r.handle_status=0,r.handler_id=NULL,r.handle_time=NULL,r.handle_remark='系统复查：雇主险当前未生效'
       WHERE r.company_id=:companyId AND r.risk_type=7 AND r.handle_status=2
         AND e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM hr_social_security s
           WHERE s.id=(SELECT s2.id FROM hr_social_security s2
             WHERE s2.company_id=r.company_id AND s2.employee_id=r.employee_id ORDER BY s2.id DESC LIMIT 1)
           AND s.employer_insurance_status=1
           AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()))`,
      { companyId }
    );
    await connection.execute(
      `UPDATE hr_risk_alert r
       SET r.handle_status=2,r.handle_time=NOW(),r.handle_remark='系统核验：雇主险保障中'
       WHERE r.company_id=:companyId AND r.risk_type=7 AND r.handle_status IN (0,1)
         AND EXISTS (SELECT 1 FROM hr_social_security s
           WHERE s.id=(SELECT s2.id FROM hr_social_security s2
             WHERE s2.company_id=r.company_id AND s2.employee_id=r.employee_id ORDER BY s2.id DESC LIMIT 1)
           AND s.employer_insurance_status=1
           AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()))`,
      { companyId }
    );
    let created = 0;
    created += await scanMissingContracts(connection, companyId);
    created += await scanEmployerInsurance(connection, companyId);
    return { created };
  });
}

async function listRisks(companyId, user = null) {
  const params = { companyId };
  const where = ['r.company_id = :companyId', 'r.risk_type IN (1,7)', 'e.employee_status = 2', "e.lifecycle_status <> 'OFFBOARDING'"];
  applyDataScope(where, params, await resolveDataScope(companyId, user));

  const rows = await db.query(
    `
    SELECT r.*, e.name AS employee_name, e.employee_no,j.hire_date,j.project_id project_id,
      cu.customer_name,lp.project_name,p.position_name,
      EXISTS(SELECT 1 FROM hr_labor_contract c
        WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1) AS contract_signed,
      EXISTS(SELECT 1 FROM hr_social_security s
        WHERE s.id=(SELECT s2.id FROM hr_social_security s2
          WHERE s2.company_id=e.company_id AND s2.employee_id=e.id ORDER BY s2.id DESC LIMIT 1)
        AND s.employer_insurance_status=1
        AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE())) AS employer_insurance_active
    FROM hr_risk_alert r
    JOIN hr_employee e ON e.id = r.employee_id AND e.company_id = r.company_id
    LEFT JOIN hr_employee_job j ON j.employee_id = e.id AND j.company_id = e.company_id AND j.job_status = 1
    LEFT JOIN crm_customer cu ON cu.id=j.customer_id AND cu.company_id=e.company_id
    LEFT JOIN labor_project lp ON lp.id=j.project_id AND lp.company_id=e.company_id
    LEFT JOIN hr_position p ON p.id=j.position_id AND p.company_id=e.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.handle_status ASC, r.risk_level DESC, r.id DESC
    `,
    params
  );
  return rows.map(row => ({
    ...formatRisk(row),
    hireDate: row.hire_date || '',
    contractSigned: Boolean(row.contract_signed),
    employerInsuranceActive: Boolean(row.employer_insurance_active)
  }));
}

async function assertRiskScope(companyId, riskId, user, connection = db.pool) {
  const params = { companyId, riskId };
  const scope = employeeScope(user, params, 'e', 'j');
  const [[risk]] = await connection.execute(
    `SELECT r.id FROM hr_risk_alert r
     JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
     LEFT JOIN hr_employee_job j ON j.employee_id=e.id AND j.company_id=e.company_id AND j.job_status=1
     WHERE r.company_id=:companyId AND r.id=:riskId ${scope} LIMIT 1`,
    params
  );
  if (!risk) throw createError('无权操作该项目风险', 403);
  return risk;
}

async function handleRisk(companyId, riskId, body, operatorId = 0, user = null) {
  const status = Number(body.handleStatus);
  if (![1, 2, 3].includes(status)) throw createError('处理状态不正确');

  await assertRiskScope(companyId, riskId, user);
  const result = await db.query(
    `
    UPDATE hr_risk_alert
    SET handle_status = :handleStatus,
        handler_id = :operatorId,
        handle_time = NOW(),
        handle_remark = :handleRemark,
        updated_at = NOW()
    WHERE company_id = :companyId AND id = :riskId
    `,
    {
      companyId,
      riskId,
      handleStatus: status,
      operatorId,
      handleRemark: body.handleRemark || ''
    }
  );

  if (result.affectedRows === 0) throw createError('风险不存在', 404);
  return { riskId };
}

const caseStatusNames = { 0: '待整改', 1: '整改中', 2: '待复核', 3: '已关闭' };

function formatRiskCase(row) {
  const deadline = row.deadline || '';
  return {
    id: row.id,
    sourceAlertId: row.source_alert_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || '',
    employeeNo: row.employee_no || '',
    customerName: row.customer_name || '',
    projectName: row.project_name || '',
    positionName: row.position_name || '',
    riskTitle: row.risk_title,
    riskDesc: row.risk_desc || '',
    riskLevel: row.risk_level,
    riskLevelName: label('riskLevel', row.risk_level),
    ownerName: row.owner_name,
    ownerDept: row.owner_dept || '',
    deadline,
    correctiveMeasure: row.corrective_measure,
    status: row.status,
    statusName: caseStatusNames[row.status] || '未知',
    evidenceNote: row.evidence_note || '',
    reviewNote: row.review_note || '',
    overdue: row.status !== 3 && deadline && deadline < today(),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateRiskCase(body, isUpdate = false) {
  if (!isUpdate && !Number(body.sourceAlertId)) throw createError('请选择风险预警');
  if (!String(body.ownerName || '').trim()) throw createError('责任人不能为空');
  if (!body.deadline) throw createError('整改期限不能为空');
  if (!String(body.correctiveMeasure || '').trim()) throw createError('整改措施不能为空');
  const status = Number(body.status || 0);
  if (![0, 1, 2, 3].includes(status)) throw createError('整改状态不正确');
  if (status >= 2 && !String(body.evidenceNote || '').trim()) throw createError('待复核或关闭时必须填写整改证据');
  if (status === 3 && !String(body.reviewNote || '').trim()) throw createError('关闭风险时必须填写复核结论');
  return status;
}

async function listRiskCases(companyId, user = null, statusText = '') {
  const params = { companyId };
  const where = ['c.company_id = :companyId'];
  const status = statusText === '' || statusText === undefined ? null : Number(statusText);
  if (status !== null) {
    if (![0, 1, 2, 3].includes(status)) throw createError('整改状态不正确');
    where.push('c.status = :status');
    params.status = status;
  }
  applyDataScope(where, params, await resolveDataScope(companyId, user));
  const rows = await db.query(
    `SELECT c.*, r.employee_id, r.risk_title, r.risk_desc, r.risk_level,
            e.name AS employee_name, e.employee_no,cu.customer_name,lp.project_name,p.position_name
     FROM hr_risk_case c
     JOIN hr_risk_alert r ON r.id = c.source_alert_id AND r.company_id = c.company_id
     JOIN hr_employee e ON e.id = r.employee_id AND e.company_id = r.company_id
     LEFT JOIN hr_employee_job j ON j.employee_id = e.id AND j.company_id = e.company_id AND j.job_status = 1
     LEFT JOIN crm_customer cu ON cu.id=j.customer_id AND cu.company_id=e.company_id
     LEFT JOIN labor_project lp ON lp.id=j.project_id AND lp.company_id=e.company_id
     LEFT JOIN hr_position p ON p.id=j.position_id AND p.company_id=e.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.status ASC, c.deadline ASC, c.id DESC`,
    params
  );
  return rows.map(formatRiskCase);
}

async function createRiskCase(companyId, body, operatorId = 0, user = null) {
  const status = validateRiskCase(body);
  await assertRiskScope(companyId, Number(body.sourceAlertId), user);
  return db.transaction(async connection => {
    const [[risk]] = await connection.execute(
      'SELECT id, handle_status FROM hr_risk_alert WHERE company_id = :companyId AND id = :riskId LIMIT 1 FOR UPDATE',
      { companyId, riskId: Number(body.sourceAlertId) }
    );
    if (!risk) throw createError('风险预警不存在', 404);
    if ([2, 3].includes(Number(risk.handle_status))) throw createError('该风险已处理，无需创建整改任务');
    const [[existing]] = await connection.execute(
      'SELECT id FROM hr_risk_case WHERE company_id = :companyId AND source_alert_id = :riskId AND status <> 3 LIMIT 1',
      { companyId, riskId: Number(body.sourceAlertId) }
    );
    if (existing) throw createError('该风险已存在未关闭的整改任务');
    const [result] = await connection.execute(
      `INSERT INTO hr_risk_case
       (company_id, source_alert_id, owner_name, owner_dept, deadline, corrective_measure, status, evidence_note, review_note, created_by)
       VALUES (:companyId, :sourceAlertId, :ownerName, :ownerDept, :deadline, :correctiveMeasure, :status, :evidenceNote, :reviewNote, :operatorId)`,
      {
        companyId,
        sourceAlertId: Number(body.sourceAlertId),
        ownerName: String(body.ownerName).trim(),
        ownerDept: String(body.ownerDept || '').trim() || null,
        deadline: body.deadline,
        correctiveMeasure: String(body.correctiveMeasure).trim(),
        status,
        evidenceNote: String(body.evidenceNote || '').trim() || null,
        reviewNote: String(body.reviewNote || '').trim() || null,
        operatorId
      }
    );
    await connection.execute(
      'UPDATE hr_risk_alert SET handle_status = 1, handler_id = :operatorId, updated_at = NOW() WHERE company_id = :companyId AND id = :riskId',
      { companyId, riskId: Number(body.sourceAlertId), operatorId }
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id, operator_id, module_name, biz_type, biz_id, action_type, after_data)
       VALUES (:companyId, :operatorId, '用工风险管理', 'risk_case', :caseId, 'create_case', :afterData)`,
      { companyId, operatorId, caseId: result.insertId, afterData: JSON.stringify({ sourceAlertId: Number(body.sourceAlertId), ownerName: body.ownerName, deadline: body.deadline }) }
    );
    return { caseId: result.insertId };
  });
}

async function updateRiskCase(companyId, caseId, body, operatorId = 0, user = null) {
  const caseRow = await db.first(
    `SELECT source_alert_id FROM hr_risk_case WHERE company_id=:companyId AND id=:caseId`,
    { companyId, caseId }
  );
  if (!caseRow) throw createError('整改任务不存在', 404);
  await assertRiskScope(companyId, Number(caseRow.source_alert_id), user);
  const status = validateRiskCase(body, true);
  return db.transaction(async connection => {
    const [[current]] = await connection.execute(
      'SELECT * FROM hr_risk_case WHERE company_id = :companyId AND id = :caseId LIMIT 1 FOR UPDATE',
      { companyId, caseId }
    );
    if (!current) throw createError('整改任务不存在', 404);
    await connection.execute(
      `UPDATE hr_risk_case SET owner_name=:ownerName, owner_dept=:ownerDept, deadline=:deadline,
       corrective_measure=:correctiveMeasure, status=:status, evidence_note=:evidenceNote,
       review_note=:reviewNote, reviewed_by=:reviewedBy, reviewed_at=:reviewedAt, updated_at=NOW()
       WHERE company_id=:companyId AND id=:caseId`,
      {
        companyId,
        caseId,
        ownerName: String(body.ownerName).trim(),
        ownerDept: String(body.ownerDept || '').trim() || null,
        deadline: body.deadline,
        correctiveMeasure: String(body.correctiveMeasure).trim(),
        status,
        evidenceNote: String(body.evidenceNote || '').trim() || null,
        reviewNote: String(body.reviewNote || '').trim() || null,
        reviewedBy: status === 3 ? operatorId : null,
        reviewedAt: status === 3 ? new Date() : null
      }
    );
    await connection.execute(
      `UPDATE hr_risk_alert SET handle_status=:handleStatus, handler_id=:operatorId,
       handle_time=:handleTime, handle_remark=:handleRemark, updated_at=NOW()
       WHERE company_id=:companyId AND id=:riskId`,
      {
        companyId,
        riskId: current.source_alert_id,
        handleStatus: status === 3 ? 2 : 1,
        operatorId,
        handleTime: status === 3 ? new Date() : null,
        handleRemark: status === 3 ? String(body.reviewNote).trim() : String(body.evidenceNote || '').trim()
      }
    );
    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id, operator_id, module_name, biz_type, biz_id, action_type, before_data, after_data)
       VALUES (:companyId, :operatorId, '用工风险管理', 'risk_case', :caseId, :actionType, :beforeData, :afterData)`,
      {
        companyId,
        operatorId,
        caseId,
        actionType: status === 3 ? 'close_case' : 'update_case',
        beforeData: JSON.stringify({ status: current.status, ownerName: current.owner_name, deadline: current.deadline }),
        afterData: JSON.stringify({ status, ownerName: body.ownerName, deadline: body.deadline })
      }
    );
    return { caseId };
  });
}

module.exports = {
  scanRisks,
  listRisks,
  handleRisk,
  listRiskCases,
  createRiskCase,
  updateRiskCase
};
