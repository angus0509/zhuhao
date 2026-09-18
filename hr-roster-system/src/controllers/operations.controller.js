const service = require('../services/operations.service');
const signaturePreviewService = require('../services/payroll-signature-preview.service');
const payrollImportProfileService = require('../services/payroll-import-profile.service');
const payrollImportTemplateService = require('../services/payroll-import-template.service');
const { success, asyncHandler } = require('../utils/response');

exports.listCustomers = asyncHandler(async (req, res) => success(res, await service.listCustomers(req.companyId, req.query, req.user)));
exports.createCustomer = asyncHandler(async (req, res) => success(res, await service.createCustomer(req.companyId, req.body, req.operatorId, req.user), '客户及首个项目创建成功并已生效'));
exports.getCustomerDetail = asyncHandler(async (req, res) => success(res, await service.getCustomerDetail(req.companyId, Number(req.params.id), req.user)));
exports.updateCustomerPortfolio = asyncHandler(async (req, res) => success(res, await service.updateCustomerPortfolio(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '客户项目情况已更新'));
exports.listProjects = asyncHandler(async (req, res) => success(res, await service.listProjects(req.companyId, req.query, req.user)));
exports.createProject = asyncHandler(async (req, res) => success(res, await service.createProject(req.companyId, req.body, req.user), '项目创建成功'));
exports.listFactoryStaff = asyncHandler(async (req, res) => success(res, await service.listFactoryStaff(req.companyId, req.query, req.user)));
exports.createFactoryStaff = asyncHandler(async (req, res) => success(res, await service.createFactoryStaff(req.companyId, req.body, req.user), '驻厂人员登记成功'));
exports.listBlacklist = asyncHandler(async (req, res) => success(res, await service.listBlacklist(req.companyId, req.query)));
exports.createBlacklist = asyncHandler(async (req, res) => success(res, await service.createBlacklist(req.companyId, req.body, req.operatorId), '黑名单录入成功'));
exports.batchCreateBlacklist = asyncHandler(async (req, res) => {
  const data = await service.createBlacklistBatch(req.companyId, req.body.rows, req.operatorId);
  success(res, data, `批量录入完成：成功${data.successCount}人，失败${data.failureCount}人`);
});
exports.listAdvances = asyncHandler(async (req, res) => success(res, await service.listAdvances(req.companyId, req.query, req.user)));
exports.createAdvance = asyncHandler(async (req, res) => success(res, await service.createAdvance(req.companyId, req.body, req.operatorId, req.user), req.body.recordMode === 'onsite' ? '驻厂预支记录已保存' : '预支申请提交成功'));
exports.approveAdvance = asyncHandler(async (req, res) => success(res, await service.approveAdvance(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '审批完成'));
exports.payAdvance = asyncHandler(async (req, res) => success(res, await service.payAdvance(req.companyId, Number(req.params.id), req.operatorId, req.user), '放款成功'));
exports.payrollOverview = asyncHandler(async (req, res) => success(res, await service.payrollOverview(req.companyId, req.user, req.query)));
exports.getPayrollImportProfile = asyncHandler(async (req, res) => success(res, await payrollImportProfileService.findProfile(
  req.companyId,
  Number(req.query.projectId),
  req.query.headerSignature,
  req.user
)));
exports.listPayrollTemplates = asyncHandler(async (req, res) => success(res, { list: await payrollImportTemplateService.listTemplates(req.companyId, req.query.projectId, req.user) }));
exports.createPayrollTemplate = asyncHandler(async (req, res) => success(res, await payrollImportTemplateService.createTemplate(req.companyId, req.body, req.operatorId), '工资表模板已保存'));
exports.updatePayrollTemplate = asyncHandler(async (req, res) => success(res, await payrollImportTemplateService.updateTemplate(req.companyId, Number(req.params.id), req.body), '工资表模板已更新'));
exports.deletePayrollTemplate = asyncHandler(async (req, res) => success(res, await payrollImportTemplateService.deleteTemplate(req.companyId, Number(req.params.id)), '工资表模板已删除'));
exports.listPayrollDisputes = asyncHandler(async (req, res) => success(res, await service.listPayrollDisputes(req.companyId, req.query, req.user)));
exports.handlePayrollDispute = asyncHandler(async (req, res) => success(res, await service.handlePayrollDispute(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '工资异议处理状态已更新'));
exports.getPayrollBatchDetail = asyncHandler(async (req, res) => success(res, await service.getPayrollBatchDetail(req.companyId, Number(req.params.id), req.query, req.user)));
exports.exportPayrollDelivery = asyncHandler(async (req, res) => {
  const result = await service.exportPayrollBatchCsv(req.companyId, Number(req.params.id), 'delivery', req.user, {
    operatorId: req.operatorId,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') || ''
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-delivery-${result.salaryMonth || result.batchNo}.csv"`);
  res.setHeader('X-Export-Record-Count', String(result.count));
  res.send(result.csv);
});
exports.exportPayrollReceiptsPdf = asyncHandler(async (req, res) => {
  const result = await service.exportPayrollReceiptPdf(req.companyId, Number(req.params.id), req.user, {
    operatorId: req.operatorId,
    ipAddress: req.ip,
    userAgent: req.header('user-agent') || ''
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-receipts-${result.salaryMonth || result.batchNo}.pdf"`);
  res.setHeader('X-Export-Record-Count', String(result.count));
  res.end(result.buffer);
});
exports.previewPayrollBatch = asyncHandler(async (req, res) => success(res, await service.previewPayrollBatch(req.companyId, req.body, req.user), '工资表预校验完成'));
exports.createPayrollBatch = asyncHandler(async (req, res) => success(res, await service.createPayrollBatch(req.companyId, req.body, req.operatorId, req.user), '工资批次创建成功'));
exports.updatePayrollViewPolicy = asyncHandler(async (req, res) => success(res, await service.updatePayrollViewPolicy(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '工资条查看策略已更新'));
exports.submitPayrollBatch = asyncHandler(async (req, res) => success(res, await service.submitPayrollBatch(req.companyId, Number(req.params.id), req.operatorId, req.user), '工资批次已提交复核'));
exports.reviewPayrollBatch = asyncHandler(async (req, res) => success(res, await service.reviewPayrollBatch(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '工资批次复核完成'));
exports.publishPayrollBatch = asyncHandler(async (req, res) => success(res, await service.publishPayrollBatch(req.companyId, Number(req.params.id), req.operatorId, req.user), '工资条已发布，进入待签收'));
exports.withdrawPayrollBatch = asyncHandler(async (req, res) => success(res, await service.withdrawPayrollBatch(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '工资条已撤回至待发放'));
exports.deletePayrollBatch = asyncHandler(async (req, res) => success(res, await service.deletePayrollBatch(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '工资批次已删除'));
exports.previewPayrollSignature = asyncHandler(async (req, res) => {
  const signature = await signaturePreviewService.resolveManagerSignature(
    req.companyId,
    Number(req.params.id),
    req.user
  );
  res.setHeader('Content-Type', signature.mimeType);
  res.setHeader('Content-Disposition', 'inline; filename="payslip-signature.png"');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  return res.sendFile(signature.absolutePath);
});
exports.getPayrollSmsSummary = asyncHandler(async (req, res) => success(res, await service.getPayrollSmsSummary(req.companyId, Number(req.params.id), req.user)));
exports.createPayrollSmsReminders = asyncHandler(async (req, res) => success(res, await service.createPayrollSmsReminders(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '催签任务已创建'));
exports.retryPayrollSms = asyncHandler(async (req, res) => success(res, await service.retryPayrollSms(req.companyId, Number(req.params.id), req.body, req.operatorId, req.user), '补发任务已重置'));
exports.operationsHome = asyncHandler(async (req, res) => success(res, await service.operationsHome(req.companyId, req.user)));
exports.listNotices = asyncHandler(async (req, res) => success(res, await service.listNotices(req.companyId, req.user, req.query)));
exports.permissionOverview = asyncHandler(async (req, res) => success(res, await service.permissionOverview(req.companyId)));
exports.createSystemUser = asyncHandler(async (req, res) => success(res, await service.createSystemUser(req.companyId, req.body), '账号创建成功'));
