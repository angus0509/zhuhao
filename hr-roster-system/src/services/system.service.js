const db = require('../db');
const { createError } = require('../utils/response');
const { hashPassword } = require('../utils/password');
const { maskPhone } = require('../utils/mask');

const SCOPE_NAMES = { 1: '全公司', 2: '本部门及下级', 3: '本部门', 4: '本人', 5: '授权项目' };
const MANAGED_ROLE_CODES = Object.freeze(['company_admin', 'hr_manager', 'onsite_staff', 'payroll_staff']);
const MANAGED_ROLE_SQL = MANAGED_ROLE_CODES.map(code => `'${code}'`).join(',');

function expandPermissionIds(permissionRows, selectedIds) {
  const permissionMap = new Map(permissionRows.map(item => [Number(item.id), Number(item.parentId || 0)]));
  const expanded = new Set(selectedIds.map(Number).filter(id => permissionMap.has(id)));
  for (const selectedId of [...expanded]) {
    let parentId = permissionMap.get(selectedId) || 0;
    while (parentId && permissionMap.has(parentId)) {
      expanded.add(parentId);
      parentId = permissionMap.get(parentId) || 0;
    }
  }
  return [...expanded];
}

// ============================================================
// 用户管理
// ============================================================

async function listUsers(companyId) {
  const users = await db.query(
    `SELECT u.id, u.username, u.real_name realName, u.phone, u.status, u.employee_id employeeId,
            u.created_at createdAt
     FROM sys_user u
     WHERE u.company_id = :companyId
     ORDER BY u.id`,
    { companyId }
  );

  if (!users.length) return [];

  const userIds = users.map(u => u.id);

  // 查角色
  const roleRows = await db.query(
    `SELECT ur.user_id userId, r.id roleId, r.role_name roleName, r.role_code roleCode, r.data_scope dataScope
     FROM sys_user_role ur
     JOIN sys_role r ON r.id = ur.role_id AND r.status = 1 AND r.role_code IN (${MANAGED_ROLE_SQL})
     WHERE ur.user_id IN (${userIds.map((_, i) => `:uid${i}`).join(',')})`,
    Object.fromEntries(userIds.map((id, i) => [`uid${i}`, id]))
  );

  // 查部门授权（通过角色的 sys_role_dept）
  const deptRows = await db.query(
    `SELECT DISTINCT rd.role_id roleId, rd.dept_id deptId, d.dept_name deptName
     FROM sys_role_dept rd
     JOIN hr_department d ON d.id = rd.dept_id AND d.status = 1
     WHERE rd.role_id IN (SELECT role_id FROM sys_user_role WHERE user_id IN (${userIds.map((_, i) => `:uid${i}`).join(',')}))`,
    Object.fromEntries(userIds.map((id, i) => [`uid${i}`, id]))
  );

  // 查项目授权
  const projRows = await db.query(
    `SELECT up.user_id userId, p.id projectId, p.project_name projectName
     FROM sys_user_project up
     JOIN labor_project p ON p.id = up.project_id
     WHERE up.user_id IN (${userIds.map((_, i) => `:uid${i}`).join(',')})`,
    Object.fromEntries(userIds.map((id, i) => [`uid${i}`, id]))
  );

  // 组装
  return users.map(user => {
    const roles = roleRows.filter(r => r.userId === user.id);
    const roleIds = roles.map(r => r.roleId);
    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      mobile: maskPhone(user.phone),
      status: user.status,
      employeeId: user.employeeId,
      createdAt: user.createdAt,
      roles: roles.map(r => ({
        id: r.roleId,
        roleName: r.roleName,
        roleCode: r.roleCode,
        dataScope: r.dataScope,
        dataScopeName: SCOPE_NAMES[r.dataScope] || '自定义'
      })),
      departments: deptRows.filter(d => roleIds.includes(d.roleId)).map(d => ({
        id: d.deptId,
        deptName: d.deptName
      })),
      projects: projRows.filter(p => p.userId === user.id).map(p => ({
        id: p.projectId,
        projectName: p.projectName
      }))
    };
  });
}

