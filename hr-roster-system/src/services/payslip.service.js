const crypto = require('crypto');
const db = require('../db');
const env = require('../config/env');
const { createError } = require('../utils/response');
const { paging } = require('../utils/pagination');
const { isSensitiveLabel } = require('./payroll-item-snapshot.service');

function employeeIdFromUser(user) {
  const employeeId = Number(user?.employeeId || 0);
  if (!employeeId) throw createError('当前账号未关联员工档案，无法查看工资条', 403);
  return employeeId;
}

async function assertActiveEmployee(companyId, employeeId, connection = db.pool) {
  const [[employee]] = await connection.execute(
    `SELECT id,name FROM hr_employee
     WHERE company_id=:companyId AND id=:employeeId AND employee_status IN (2,3) AND deleted_at IS NULL LIMIT 1`,
    { companyId, employeeId }
  );
  if (!employee) throw createError('员工档案已停用，无法继续访问工资条', 403);
  return employee;
}

function receiptStatusName(status) {
  return { 1: '待签收', 2: '已签收', 3: '已拒签' }[Number(status)] || '未发送';
}

function payslipDisplayStatus(row) {
  if (Number(row.openDisputeId || 0) > 0 || Number(row.receiptStatus) === 3) return '有异议';
  if (Number(row.receiptStatus) === 2) return '已签收';
  return Number(row.viewed || 0) === 1 ? '待签字' : '待查看';
}

function parseDynamicItems(value) {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_error) {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];
  const categories = new Set(['income', 'deduction', 'summary', 'display']);
  const monetary = new Set(['income', 'deduction', 'summary']);
  const seenSortOrders = new Set();
  return source.slice(0, 80).flatMap(item => {
    const label = String(item?.label || '').trim();
    const category = String(item?.category || '').trim();
    const sortOrder = Number(item?.sortOrder);
    if (!label || label.length > 50 || isSensitiveLabel(label) || !categories.has(category)) return [];
    if (!Number.isInteger(sortOrder) || sortOrder <= 0 || seenSortOrders.has(sortOrder)) return [];
    let itemValue;
    if (monetary.has(category)) {
      itemValue = Number(item?.value);
      if (!Number.isFinite(itemValue) || itemValue < 0) return [];
      itemValue = Math.round(itemValue * 100) / 100;
    } else {
      itemValue = String(item?.value == null ? '' : item.value);
      if (itemValue.trim().startsWith('=')) return [];
    }
    seenSortOrders.add(sortOrder);
    return [{ label, value: itemValue, category, sortOrder }];
  }).sort((left, right) => left.sortOrder - right.sortOrder);
}

function formatPayslip(row) {
  return {
    id: Number(row.id),
    salaryMonth: row.salaryMonth,
    batchNo: row.batchNo,
    projectName: row.projectName || '',
    deptName: row.deptName || '',
    baseSalary: Number(row.baseSalary || 0),
    positionSalary: Number(row.positionSalary || 0),
    performanceSalary: Number(row.performanceSalary || 0),
    allowanceAmount: Number(row.allowanceAmount || 0),
    pieceAmount: Number(row.pieceAmount || 0),
    overtime15Amount: Number(row.overtime15Amount || 0),
    overtime20Amount: Number(row.overtime20Amount || 0),
    overtime30Amount: Number(row.overtime30Amount || 0),
    grossAmount: Number(row.grossAmount || 0),
    socialDeduction: Number(row.socialDeduction || 0),
    taxDeduction: Number(row.taxDeduction || 0),
    advanceDeduction: Number(row.advanceDeduction || 0),
    otherDeduction: Number(row.otherDeduction || 0),
    netAmount: Number(row.netAmount || 0),
    items: parseDynamicItems(row.itemSnapshot),
    receiptStatus: Number(row.receiptStatus || 0),
    receiptStatusName: receiptStatusName(row.receiptStatus),
    displayStatus: payslipDisplayStatus(row),
    receiptAt: row.receiptAt || null,
    paidAt: row.paidAt || null,
    employeeViewEnabled: Number(row.employeeViewEnabled ?? 1),
    viewOnce: Number(row.viewOnce || 0),
    viewExpiresMinutes: row.viewExpiresMinutes == null ? null : Number(row.viewExpiresMinutes),
    firstViewedAt: row.firstViewedAt || null,
    activeSignature: Number(row.activeSignatureId || 0) > 0 ? {
      id: Number(row.activeSignatureId),
      signedName: row.signedName || '',
      signedAt: row.signedAt || null
    } : null,
    openDispute: Number(row.openDisputeId || 0) > 0 ? {
      id: Number(row.openDisputeId),
      reason: row.disputeReason || '',
      handleStatus: Number(row.disputeHandleStatus || 0),
      createdAt: row.disputeCreatedAt || null
    } : null
  };
}

