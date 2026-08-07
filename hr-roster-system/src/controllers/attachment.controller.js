const attachmentService = require('../services/attachment.service');
const { success, asyncHandler } = require('../utils/response');

exports.upload = asyncHandler(async (req, res) => {
  const data = await attachmentService.uploadAttachment(req.companyId, req.body, req.file, req.operatorId, req.user);
  success(res, data, '附件上传成功');
});

exports.list = asyncHandler(async (req, res) => {
  success(res, await attachmentService.listAttachments(req.companyId, req.query, req.user));
});

exports.download = asyncHandler(async (req, res) => {
  const attachment = await attachmentService.resolveDownload(req.companyId, Number(req.params.id), req.user);
  res.download(attachment.absolutePath, attachment.originalName);
});
