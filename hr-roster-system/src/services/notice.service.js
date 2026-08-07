const db = require('../db');
const { employeeScope, projectScope } = require('../utils/data-scope');
const { boundedLimit } = require('../utils/pagination');

// 业务通知必须与产生业务数据的事务共用 connection，避免业务成功但通知丢失。
async function createNotice(connection, notice) {
  const executor = connection || db.pool;
  const payload = {
    companyId: Number(notice.companyId),
    employeeId: notice.employeeId ? Number(notice.employeeId) : null,
    projectId: notice.projectId ? Number(notice.projectId) : null,
    title: String(notice.title || '').trim(),
    category: String(notice.category || '系统通知').trim(),
    noticeType: String(notice.noticeType || 'info').trim(),
    targetView: notice.targetView ? String(notice.targetView).trim() : null,
    dedupeKey: notice.dedupeKey ? String(notice.dedupeKey).trim() : null
  };
  if (!payload.title) return null;
  const [result] = await executor.execute(
    `INSERT INTO hr_system_notice
     (company_id,employee_id,project_id,title,category,notice_type,target_view,dedupe_key)
     VALUES (:companyId,:employeeId,:projectId,:title,:category,:noticeType,:targetView,:dedupeKey)
     ON DUPLICATE KEY UPDATE title=VALUES(title),category=VALUES(category),notice_type=VALUES(notice_type),target_view=VALUES(target_view)`,
    payload
  );
  return result.insertId || null;
}

function relativeTime(createdAt) {
  const value = new Date(String(createdAt || '').replace(' ', 'T'));
  if (Number.isNaN(value.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - value.getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  if (seconds < 172800) return '昨天';
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}天前`;
  return String(createdAt).slice(0, 10);
}

function formatNotice(row) {
  return {
    id: Number(row.id),
    title: row.title,
    category: row.category,
    noticeType: row.noticeType,
    targetView: row.targetView || '',
    createdAt: row.createdAt,
    time: relativeTime(row.createdAt)
  };
}

async function listNotices(companyId, user, limit = 20) {
  const safeLimit = boundedLimit(limit, 20, 50);
  const baseSelect = `SELECT n.id,n.title,n.category,n.notice_type noticeType,
    n.target_view targetView,n.created_at createdAt FROM hr_system_notice n`;

  if (!user || Number(user.dataScope) === 1) {
    const rows = await db.query(
      `${baseSelect} WHERE n.company_id=:companyId ORDER BY n.created_at DESC,n.id DESC LIMIT :safeLimit`,
      { companyId, safeLimit }
    );
    return rows.map(formatNotice);
  }

  const globalParams = { companyId, safeLimit };
  const employeeParams = { companyId, safeLimit };
  const projectParams = { companyId, safeLimit };
  const [globalRows, employeeRows, projectRows] = await Promise.all([
    db.query(
      `${baseSelect} WHERE n.company_id=:companyId AND n.employee_id IS NULL AND n.project_id IS NULL
       ORDER BY n.created_at DESC,n.id DESC LIMIT :safeLimit`,
      globalParams
    ),
    db.query(
      `${baseSelect}
       JOIN hr_employee e ON e.id=n.employee_id AND e.company_id=n.company_id
       LEFT JOIN hr_employee_job j ON j.id=(SELECT j2.id FROM hr_employee_job j2
         WHERE j2.company_id=e.company_id AND j2.employee_id=e.id ORDER BY j2.id DESC LIMIT 1)
       WHERE n.company_id=:companyId AND n.employee_id IS NOT NULL
       ${employeeScope(user, employeeParams, 'e', 'j')}
       ORDER BY n.created_at DESC,n.id DESC LIMIT :safeLimit`,
      employeeParams
    ),
    db.query(
      `${baseSelect}
       JOIN labor_project p ON p.id=n.project_id AND p.company_id=n.company_id
       WHERE n.company_id=:companyId AND n.employee_id IS NULL AND n.project_id IS NOT NULL
       ${projectScope(user, projectParams, 'p')}
       ORDER BY n.created_at DESC,n.id DESC LIMIT :safeLimit`,
      projectParams
    )
  ]);

  return [...globalRows, ...employeeRows, ...projectRows]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || Number(b.id) - Number(a.id))
    .slice(0, safeLimit)
    .map(formatNotice);
}

module.exports = { createNotice, listNotices, relativeTime };