const DETAIL_SELECT = `
  SELECT d.id,b.batch_no batchNo,b.salary_month salaryMonth,b.paid_at paidAt,p.project_name projectName,
         b.employee_view_enabled employeeViewEnabled,b.view_once viewOnce,b.view_expires_minutes viewExpiresMinutes,
         dept.dept_name deptName,
         d.base_salary baseSalary,d.position_salary positionSalary,d.performance_salary performanceSalary,
         d.allowance_amount allowanceAmount,d.piece_amount pieceAmount,
         d.overtime_15_amount overtime15Amount,d.overtime_20_amount overtime20Amount,d.overtime_30_amount overtime30Amount,
         d.gross_amount grossAmount,d.social_deduction socialDeduction,d.tax_deduction taxDeduction,
         d.advance_deduction advanceDeduction,d.other_deduction otherDeduction,d.net_amount netAmount,
         d.item_snapshot itemSnapshot,
         d.receipt_status receiptStatus,d.receipt_at receiptAt,
         (SELECT MAX(viewed_log_at.created_at) FROM salary_receipt_log viewed_log_at
          WHERE viewed_log_at.company_id=d.company_id AND viewed_log_at.salary_detail_id=d.id
            AND viewed_log_at.employee_id=d.employee_id AND viewed_log_at.action_type='VIEW') firstViewedAt,
         EXISTS(
           SELECT 1 FROM salary_receipt_log viewed_log
           WHERE viewed_log.company_id=d.company_id AND viewed_log.salary_detail_id=d.id
             AND viewed_log.employee_id=d.employee_id AND viewed_log.action_type='VIEW'
         ) viewed,
         signature.id activeSignatureId,signature.signed_name signedName,signature.signed_at signedAt,
         dispute.id openDisputeId,dispute.dispute_reason disputeReason,
         dispute.handle_status disputeHandleStatus,dispute.created_at disputeCreatedAt
  FROM salary_detail d
  JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
  LEFT JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
  LEFT JOIN hr_employee emp ON emp.id=d.employee_id AND emp.company_id=d.company_id
  LEFT JOIN hr_employee_job job ON job.employee_id=emp.id AND job.company_id=emp.company_id AND job.job_status=1
  LEFT JOIN hr_department dept ON dept.id=job.dept_id AND dept.company_id=emp.company_id
  LEFT JOIN salary_signature signature ON signature.company_id=d.company_id
    AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
  LEFT JOIN salary_dispute dispute ON dispute.company_id=d.company_id
    AND dispute.salary_detail_id=d.id AND dispute.employee_id=d.employee_id
    AND dispute.handle_status IN (0,1)
`;

function yearFilter(year, params) {
  const value = String(year || '').trim();
  if (!/^\d{4}$/.test(value)) return '';
  params.yearStart = `${value}-01`;
  params.yearEnd = `${value}-12`;
  return ' AND b.salary_month BETWEEN :yearStart AND :yearEnd';
}

function payslipListFilter(query, params) {
  const month = String(query.month || '').trim();
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw createError('工资月份格式不正确');
    params.salaryMonth = month;
    return ' AND b.salary_month=:salaryMonth';
  }
  return yearFilter(query.year, params);
}

async function listMyPayslips(companyId, user, query = {}) {
  const employeeId = employeeIdFromUser(user);
  await assertActiveEmployee(companyId, employeeId);
  const { page, pageSize, offset } = paging(query, { defaultPageSize: 20, maxPageSize: 50 });
  const countParams = { companyId, employeeId };
  const filter = payslipListFilter(query, countParams);
  const totalRow = await db.first(
    `SELECT COUNT(*) total
     FROM salary_detail d
     JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       WHERE d.company_id=:companyId AND d.employee_id=:employeeId AND b.batch_status=5
       AND b.employee_view_enabled=1 AND d.receipt_status IN (1,2,3)
       AND (b.view_once=0 OR NOT EXISTS (SELECT 1 FROM salary_receipt_log once_log WHERE once_log.company_id=d.company_id AND once_log.salary_detail_id=d.id AND once_log.employee_id=d.employee_id AND once_log.action_type='VIEW'))
       AND (b.view_expires_minutes IS NULL OR NOT EXISTS (SELECT 1 FROM salary_receipt_log expiry_log WHERE expiry_log.company_id=d.company_id AND expiry_log.salary_detail_id=d.id AND expiry_log.employee_id=d.employee_id AND expiry_log.action_type='VIEW' AND TIMESTAMPADD(MINUTE,b.view_expires_minutes,expiry_log.created_at) <= NOW()))${filter}`,
    countParams
  );
  const params = { ...countParams, pageSize, offset };
  const rows = await db.query(
    `${DETAIL_SELECT}
     WHERE d.company_id=:companyId AND d.employee_id=:employeeId AND b.batch_status=5
       AND b.employee_view_enabled=1 AND d.receipt_status IN (1,2,3)
       AND (b.view_once=0 OR NOT EXISTS (SELECT 1 FROM salary_receipt_log once_log WHERE once_log.company_id=d.company_id AND once_log.salary_detail_id=d.id AND once_log.employee_id=d.employee_id AND once_log.action_type='VIEW'))
       AND (b.view_expires_minutes IS NULL OR NOT EXISTS (SELECT 1 FROM salary_receipt_log expiry_log WHERE expiry_log.company_id=d.company_id AND expiry_log.salary_detail_id=d.id AND expiry_log.employee_id=d.employee_id AND expiry_log.action_type='VIEW' AND TIMESTAMPADD(MINUTE,b.view_expires_minutes,expiry_log.created_at) <= NOW()))${filter}
     ORDER BY b.salary_month DESC,d.id DESC
     LIMIT :pageSize OFFSET :offset`,
    params
  );
  return {
    page,
    pageSize,
    total: Number(totalRow?.total || 0),
    list: rows.map(formatPayslip)
  };
}

