const service = require('../services/attendance.service');
const { success, asyncHandler } = require('../utils/response');

exports.employeeMonth = asyncHandler(async (req, res) => success(res, await service.getEmployeeMonth(req.companyId, req.user.employeeId, req.query.month)));
exports.daily = asyncHandler(async (req, res) => success(res, { list: await service.listDaily(req.companyId, req.user, req.query) }));
exports.monthly = asyncHandler(async (req, res) => success(res, { list: await service.listMonthly(req.companyId, req.user, req.query) }));
