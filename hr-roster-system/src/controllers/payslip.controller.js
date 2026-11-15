const service = require('../services/payslip.service');
const signatureService = require('../services/payslip-signature.service');
const signChallengeService = require('../services/payslip-sign-challenge.service');
const signaturePreviewService = require('../services/payroll-signature-preview.service');
const evidenceReceiptService = require('../services/payslip-evidence-receipt.service');
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

exports.issueSignChallengeMine = asyncHandler(async (req, res) => {
  const challenge = await signChallengeService.issueChallenge(req.companyId, Number(req.params.id), req.user);
  const data = {
    challengeId: challenge.challengeId,
    challengeToken: challenge.challengeToken,
    expiresIn: challenge.expiresIn
  };
  success(res, data, '签收挑战已生成');
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

exports.previewSignatureMine = asyncHandler(async (req, res) => {
  const signature = await signaturePreviewService.resolveEmployeeSignature(
    req.companyId,
    Number(req.params.id),
    req.user
  );
  res.setHeader('Content-Type', signature.mimeType);
  res.setHeader('Content-Disposition', 'inline; filename="payslip-signature.png"');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(signature.file);
});

exports.downloadEvidenceReceiptMine = asyncHandler(async (req, res) => {
  const receipt = await evidenceReceiptService.resolveEmployeeReceipt(
    req.companyId,
    Number(req.params.id),
    req.user
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${receipt.receiptNo}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Receipt-SHA256', receipt.receiptSha256);
  return res.send(receipt.buffer);
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