function evidenceHash({ companyId, payslipId, employeeId, userId, actionType, resultStatus, eventAt }) {
  return crypto.createHmac('sha256', env.auth.jwtSecret)
    .update([companyId, payslipId, employeeId, userId, actionType, resultStatus, eventAt.toISOString()].join('|'))
    .digest('hex');
}

async function insertReceiptLog(connection, context) {
  const eventAt = new Date();
  const hash = evidenceHash({ ...context, eventAt });
  await connection.execute(
    `INSERT INTO salary_receipt_log
     (company_id,salary_detail_id,employee_id,user_id,action_type,result_status,ip_address,user_agent,evidence_hash,created_at)
     VALUES (:companyId,:payslipId,:employeeId,:userId,:actionType,:resultStatus,:ipAddress,:userAgent,:evidenceHash,:eventAt)`,
    {
      ...context,
      ipAddress: String(context.ipAddress || '').slice(0, 50) || null,
      userAgent: String(context.userAgent || '').slice(0, 255) || null,
      evidenceHash: hash,
      eventAt
    }
  );
}

async function getMyPayslip(companyId, payslipId, user, requestMeta = {}) {
  const employeeId = employeeIdFromUser(user);
  return db.transaction(async connection => {
    await assertActiveEmployee(companyId, employeeId, connection);
    const [[row]] = await connection.execute(
      `${DETAIL_SELECT}
       WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
         AND b.batch_status=5 AND d.receipt_status IN (1,2,3) LIMIT 1 FOR UPDATE`,
      { companyId, payslipId, employeeId }
    );
    if (!row) throw createError('工资条不存在或无本人访问权限', 404);
    if (Number(row.employeeViewEnabled ?? 1) !== 1) throw createError('当前工资条暂未开放员工查看', 403);
    if (Number(row.viewOnce) === 1 && Number(row.viewed || 0) === 1) {
      throw createError('该工资条已阅后失效，如有疑问请联系薪资专员', 410);
    }
    if (row.viewExpiresMinutes != null && row.firstViewedAt) {
      const expiresAt = new Date(row.firstViewedAt).getTime() + Number(row.viewExpiresMinutes) * 60000;
      if (Date.now() >= expiresAt) throw createError('该工资条已超过有效查看时间，如有疑问请联系薪资专员', 410);
    }
    await insertReceiptLog(connection, {
      companyId,
      payslipId,
      employeeId,
      userId: Number(user.id),
      actionType: 'VIEW',
      resultStatus: Number(row.receiptStatus),
      ...requestMeta
    });
    return formatPayslip({ ...row, viewed: 1 });
  });
}

