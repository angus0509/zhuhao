const riskService = require('../services/risk.service');
const { success, asyncHandler } = require('../utils/response');

exports.list = asyncHandler(async (req, res) => {
  const data = await riskService.listRisks(req.companyId, req.user);
  success(res, data);
});

exports.scan = asyncHandler(async (req, res) => {
  const data = await riskService.scanRisks(req.companyId);
  success(res, data, `风险扫描完成，新增${data.created}条`);
});

exports.handle = asyncHandler(async (req, res) => {
  const data = await riskService.handleRisk(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '风险已更新');
});

exports.listCases = asyncHandler(async (req, res) => {
  const data = await riskService.listRiskCases(req.companyId, req.user, req.query.status);
  success(res, data);
});

exports.createCase = asyncHandler(async (req, res) => {
  const data = await riskService.createRiskCase(req.companyId, req.body, req.operatorId, req.user);
  success(res, data, '整改任务已创建');
});

exports.updateCase = asyncHandler(async (req, res) => {
  const data = await riskService.updateRiskCase(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user);
  success(res, data, '整改任务已更新');
});
