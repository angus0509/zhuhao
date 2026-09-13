const service = require('../services/employee-sms-auth.service');
const { success, asyncHandler } = require('../utils/response');

function requestMeta(req) {
  return {
    ipAddress: req.ip,
    deviceInfo: req.header('user-agent') || ''
  };
}

exports.requestCode = asyncHandler(async (req, res) => {
  const data = await service.requestLoginCode(req.companyId, req.body, requestMeta(req));
  success(res, data, '如果该手机号已登记，验证码将发送到您的手机');
});

exports.login = asyncHandler(async (req, res) => {
  const data = await service.loginByCode(req.companyId, req.body, requestMeta(req));
  success(res, data, '登录成功');
});
