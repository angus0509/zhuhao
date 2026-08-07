const service = require('../services/recruitment-source.service');
const { success, asyncHandler } = require('../utils/response');

exports.listChannels = asyncHandler(async (req, res) => {
  success(res, await service.listChannels(req.companyId, req.user));
});

exports.listChannelEmployees = asyncHandler(async (req, res) => {
  success(res, await service.listChannelEmployees(req.companyId, Number(req.params.id), req.user));
});

exports.createChannel = asyncHandler(async (req, res) => {
  success(res, await service.createChannel(req.companyId, req.body, req.operatorId), '招聘渠道已创建');
});

exports.updateChannel = asyncHandler(async (req, res) => {
  success(res, await service.updateChannel(req.companyId, Number(req.params.id), req.body), '招聘渠道已更新');
});

exports.listRecruiters = asyncHandler(async (req, res) => {
  success(res, await service.listRecruiters(req.companyId));
});

exports.createRecruiter = asyncHandler(async (req, res) => {
  success(res, await service.createRecruiter(req.companyId, req.body, req.operatorId), '招聘人已创建');
});

exports.updateRecruiter = asyncHandler(async (req, res) => {
  success(res, await service.updateRecruiter(req.companyId, Number(req.params.id), req.body), '招聘人已更新');
});

exports.listSuppliers = asyncHandler(async (req, res) => {
  success(res, await service.listSuppliers(req.companyId));
});

exports.createSupplier = asyncHandler(async (req, res) => {
  success(res, await service.createSupplier(req.companyId, req.body, req.operatorId), '供应商已创建');
});

exports.updateSupplier = asyncHandler(async (req, res) => {
  success(res, await service.updateSupplier(req.companyId, Number(req.params.id), req.body), '供应商已更新');
});
