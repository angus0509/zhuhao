const service = require('../services/portal.service');
const { success, asyncHandler } = require('../utils/response');

exports.clients = asyncHandler(async (req, res) => success(res, await service.listClients(req.companyId, req.user)));
exports.createClient = asyncHandler(async (req, res) => success(res, await service.createClient(req.companyId, req.body, req.operatorId), '客户及首个项目创建成功并已生效'));
exports.clientServices = asyncHandler(async (req, res) => success(res, await service.listClientServices(req.companyId, req.query, req.user)));
exports.createClientService = asyncHandler(async (req, res) => success(res, await service.createClientService(req.companyId, req.body, req.operatorId), '客户交付工单已创建'));
exports.updateClientServiceStatus = asyncHandler(async (req, res) => success(res, await service.updateClientServiceStatus(req.companyId, Number(req.params.id), req.body), '工单状态已更新'));
exports.talents = asyncHandler(async (req, res) => success(res, await service.listTalents(req.companyId, req.user)));
exports.createTalent = asyncHandler(async (req, res) => success(res, await service.createTalent(req.companyId, req.body, req.operatorId), '人才已录入'));
exports.employmentRecords = asyncHandler(async (req, res) => success(res, await service.employmentRecords(req.companyId, req.user)));
exports.auditLogs = asyncHandler(async (req, res) => success(res, await service.auditLogs(req.companyId)));
exports.dashboard = asyncHandler(async (req, res) => success(res, await service.dashboard(req.companyId, req.user)));