async function getUserDetail(companyId, userId) {
  const user = await db.first(
    `SELECT id, username, real_name realName, phone, status, employee_id employeeId
     FROM sys_user WHERE id = :userId AND company_id = :companyId`,
    { userId, companyId }
  );
  if (!user) throw createError('用户不存在', 404);

  const roles = await db.query(
    `SELECT r.id, r.role_name roleName, r.role_code roleCode, r.data_scope dataScope
     FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id AND r.status = 1 AND r.role_code IN (${MANAGED_ROLE_SQL})
     WHERE ur.user_id = :userId`,
    { userId }
  );

  const roleIds = roles.map(r => r.id);
  let departments = [];
  if (roleIds.length) {
    const deptRows = await db.query(
      `SELECT DISTINCT d.id, d.dept_name deptName
       FROM sys_role_dept rd JOIN hr_department d ON d.id = rd.dept_id
       WHERE rd.role_id IN (${roleIds.map((_, i) => `:rid${i}`).join(',')}) AND d.status = 1`,
      Object.fromEntries(roleIds.map((id, i) => [`rid${i}`, id]))
    );
    departments = deptRows;
  }

  const projects = await db.query(
    `SELECT p.id, p.project_name projectName
     FROM sys_user_project up JOIN labor_project p ON p.id = up.project_id
     WHERE up.user_id = :userId`,
    { userId }
  );

  return {
    id: user.id,
    username: user.username,
    realName: user.realName,
    phone: user.phone,
    status: user.status,
    employeeId: user.employeeId,
    roles: roles.map(r => ({
      id: r.id,
      roleName: r.roleName,
      roleCode: r.roleCode,
      dataScope: r.dataScope,
      dataScopeName: SCOPE_NAMES[r.dataScope] || '自定义'
    })),
    departments,
    projects
  };
}

async function createUser(companyId, body) {
  const roleIds = body.roleIds || [];
  if (!body.username || !body.password || !body.realName || !roleIds.length)
    throw createError('账号、初始密码、姓名和角色不能为空');
  if (String(body.password).length < 8 || !/[A-Za-z]/.test(body.password) || !/\d/.test(body.password))
    throw createError('初始密码至少8位且包含字母和数字');

  // 检查用户名是否已存在
  const existing = await db.first(
    'SELECT id FROM sys_user WHERE company_id = :companyId AND username = :username',
    { companyId, username: body.username }
  );
  if (existing) throw createError('账号已存在');

  const validRoles = await db.query(
    `SELECT id FROM sys_role WHERE company_id=:companyId AND status=1 AND role_code IN (${MANAGED_ROLE_SQL})
     AND id IN (${roleIds.map((_, index) => `:roleId${index}`).join(', ')})`,
    { companyId, ...Object.fromEntries(roleIds.map((id, index) => [`roleId${index}`, Number(id)])) }
  );
  if (validRoles.length !== new Set(roleIds.map(Number)).size) throw createError('包含无效或非本公司的角色');

  return db.transaction(async connection => {
    const [result] = await connection.execute(
      `INSERT INTO sys_user (company_id, username, password_hash, real_name, phone, status)
       VALUES (:companyId, :username, :passwordHash, :realName, :phone, 1)`,
      { companyId, username: body.username, passwordHash: hashPassword(body.password),
        realName: body.realName, phone: body.phone || null }
    );
    const newUserId = result.insertId;

    for (const roleId of roleIds) {
      await connection.execute(
        `INSERT INTO sys_user_role (user_id, role_id)
         SELECT :userId, id FROM sys_role
         WHERE id = :roleId AND company_id = :companyId AND status = 1 AND role_code IN (${MANAGED_ROLE_SQL})`,
        { userId: newUserId, roleId: Number(roleId), companyId }
      );
    }

    // 项目授权
    if (body.projectIds?.length) {
      for (const pid of body.projectIds) {
        await connection.execute(
          `INSERT INTO sys_user_project (user_id, project_id)
           SELECT :userId, id FROM labor_project WHERE id = :projectId AND company_id = :companyId`,
          { userId: newUserId, projectId: Number(pid), companyId }
        );
      }
    }

    // 部门授权已废弃：劳务公司管理的是项目，部门维度不适用

    return { userId: newUserId };
  });
}

