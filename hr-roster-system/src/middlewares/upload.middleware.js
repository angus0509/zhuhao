const path = require('path');
const multer = require('multer');
const { createError } = require('../utils/response');

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_PAYSLIP_SIGNATURE_SIZE = 1024 * 1024;
const ALLOWED_FILE_TYPES = new Map([
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])],
  ['.png', new Set(['image/png'])],
  ['.pdf', new Set(['application/pdf'])],
  ['.doc', new Set(['application/msword', 'application/octet-stream'])],
  ['.docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'])]
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowedMimes = ALLOWED_FILE_TYPES.get(extension);
    if (!allowedMimes || !allowedMimes.has(String(file.mimetype || '').toLowerCase())) {
      return callback(createError('仅支持 JPG、PNG、PDF、DOC、DOCX 格式的合规材料'));
    }
    callback(null, true);
  }
});

const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PAYSLIP_SIGNATURE_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension !== '.png' || String(file.mimetype || '').toLowerCase() !== 'image/png') {
      return callback(createError('工资条签名仅支持PNG格式'));
    }
    callback(null, true);
  }
});

function singleAttachment(req, res, next) {
  upload.single('file')(req, res, error => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return next(createError('单个附件不能超过10MB'));
    if (error.code === 'LIMIT_FILE_COUNT') return next(createError('每次只能上传一个附件'));
    next(error);
  });
}

function singlePayslipSignature(req, res, next) {
  signatureUpload.single('signature')(req, res, error => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return next(createError('签名PNG大小不能超过1MB'));
    if (error.code === 'LIMIT_FILE_COUNT') return next(createError('每次只能上传一个签名文件'));
    next(error);
  });
}

module.exports = {
  singleAttachment,
  singlePayslipSignature,
  MAX_ATTACHMENT_SIZE,
  MAX_PAYSLIP_SIGNATURE_SIZE,
  ALLOWED_FILE_TYPES
};
