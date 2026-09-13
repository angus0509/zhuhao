const db = require('../db');
const { createError } = require('../utils/response');
const { verifyPassword, hashPassword } = require('../utils/password');
const { signToken } = require('../utils/token');

function effectiveDataScope(roles) {
  const scopes = new Set(roles.map(role => Number(role.data_scope)));
  if (scopes.has(1)) return 1;
  if (scopes.has(2)) return 2;
  if (scopes.has(3)) return 3;
  if (scopes.has(5)) return 5;
  if (scopes.has(4)) return 4;
  return 5;
}

// 员工新增、批量录入和编辑都需要先读取员工档案。
// 历史账号可能只配置了写权限，统一补齐 employee:view，但不改变 dataScope，
// 仍由员工/部门/项目范围继续限制实际可见数据。
function normalizePermissions(permissionCodes = []) {
  const permissions = new Set((Array.isArray(permissionCodes) ? permissionCodes : [])
    .map(code => String(code || '').trim())
    .filter(Boolean));
  if (['employee:create', 'employee:batch', 'employee:update', 'employee:sensitive:view']
    .some(code => permissions.has(code))) {
    permissions.add('employee:view');
  }
  return [...permissions].sort();
}

async function getScopeDeptIds(user, roles, dataScope) {
  if (![2, 3].includes(Number(dataScope))) return [];
  const roleIds = roles.filter(role => Number(role.data_scope) === Number(dataScope)).map(role => Number(role.id));
  const params = { companyId: Number(user.company_id), employeeId: Number(user.employee_id || 0) };
  let roots = [];
  if (roleIds.length) {
    const placeholders = roleIds.map((roleId, index) => {
      const key = `scopeRoleId${index}`;
      params[key] = roleId;
      return `:${key}`;
    });
    roots = await db.query(
      `SELECT DISTINCT d.id
       FROM sys_role_dept rd
       JOIN hr_department d ON d.id=rd.dept_id AND d.company_id=:companyId AND d.status=1
       WHERE rd.role_id IN (${placeholders.join(', ')})`,
      params
    );
  }
  if (!roots.length && params.employeeId) {
    roots = await db.query(
      `SELECT DISTINCT j.dept_id id FROM hr_employee_job j
       WHERE j.company_id=:companyId AND j.employee_id=:employeeId AND j.job_status=1`,
      params
    );
  }
  const rootIds = roots.map(row => Number(row.id)).filter(id => id > 0);
  if (!rootIds.length || Number(dataScope) === 3) return rootIds;
  const rootPlaceholders = rootIds.map((deptId, index) => {
    const key = `scopeRootDeptId${index}`;
    params[key] = deptId;
    return `:${key}`;
  });
  const rows = await db.query(
    `WITH RECURSIVE dept_tree AS (
       SELECT id FROM hr_department
       WHERE company_id=:companyId AND status=1 AND id IN (${rootPlaceholders.join(', ')})
       UNION ALL
       SELECT d.id FROM hr_department d
       JOIN dept_tree parent ON d.parent_id=parent.id
       WHERE d.company_id=:companyId AND d.status=1
     ) SELECT DISTINCT id FROM dept_tree`,
    params
  );
  return rows.map(row => Number(row.id));
}

async function getUserAccess(user) {
  const userId = Number(user.id);
  const roles = await db.query(
    `
    SELECT r.id, r.role_name, r.role_code, r.data_scope
    FROM sys_user_role ur
    JOIN sys_role r ON r.id = ur.role_id
    WHERE ur.user_id = :userId AND r.status = 1
    ORDER BY r.id
    `,
    { userId }
  );

  const permissions = roles.some(role => role.role_code === 'company_admin')
    ? await db.query(
      `SELECT permission_code FROM sys_permission WHERE status=1 ORDER BY permission_code`
    )
    : await db.query(
      `
      SELECT DISTINCT p.permission_code
      FROM sys_user_role ur
      JOIN sys_role_permission rp ON rp.role_id = ur.role_id
      JOIN sys_permission p ON p.id = rp.permission_id
      JOIN sys_role r ON r.id = ur.role_id
      WHERE ur.user_id = :userId
        AND r.status = 1
        AND p.status = 1
      ORDER BY p.permission_code
      `,
      { userId }
    );

  const dataScope = effectiveDataScope(roles);
  const scopeDeptIds = await getScopeDeptIds(user, roles, dataScope);

  return {
    roles: roles.map(role => ({
      id: role.id,
      roleName: role.role_name,
      roleCode: role.role_code,
      dataScope: role.data_scope
    })),
    permissions: normalizePermissions(permissions.map(item => item.permission_code)),
    dataScope,
    scopeDeptIds
  };
}

