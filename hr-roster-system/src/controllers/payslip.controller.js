const service = require('../services/payslip.service');
const signatureService = require('../services/payslip-signature.service');
const { success, asyncHandler } = require('../utils/response');

function requestMeta(req) {
  return {
    ipAddress: req.ip,
    userAgent: req.header('user-agent') || ''
  };
}

exports.listMine = asyncHandler(async (req, res) => {
  success(res, await service.listMyPayslips(req.companyId, req.user, req.query));
});

exports.detailMine = asyncHandler(async (req, res) => {
  success(res, await service.getMyPayslip(req.companyId, Number(req.params.id), req.user, requestMeta(req)));
});

exports.receiptMine = asyncHandler(async (req, res) => {
  const data = await service.receiptMyPayslip(req.companyId, Number(req.params.id), req.body, req.user, requestMeta(req));
  success(res, data, data.receiptStatus === 2 ? '工资条签收成功' : '工资条拒签已记录');
});

exports.uploadSignatureMine = asyncHandler(async (req, res) => {
  const data = await signatureService.uploadMySignature(
    req.companyId,
    Number(req.params.id),
    req.file,
    req.body,
    req.user,
    { ipAddress: req.ip, deviceInfo: req.header('user-agent') || '' }
  );
  success(res, data, '手写签名已保存');
});

exports.disputeMine = asyncHandler(async (req, res) => {
  const data = await service.disputeMyPayslip(
    req.companyId,
    Number(req.params.id),
    req.body,
    req.user,
    requestMeta(req)
  );
  success(res, data, '工资异议已提交');
});