async function updateUser(companyId, userId, body) {
  const user = await db.first(
    'SELECT id,username FROM sys_user WHERE id = :userId AND company_id = :companyId',
    { userId, companyId }
  );
  if (!user) throw createError('用户不存在', 404);
  if (user.username === 'admin' && Number(body.status) === 0) throw createError('不能停用超级管理员账号');
  if (body.roleIds && !body.roleIds.length) throw createError('账号至少需要保留一个角色');
  if (body.roleIds) {
    const uniqueRoleIds = [...new Set(body.roleIds.map(Number))];
    const params = { companyId };
    const placeholders = uniqueRoleIds.map((roleId, index) => {
      params[`roleId${index}`] = roleId;
      return `:roleId${index}`;
    });
    const validRoles = await db.query(
      `SELECT id,role_code roleCode FROM sys_role
       WHERE company_id=:companyId AND status=1 AND role_code IN (${MANAGED_ROLE_SQL}) AND id IN (${placeholders.join(', ')})`,
      params
    );
    if (validRoles.length !== uniqueRoleIds.length) throw createError('包含无效或非本公司的角色');
    if (user.username === 'admin' && !validRoles.some(role => role.roleCode === 'company_admin')) {
      throw createError('超级管理员必须保留企业管理员角色');
    }
  }

  return db.transaction(async connection => {
    if (body.realName || body.phone || body.status !== undefined) {
      const sets = [];
      const params = { userId, companyId };
      if (body.realName) { sets.push('real_name = :realName'); params.realName = body.realName; }
      if (body.phone !== undefined) { sets.push('phone = :phone'); params.phone = body.phone || null; }
      if (body.status !== undefined) { sets.push('status = :status'); params.status = Number(body.status); }
      if (sets.length) {
        await connection.execute(
          `UPDATE sys_user SET ${sets.join(', ')} WHERE id = :userId AND company_id = :companyId`,
          params
        );
      }
    }

    // 更新角色
    if (body.roleIds) {
      await connection.execute('DELETE FROM sys_user_role WHERE user_id = :userId', { userId });
      for (const roleId of body.roleIds) {
        await connection.execute(
          `INSERT INTO sys_user_role (user_id, role_id)
           SELECT :userId, id FROM sys_role
           WHERE id = :roleId AND company_id = :companyId AND status = 1 AND role_code IN (${MANAGED_ROLE_SQL})`,
          { userId, roleId: Number(roleId), companyId }
        );
      }
    }

    // 部门授权已废弃：劳务公司管理的是项目，部门维度不适用

    // 更新项目授权
    if (body.projectIds) {
      await connection.execute('DELETE FROM sys_user_project WHERE user_id = :userId', { userId });
      for (const pid of body.projectIds) {
        await connection.execute(
          `INSERT INTO sys_user_project (user_id, project_id)
           SELECT :userId, id FROM labor_project WHERE id = :projectId AND company_id = :companyId`,
          { userId, projectId: Number(pid), companyId }
        );
      }
    }

    // 账号资料、角色或项目授权变化后，立即撤销该账号已签发的 Token。
    await connection.execute(
      'UPDATE sys_user SET token_version=token_version+1,updated_at=NOW() WHERE id=:userId AND company_id=:companyId',
      { userId, companyId }
    );

    return { userId };
  });
}