async function login({ companyId, username, password }) {
  if (!username || !password) throw createError('请输入账号和密码');

  const user = await db.first(
    `
    SELECT *
    FROM sys_user
    WHERE username = :username
      AND status = 1
      AND COALESCE(account_type,'MANAGER') = 'MANAGER'
      AND (company_id = :companyId OR company_id IS NULL)
    ORDER BY company_id DESC
    LIMIT 1
    `,
    { companyId, username }
  );

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw createError('账号或密码错误', 401);
  }

  return createSessionForUser(user, companyId);
}

async function createSessionForUser(user, fallbackCompanyId) {
  const access = await getUserAccess(user);
  const companyId = Number(user.company_id || user.companyId || fallbackCompanyId);
  const userId = Number(user.id || user.userId);
  const username = user.username;
  const employeeId = user.employee_id || user.employeeId || null;
  const accountType = user.account_type || user.accountType || 'MANAGER';
  const tokenVersion = Number(user.token_version ?? user.userTokenVersion ?? user.tokenVersion ?? 0);
  const token = signToken({
    userId,
    companyId,
    username,
    employeeId,
    accountType,
    tokenVersion
  });

  return {
    token,
    user: {
      id: userId,
      companyId,
      username,
      realName: user.real_name || user.realName || username,
      phone: user.phone || '',
      employeeId,
      accountType,
      roles: access.roles,
      permissions: access.permissions,
      dataScope: access.dataScope,
      scopeDeptIds: access.scopeDeptIds
    }
  };
}

async function getUserById(userId) {
  const user = await db.first(
    `SELECT u.*,e.employee_status,e.deleted_at employee_deleted_at
     FROM sys_user u
     LEFT JOIN hr_employee e ON e.id=u.employee_id AND e.company_id=u.company_id
     WHERE u.id=:userId AND u.status=1
       AND (
         COALESCE(u.account_type,'MANAGER')='MANAGER'
         OR (u.account_type='EMPLOYEE' AND e.employee_status IN (2,3) AND e.deleted_at IS NULL)
       )
     LIMIT 1`,
    { userId }
  );
  if (!user) return null;
  const accountType = user.account_type || 'MANAGER';
  // 即使数据库中残留旧角色关系，员工账号也固定为本人范围且不继承管理权限。
  if (accountType === 'EMPLOYEE'
    && (![2, 3].includes(Number(user.employee_status)) || user.employee_deleted_at)) return null;
  const access = accountType === 'EMPLOYEE'
    ? { roles: [], permissions: [], dataScope: 4, scopeDeptIds: [] }
    : await getUserAccess(user);
  return {
    id: user.id,
    companyId: user.company_id,
    username: user.username,
    realName: user.real_name || user.username,
    phone: user.phone || '',
    employeeId: user.employee_id || null,
    accountType: user.account_type || 'MANAGER',
    tokenVersion: Number(user.token_version || 0),
    roles: access.roles,
    permissions: access.permissions,
    dataScope: access.dataScope,
    scopeDeptIds: access.scopeDeptIds
  };
}

async function changePassword(companyId, userId, body) {
  if (!body.currentPassword || !body.newPassword || !body.confirmPassword) throw createError('请完整填写密码信息');
  if (body.newPassword !== body.confirmPassword) throw createError('两次输入的新密码不一致');
  if (String(body.newPassword).length < 8 || !/[A-Za-z]/.test(body.newPassword) || !/\d/.test(body.newPassword)) {
    throw createError('新密码至少8位且必须包含字母和数字');
  }
  const user = await db.first('SELECT id, password_hash FROM sys_user WHERE id=:userId AND company_id=:companyId AND status=1', { userId, companyId });
  if (!user || !verifyPassword(body.currentPassword, user.password_hash)) throw createError('当前密码错误');
  if (verifyPassword(body.newPassword, user.password_hash)) throw createError('新密码不能与当前密码相同');
  await db.query('UPDATE sys_user SET password_hash=:passwordHash, token_version=token_version+1, updated_at=NOW() WHERE id=:userId AND company_id=:companyId', {
    userId, companyId, passwordHash: hashPassword(body.newPassword)
  });
  await db.query(`INSERT INTO hr_operation_log
    (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
    VALUES (:companyId,:userId,'账号安全','user',:userId,'change_password',JSON_OBJECT('result','success'))`, { companyId, userId });
  return null;
}

module.exports = {
  login,
  createSessionForUser,
  getUserById,
  changePassword,
  normalizePermissions,
  effectiveDataScope
};
