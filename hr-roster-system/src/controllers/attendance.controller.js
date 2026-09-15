const service = require('../services/attendance.service');
const geofenceService = require('../services/attendance-geofence-management.service');
const { success, asyncHandler } = require('../utils/response');

exports.employeeMonth = asyncHandler(async (req, res) => success(res, await service.getEmployeeMonth(req.companyId, req.user.employeeId, req.query.month)));
exports.employeeToday = asyncHandler(async (req, res) => success(res, await service.getEmployeeToday(req.companyId, req.user.employeeId)));
exports.punch = asyncHandler(async (req, res) => success(res, await service.punchEmployee(req.companyId, req.user.employeeId, req.body), '打卡成功'));
exports.createCorrection = asyncHandler(async (req, res) => success(res, await service.createCorrection(req.companyId, req.user.employeeId, req.body), '申请已提交'));
exports.reviewCorrection = asyncHandler(async (req, res) => success(res, await service.reviewCorrection(req.companyId, req.user, Number(req.params.id), req.body), '审核结果已保存'));
exports.daily = asyncHandler(async (req, res) => success(res, { list: await service.listDaily(req.companyId, req.user, req.query) }));
exports.monthly = asyncHandler(async (req, res) => success(res, { list: await service.listMonthly(req.companyId, req.user, req.query) }));
exports.createShiftRule = asyncHandler(async (req, res) => success(res, await service.createShiftRule(req.companyId, req.operatorId, req.body), '班次已保存'));
exports.upsertSchedule = asyncHandler(async (req, res) => success(res, await service.upsertSchedule(req.companyId, req.operatorId, req.body), '排班已保存'));
exports.payrollSummary = asyncHandler(async (req, res) => success(res, await service.attendanceSummaryForPayroll(req.companyId, req.user, req.query)));
exports.listGeofences = asyncHandler(async (req, res) => success(res, { list: await geofenceService.list(req.companyId, req.user, req.query.projectId) }));
exports.createGeofence = asyncHandler(async (req, res) => success(res, await geofenceService.create(req.companyId, req.user, req.operatorId, req.body), '电子围栏已创建'));
exports.updateGeofence = asyncHandler(async (req, res) => success(res, await geofenceService.update(req.companyId, req.user, Number(req.params.id), req.body), '电子围栏已更新'));