async function toggleUserStatus(companyId, userId, status) {
  const user = await db.first(
    'SELECT id, username FROM sys_user WHERE id = :userId AND company_id = :companyId',
    { userId, companyId }
  );
  if (!user) throw createError('用户不存在', 404);
  if (user.username === 'admin') throw createError('不能停用超级管理员账号');

  await db.query(
    'UPDATE sys_user SET status = :status, token_version=token_version+1 WHERE id = :userId AND company_id = :companyId',
    { userId, companyId, status: Number(status) }
  );
  return null;
}

async function resetPassword(companyId, userId, body) {
  if (!body.newPassword || !body.confirmPassword) throw createError('请输入新密码');
  if (body.newPassword !== body.confirmPassword) throw createError('两次输入的密码不一致');
  if (String(body.newPassword).length < 8 || !/[A-Za-z]/.test(body.newPassword) || !/\d/.test(body.newPassword))
    throw createError('新密码至少8位且包含字母和数字');

  const user = await db.first(
    'SELECT id FROM sys_user WHERE id = :userId AND company_id = :companyId',
    { userId, companyId }
  );
  if (!user) throw createError('用户不存在', 404);

  await db.query(
    'UPDATE sys_user SET password_hash = :hash, token_version = token_version+1 WHERE id = :userId AND company_id = :companyId',
    { userId, companyId, hash: hashPassword(body.newPassword) }
  );
  return null;
}

// ============================================================
// 角色管理
// ============================================================

async function listRoles(companyId) {
  const roles = await db.query(
    `SELECT r.id, r.role_name roleName, r.role_code roleCode, r.data_scope dataScope, r.status,
       COUNT(DISTINCT ur.user_id) userCount
     FROM sys_role r
     LEFT JOIN sys_user_role ur ON ur.role_id = r.id
     WHERE r.company_id = :companyId AND r.status = 1 AND r.role_code IN (${MANAGED_ROLE_SQL})
     GROUP BY r.id ORDER BY r.id`,
    { companyId }
  );

  // 查每个角色的权限
  const roleIds = roles.map(r => r.id);
  let permMap = {};
  if (roleIds.length) {
    const perms = await db.query(
      `SELECT rp.role_id roleId, p.id permId, p.permission_name permName, p.permission_code permCode,
              p.permission_type permType, p.parent_id parentId
       FROM sys_role_permission rp
       JOIN sys_permission p ON p.id = rp.permission_id AND p.status = 1
       WHERE rp.role_id IN (${roleIds.map((_, i) => `:rid${i}`).join(',')})`,
      Object.fromEntries(roleIds.map((id, i) => [`rid${i}`, id]))
    );
    for (const p of perms) {
      if (!permMap[p.roleId]) permMap[p.roleId] = [];
      permMap[p.roleId].push({
        id: p.permId, permName: p.permName, permCode: p.permCode,
        permType: p.permType, parentId: p.parentId
      });
    }
  }

  // 查每个角色的部门
  let deptMap = {};
  if (roleIds.length) {
    const depts = await db.query(
      `SELECT rd.role_id roleId, d.id deptId, d.dept_name deptName
       FROM sys_role_dept rd
       JOIN hr_department d ON d.id = rd.dept_id AND d.status = 1
       WHERE rd.role_id IN (${roleIds.map((_, i) => `:rid${i}`).join(',')})`,
      Object.fromEntries(roleIds.map((id, i) => [`rid${i}`, id]))
    );
    for (const d of depts) {
      if (!deptMap[d.roleId]) deptMap[d.roleId] = [];
      deptMap[d.roleId].push({ id: d.deptId, deptName: d.deptName });
    }
  }

  return roles.map(role => ({
    ...role,
    dataScopeName: SCOPE_NAMES[role.dataScope] || '自定义',
    permissions: permMap[role.id] || [],
    departments: deptMap[role.id] || []
  }));
}

