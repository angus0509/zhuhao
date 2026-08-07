const systemService = require('../services/system.service');
const { success, asyncHandler } = require('../utils/response');

// 用户管理
exports.listUsers = asyncHandler(async (req, res) => success(res, await systemService.listUsers(req.companyId)));
exports.getUserDetail = asyncHandler(async (req, res) => success(res, await systemService.getUserDetail(req.companyId, Number(req.params.id))));
exports.createUser = asyncHandler(async (req, res) => success(res, await systemService.createUser(req.companyId, req.body), '账号创建成功'));
exports.updateUser = asyncHandler(async (req, res) => success(res, await systemService.updateUser(req.companyId, Number(req.params.id), req.body), '账号更新成功'));
exports.toggleUserStatus = asyncHandler(async (req, res) => success(res, await systemService.toggleUserStatus(req.companyId, Number(req.params.id), req.body.status), '状态更新成功'));
exports.resetPassword = asyncHandler(async (req, res) => success(res, await systemService.resetPassword(req.companyId, Number(req.params.id), req.body), '密码重置成功'));

// 角色管理
exports.listRoles = asyncHandler(async (req, res) => success(res, await systemService.listRoles(req.companyId)));
exports.updateRolePermissions = asyncHandler(async (req, res) => success(res, await systemService.updateRolePermissions(req.companyId, Number(req.params.id), req.body.permissionIds || []), '权限配置成功'));
exports.updateRoleDepartments = asyncHandler(async (req, res) => success(res, await systemService.updateRoleDepartments(req.companyId, Number(req.params.id), req.body.deptIds || []), '部门授权成功'));

// 基础数据
exports.listDepartments = asyncHandler(async (req, res) => success(res, await systemService.listDepartments(req.companyId)));
exports.listPermissions = asyncHandler(async (req, res) => success(res, await systemService.listPermissions()));
exports.listProjects = asyncHandler(async (req, res) => success(res, await systemService.listProjects(req.companyId)));
