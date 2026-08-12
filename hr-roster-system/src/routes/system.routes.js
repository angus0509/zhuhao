const express = require('express');
const controller = require('../controllers/system.controller');
const { requireAuth, requirePermission } = require('../middlewares/auth.middleware');

const router = express.Router();
router.use(requireAuth);

// 用户管理 — 需要 system:role 权限
router.get('/system/users', requirePermission('system:role'), controller.listUsers);
router.get('/system/users/:id', requirePermission('system:role'), controller.getUserDetail);
router.post('/system/users', requirePermission('system:role'), controller.createUser);
router.put('/system/users/:id', requirePermission('system:role'), controller.updateUser);
router.put('/system/users/:id/status', requirePermission('system:role'), controller.toggleUserStatus);
router.put('/system/users/:id/password-reset', requirePermission('system:role'), controller.resetPassword);

// 角色管理
router.get('/system/roles', requirePermission('system:role'), controller.listRoles);
router.put('/system/roles/:id/permissions', requirePermission('system:role'), controller.updateRolePermissions);
router.put('/system/roles/:id/departments', requirePermission('system:role'), controller.updateRoleDepartments);

// 基础数据
router.get('/system/departments', requirePermission('system:role'), controller.listDepartments);
router.get('/system/permissions', requirePermission('system:role'), controller.listPermissions);
router.get('/system/projects', requirePermission('system:role'), controller.listProjects);
router.get('/system/projects/:id/onsite-assignees', requirePermission('system:role'), controller.getProjectOnsiteAssignees);
router.put('/system/projects/:id/onsite-assignees', requirePermission('system:role'), controller.updateProjectOnsiteAssignees);

module.exports = router;
