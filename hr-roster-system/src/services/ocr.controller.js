const ocrService = require('../services/ocr.service');
const { success, asyncHandler } = require('../utils/response');

exports.idcard = asyncHandler(async (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.json({ code: 400, message: '请上传身份证图片', data: null });
  }
  try {
    const result = await ocrService.recognizeIdCard(image);
    success(res, result, '身份证识别成功');
  } catch (err) {
    console.error('[OCR] idcard failed:', err.message);
    if (err.code === 'OCR_NOT_CONFIGURED') {
      return res.json({ code: 503, message: err.message, data: null });
    }
    return res.json({ code: 500, message: 'OCR识别失败：' + err.message, data: null });
  }
});
