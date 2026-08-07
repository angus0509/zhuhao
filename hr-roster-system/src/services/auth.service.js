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

  const permissions = await db.query(
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
    permissions: permissions.map(item => item.permission_code),
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
      AND (company_id = :companyId OR company_id IS NULL)
    ORDER BY company_id DESC
    LIMIT 1
    `,
    { companyId, username }
  );

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw createError('账号或密码错误', 401);
  }

  const access = await getUserAccess(user);
  const token = signToken({
    userId: user.id,
    companyId: user.company_id || companyId,
    username: user.username,
    employeeId: user.employee_id || null,
    tokenVersion: Number(user.token_version || 0)
  });

  return {
    token,
    user: {
      id: user.id,
      companyId: user.company_id || companyId,
      username: user.username,
      realName: user.real_name || user.username,
      phone: user.phone || '',
      employeeId: user.employee_id || null,
      roles: access.roles,
      permissions: access.permissions,
      dataScope: access.dataScope,
      scopeDeptIds: access.scopeDeptIds
    }
  };
}

async function getUserById(userId) {
  const user = await db.first('SELECT * FROM sys_user WHERE id = :userId AND status = 1 LIMIT 1', { userId });
  if (!user) return null;
  const access = await getUserAccess(user);
  return {
    id: user.id,
    companyId: user.company_id,
    username: user.username,
    realName: user.real_name || user.username,
    phone: user.phone || '',
    employeeId: user.employee_id || null,
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
  getUserById,
  changePassword
};
