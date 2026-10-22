const service = require('../services/operations.service');
const { success, asyncHandler } = require('../utils/response');

exports.overview = asyncHandler(async (req, res) => {
  return success(res, await service.managerMobileOverview(req.companyId, req.user));
});

exports.payslipStatus = asyncHandler(async (req, res) => {
  return success(res, await service.managerMobilePayslipStatus(req.companyId, req.user, req.query));
});