async function receiptMyPayslip(companyId, payslipId, body, user, requestMeta = {}) {
  const employeeId = employeeIdFromUser(user);
  const action = String(body.action || '').toLowerCase();
  if (!['accept', 'reject'].includes(action)) throw createError('签收操作必须为 accept 或 reject');
  if (action === 'reject' && !String(body.note || '').trim()) throw createError('拒签时必须填写原因');
  const signatureId = Number(body.signatureId || 0);
  if (action === 'accept' && body.confirmed !== true) throw createError('请先确认本人已核对工资条内容');
  if (action === 'accept' && (!Number.isSafeInteger(signatureId) || signatureId <= 0)) {
    throw createError('请先完成手写签名');
  }
  const targetStatus = action === 'accept' ? 2 : 3;

  return db.transaction(async connection => {
    await assertActiveEmployee(companyId, employeeId, connection);
    const [[row]] = await connection.execute(
      `SELECT d.id,d.receipt_status receiptStatus,signature.id signatureId
       FROM salary_detail d JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       LEFT JOIN salary_signature signature ON signature.id=:signatureId
         AND signature.company_id=d.company_id AND signature.salary_detail_id=d.id
         AND signature.employee_id=d.employee_id AND signature.status=1
       WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
         AND b.batch_status=5 AND d.receipt_status IN (1,2,3) LIMIT 1 FOR UPDATE`,
      { companyId, payslipId, employeeId, signatureId }
    );
    if (!row) throw createError('工资条不存在或无本人访问权限', 404);
    if (Number(row.receiptStatus) !== 1 && Number(row.receiptStatus) !== targetStatus) {
      throw createError('工资条已完成签收，不能变更签收结果');
    }
    if (Number(row.receiptStatus) === targetStatus) {
      return { payslipId, receiptStatus: targetStatus, receiptStatusName: receiptStatusName(targetStatus) };
    }
    if (action === 'accept' && Number(row.signatureId || 0) !== signatureId) {
      throw createError('手写签名不属于当前工资条或员工本人', 403);
    }
    if (Number(row.receiptStatus) === 1) {
      await connection.execute(
        `UPDATE salary_detail SET receipt_status=:targetStatus,receipt_at=NOW(),updated_at=NOW()
         WHERE company_id=:companyId AND id=:payslipId AND employee_id=:employeeId AND receipt_status=1`,
        { companyId, payslipId, employeeId, targetStatus }
      );
      await insertReceiptLog(connection, {
        companyId,
        payslipId,
        employeeId,
        userId: Number(user.id),
        actionType: action === 'accept' ? 'ACCEPT' : 'REJECT',
        resultStatus: targetStatus,
        ...requestMeta
      });
    }
    return { payslipId, receiptStatus: targetStatus, receiptStatusName: receiptStatusName(targetStatus) };
  });
}

async function disputeMyPayslip(companyId, payslipId, body, user, requestMeta = {}) {
  const employeeId = employeeIdFromUser(user);
  const reason = String(body.reason || '').trim();
  if (reason.length < 10 || reason.length > 500) throw createError('工资异议原因需填写10至500字');

  return db.transaction(async connection => {
    await assertActiveEmployee(companyId, employeeId, connection);
    const [[row]] = await connection.execute(
      `SELECT d.id,d.receipt_status receiptStatus,signature.id activeSignatureId,
              dispute.id openDisputeId,dispute.dispute_reason existingReason
       FROM salary_detail d
       JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id AND b.batch_status=5
       LEFT JOIN salary_signature signature ON signature.company_id=d.company_id
         AND signature.salary_detail_id=d.id AND signature.employee_id=d.employee_id AND signature.status=1
       LEFT JOIN salary_dispute dispute ON dispute.company_id=d.company_id
         AND dispute.salary_detail_id=d.id AND dispute.employee_id=d.employee_id
         AND dispute.handle_status IN (0,1)
       WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
         AND d.receipt_status IN (1,2,3) LIMIT 1 FOR UPDATE`,
      { companyId, payslipId, employeeId }
    );
    if (!row) throw createError('工资条不存在或无本人访问权限', 404);
    if (Number(row.receiptStatus) === 2 || Number(row.activeSignatureId || 0) > 0) {
      throw createError('工资条已签收，不能再提交异议');
    }
    if (Number(row.openDisputeId || 0) > 0) {
      if (String(row.existingReason || '').trim() === reason) {
        return {
          disputeId: Number(row.openDisputeId),
          handleStatus: 0,
          handleStatusName: '待处理'
        };
      }
      throw createError('该工资条已有待处理异议');
    }

    const [insertResult] = await connection.execute(
      `INSERT INTO salary_dispute
       (company_id,salary_detail_id,employee_id,dispute_reason,handle_status)
       VALUES (:companyId,:payslipId,:employeeId,:reason,0)`,
      { companyId, payslipId, employeeId, reason }
    );
    if (Number(row.receiptStatus) !== 3) {
      await connection.execute(
        `UPDATE salary_detail SET receipt_status=3,receipt_at=NOW(),updated_at=NOW()
         WHERE company_id=:companyId AND id=:payslipId AND employee_id=:employeeId
           AND receipt_status=1`,
        { companyId, payslipId, employeeId }
      );
    }
    await insertReceiptLog(connection, {
      companyId,
      payslipId,
      employeeId,
      userId: Number(user.id),
      actionType: 'DISPUTE',
      resultStatus: 3,
      ...requestMeta
    });
    return {
      disputeId: Number(insertResult.insertId),
      handleStatus: 0,
      handleStatusName: '待处理'
    };
  });
}

module.exports = {
  listMyPayslips,
  getMyPayslip,
  receiptMyPayslip,
  disputeMyPayslip,
  _testing: { parseDynamicItems }
};
