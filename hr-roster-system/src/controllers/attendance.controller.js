const service = require('../services/attendance.service');
const { success, asyncHandler } = require('../utils/response');

exports.employeeMonth = asyncHandler(async (req, res) => success(res, await service.getEmployeeMonth(req.companyId, req.user.employeeId, req.query.month)));
exports.punch = asyncHandler(async (req, res) => success(res, await service.punchEmployee(req.companyId, req.user.employeeId, req.body), '打卡成功'));
exports.createCorrection = asyncHandler(async (req, res) => success(res, await service.createCorrection(req.companyId, req.user.employeeId, req.body), '申请已提交'));
exports.reviewCorrection = asyncHandler(async (req, res) => success(res, await service.reviewCorrection(req.companyId, req.user, Number(req.params.id), req.body), '审核结果已保存'));
exports.daily = asyncHandler(async (req, res) => success(res, { list: await service.listDaily(req.companyId, req.user, req.query) }));
exports.monthly = asyncHandler(async (req, res) => success(res, { list: await service.listMonthly(req.companyId, req.user, req.query) }));
