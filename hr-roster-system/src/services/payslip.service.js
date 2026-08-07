const crypto = require('crypto');
const db = require('../db');
const env = require('../config/env');
const { createError } = require('../utils/response');

function employeeIdFromUser(user) {
  const employeeId = Number(user?.employeeId || 0);
  if (!employeeId) throw createError('当前账号未关联员工档案，无法查看工资条', 403);
  return employeeId;
}

async function assertActiveEmployee(companyId, employeeId, connection = db.pool) {
  const [[employee]] = await connection.execute(
    `SELECT id,name FROM hr_employee
     WHERE company_id=:companyId AND id=:employeeId AND employee_status=2 AND deleted_at IS NULL LIMIT 1`,
    { companyId, employeeId }
  );
  if (!employee) throw createError('员工已离职或档案已停用，无法继续访问工资条', 403);
  return employee;
}

function receiptStatusName(status) {
  return { 1: '待签收', 2: '已签收', 3: '已拒签' }[Number(status)] || '未发送';
}

function formatPayslip(row) {
  return {
    id: Number(row.id),
    salaryMonth: row.salaryMonth,
    batchNo: row.batchNo,
    projectName: row.projectName || '',
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
    receiptStatus: Number(row.receiptStatus || 0),
    receiptStatusName: receiptStatusName(row.receiptStatus),
    receiptAt: row.receiptAt || null,
    paidAt: row.paidAt || null
  };
}

const DETAIL_SELECT = `
  SELECT d.id,b.batch_no batchNo,b.salary_month salaryMonth,b.paid_at paidAt,p.project_name projectName,
         d.base_salary baseSalary,d.position_salary positionSalary,d.performance_salary performanceSalary,
         d.allowance_amount allowanceAmount,d.piece_amount pieceAmount,
         d.overtime_15_amount overtime15Amount,d.overtime_20_amount overtime20Amount,d.overtime_30_amount overtime30Amount,
         d.gross_amount grossAmount,d.social_deduction socialDeduction,d.tax_deduction taxDeduction,
         d.advance_deduction advanceDeduction,d.other_deduction otherDeduction,d.net_amount netAmount,
         d.receipt_status receiptStatus,d.receipt_at receiptAt
  FROM salary_detail d
  JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
  LEFT JOIN labor_project p ON p.id=b.project_id AND p.company_id=b.company_id
`;

async function listMyPayslips(companyId, user) {
  const employeeId = employeeIdFromUser(user);
  await assertActiveEmployee(companyId, employeeId);
  const rows = await db.query(
    `${DETAIL_SELECT}
     WHERE d.company_id=:companyId AND d.employee_id=:employeeId AND b.batch_status=5
       AND d.receipt_status IN (1,2,3)
     ORDER BY b.salary_month DESC,d.id DESC`,
    { companyId, employeeId }
  );
  return rows.map(formatPayslip);
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
         AND b.batch_status=5 AND d.receipt_status IN (1,2,3) LIMIT 1`,
      { companyId, payslipId, employeeId }
    );
    if (!row) throw createError('工资条不存在或无本人访问权限', 404);
    await insertReceiptLog(connection, {
      companyId,
      payslipId,
      employeeId,
      userId: Number(user.id),
      actionType: 'VIEW',
      resultStatus: Number(row.receiptStatus),
      ...requestMeta
    });
    return formatPayslip(row);
  });
}

async function receiptMyPayslip(companyId, payslipId, body, user, requestMeta = {}) {
  const employeeId = employeeIdFromUser(user);
  const action = String(body.action || '').toLowerCase();
  if (!['accept', 'reject'].includes(action)) throw createError('签收操作必须为 accept 或 reject');
  if (action === 'reject' && !String(body.note || '').trim()) throw createError('拒签时必须填写原因');
  const targetStatus = action === 'accept' ? 2 : 3;

  return db.transaction(async connection => {
    await assertActiveEmployee(companyId, employeeId, connection);
    const [[row]] = await connection.execute(
      `SELECT d.id,d.receipt_status receiptStatus
       FROM salary_detail d JOIN salary_batch b ON b.id=d.batch_id AND b.company_id=d.company_id
       WHERE d.company_id=:companyId AND d.id=:payslipId AND d.employee_id=:employeeId
         AND b.batch_status=5 AND d.receipt_status IN (1,2,3) LIMIT 1 FOR UPDATE`,
      { companyId, payslipId, employeeId }
    );
    if (!row) throw createError('工资条不存在或无本人访问权限', 404);
    if (Number(row.receiptStatus) !== 1 && Number(row.receiptStatus) !== targetStatus) {
      throw createError('工资条已完成签收，不能变更签收结果');
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

module.exports = { listMyPayslips, getMyPayslip, receiptMyPayslip };