async function updateRolePermissions(companyId, roleId, permissionIds) {
  const role = await db.first(
    'SELECT id,role_code roleCode FROM sys_role WHERE id = :roleId AND company_id = :companyId AND status = 1',
    { roleId, companyId }
  );
  if (!role) throw createError('角色不存在', 404);

  const availablePermissions = await db.query(
    'SELECT id, parent_id parentId FROM sys_permission WHERE status=1'
  );
  const finalPermissionIds = role.roleCode === 'company_admin'
    ? availablePermissions.map(item => Number(item.id))
    : expandPermissionIds(availablePermissions, permissionIds);

  return db.transaction(async connection => {
    await connection.execute('DELETE FROM sys_role_permission WHERE role_id = :roleId', { roleId });
    for (const permId of finalPermissionIds) {
      await connection.execute(
        `INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
         SELECT :roleId, id FROM sys_permission WHERE id = :permId AND status = 1`,
        { roleId, permId: Number(permId) }
      );
    }
    await connection.execute(
      'UPDATE sys_user SET token_version=token_version+1,updated_at=NOW() WHERE company_id=:companyId AND id IN (SELECT user_id FROM sys_user_role WHERE role_id=:roleId)',
      { companyId, roleId }
    );
    return { roleId };
  });
}

async function updateRoleDepartments(companyId, roleId, deptIds) {
  const role = await db.first(
    'SELECT id, data_scope FROM sys_role WHERE id = :roleId AND company_id = :companyId AND status = 1',
    { roleId, companyId }
  );
  if (!role) throw createError('角色不存在', 404);

  return db.transaction(async connection => {
    await connection.execute('DELETE FROM sys_role_dept WHERE role_id = :roleId', { roleId });
    for (const deptId of deptIds) {
      await connection.execute(
        `INSERT IGNORE INTO sys_role_dept (role_id, dept_id)
         SELECT :roleId, id FROM hr_department WHERE id = :deptId AND company_id = :companyId AND status = 1`,
        { roleId, deptId: Number(deptId), companyId }
      );
    }
    await connection.execute(
      'UPDATE sys_user SET token_version=token_version+1,updated_at=NOW() WHERE company_id=:companyId AND id IN (SELECT user_id FROM sys_user_role WHERE role_id=:roleId)',
      { companyId, roleId }
    );
    return { roleId };
  });
}

// ============================================================
// 基础数据
// ============================================================

async function listDepartments(companyId) {
  return db.query(
    `SELECT id, parent_id parentId, dept_name deptName, dept_code deptCode, sort_no sortNo, status
     FROM hr_department WHERE company_id = :companyId AND status = 1 ORDER BY sort_no, id`,
    { companyId }
  );
}

async function listPermissions() {
  const perms = await db.query(
    `SELECT id, permission_name permName, permission_code permCode, permission_type permType,
            parent_id parentId, sort_no sortNo, status
     FROM sys_permission WHERE status = 1 ORDER BY sort_no, id`
  );
  // 构建树形结构
  const map = {};
  const tree = [];
  for (const p of perms) {
    map[p.id] = { ...p, children: [] };
  }
  for (const p of perms) {
    if (p.parentId && map[p.parentId]) {
      map[p.parentId].children.push(map[p.id]);
    } else {
      tree.push(map[p.id]);
    }
  }
  return tree;
}

async function listProjects(companyId) {
  return db.query(
    `SELECT p.id, p.project_code projectCode, p.project_name projectName,
            p.customer_id customerId, p.status,
            c.customer_name customerName
     FROM labor_project p
     LEFT JOIN crm_customer c ON c.id = p.customer_id AND c.status = 1
     WHERE p.company_id = :companyId
     ORDER BY c.customer_name, p.id`,
    { companyId }
  );
}

