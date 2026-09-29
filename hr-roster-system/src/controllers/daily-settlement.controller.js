const service = require('../services/daily-settlement.service');
const { asyncHandler, success } = require('../utils/response');

exports.projects = asyncHandler(async (req, res) =>
  success(res, await service.listProjects(req.companyId, req.user)));

exports.createPreview = asyncHandler(async (req, res) =>
  success(res, await service.createDailyPreview(req.companyId, req.user, req.operatorId, req.body), '日结预览已生成'));
exports.list = asyncHandler(async (req, res) =>
  success(res, await service.listDailySettlements(req.companyId, req.user, req.query)));
exports.confirmBatch = asyncHandler(async (req, res) =>
  success(res, await service.confirmBatch(req.companyId, req.user, req.operatorId, req.body), '日结已确认'));
exports.revoke = asyncHandler(async (req, res) =>
  success(res, await service.revokePayment(req.companyId, req.user, req.operatorId, Number(req.params.id), req.body), '日结已撤销'));
exports.events = asyncHandler(async (req, res) =>
  success(res, await service.listPaymentEvents(req.companyId, req.user, Number(req.params.id))));