async function getProjectOnsiteAssignees(companyId, projectId) {
  const project = await db.first(
    `SELECT p.id, p.project_name projectName, p.customer_id customerId, c.customer_name customerName
     FROM labor_project p
     JOIN crm_customer c ON c.id=p.customer_id AND c.company_id=p.company_id
     WHERE p.id=:projectId AND p.company_id=:companyId`,
    { companyId, projectId }
  );
  if (!project) throw createError('项目不存在', 404);

  const users = await db.query(
    `SELECT DISTINCT u.id userId, u.real_name realName, u.username, u.phone,
            CASE WHEN EXISTS (
              SELECT 1 FROM sys_user_project up WHERE up.user_id=u.id AND up.project_id=:projectId
            ) THEN 1 ELSE 0 END assigned
     FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id=u.id
     JOIN sys_role r ON r.id=ur.role_id AND r.company_id=u.company_id
     WHERE u.company_id=:companyId AND u.status=1 AND r.status=1 AND r.role_code = 'onsite_staff'
     ORDER BY assigned DESC, u.real_name, u.id`,
    { companyId, projectId }
  );

  return {
    project,
    users: users.map(user => ({ ...user, phone: maskPhone(user.phone), assigned: Number(user.assigned) === 1 }))
  };
}

async function updateProjectOnsiteAssignees(companyId, projectId, userIds, operatorId) {
  const selectedUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map(Number).filter(Number.isInteger))];
  const project = await db.first(
    'SELECT id,project_name projectName FROM labor_project WHERE id=:projectId AND company_id=:companyId',
    { companyId, projectId }
  );
  if (!project) throw createError('项目不存在', 404);

  if (selectedUserIds.length) {
    const params = { companyId };
    const placeholders = selectedUserIds.map((userId, index) => {
      params[`userId${index}`] = userId;
      return `:userId${index}`;
    });
    const validUsers = await db.query(
      `SELECT DISTINCT u.id
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id=u.id
       JOIN sys_role r ON r.id=ur.role_id AND r.company_id=u.company_id
       WHERE u.company_id=:companyId AND u.status=1 AND r.status=1 AND r.role_code = 'onsite_staff'
         AND u.id IN (${placeholders.join(',')})`,
      params
    );
    if (validUsers.length !== selectedUserIds.length) throw createError('包含无效、停用或非驻厂专员账号');
  }

  return db.transaction(async connection => {
    await connection.execute(
      `DELETE up FROM sys_user_project up
       JOIN sys_user u ON u.id=up.user_id AND u.company_id=:companyId
       JOIN sys_user_role ur ON ur.user_id=u.id
       JOIN sys_role r ON r.id=ur.role_id AND r.company_id=u.company_id AND r.role_code='onsite_staff'
       WHERE up.project_id=:projectId`,
      { companyId, projectId }
    );

    for (const userId of selectedUserIds) {
      await connection.execute(
        `INSERT IGNORE INTO sys_user_project (user_id, project_id)
         SELECT u.id, p.id
         FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id=u.id
         JOIN sys_role r ON r.id=ur.role_id AND r.company_id=u.company_id
         JOIN labor_project p ON p.id=:projectId AND p.company_id=:companyId
         WHERE u.id=:userId AND u.company_id=:companyId AND u.status=1
           AND r.status=1 AND r.role_code='onsite_staff'`,
        { companyId, projectId, userId }
      );
    }

    await connection.execute(
      `INSERT INTO hr_operation_log
       (company_id,operator_id,module_name,biz_type,biz_id,action_type,after_data)
       VALUES (:companyId,:operatorId,'客户项目','project_onsite_assignment',:projectId,'assign',:afterData)`,
      {
        companyId,
        operatorId,
        projectId,
        afterData: JSON.stringify({ projectName: project.projectName, onsiteUserIds: selectedUserIds })
      }
    );

    return { projectId, onsiteUserIds: selectedUserIds };
  });
}

module.exports = {
  listUsers,
  getUserDetail,
  createUser,
  updateUser,
  toggleUserStatus,
  resetPassword,
  listRoles,
  updateRolePermissions,
  updateRoleDepartments,
  listDepartments,
  listPermissions,
  listProjects,
  getProjectOnsiteAssignees,
  updateProjectOnsiteAssignees,
  MANAGED_ROLE_CODES,
  expandPermissionIds
};
