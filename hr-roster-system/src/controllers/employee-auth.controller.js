const employeeAuthService = require('../services/employee-auth.service');
const { success, asyncHandler } = require('../utils/response');

function requestMeta(req) {
  return {
    ipAddress: req.ip,
    deviceInfo: req.header('user-agent') || ''
  };
}

exports.startWechatLogin = asyncHandler(async (req, res) => {
  const data = await employeeAuthService.startWechatLogin(req.companyId, req.body, requestMeta(req));
  success(res, data, data.needIdentityVerify ? '请验证员工身份' : '登录成功');
});

exports.bindByPhone = asyncHandler(async (req, res) => {
  const data = await employeeAuthService.bindByPhone(req.companyId, req.body, requestMeta(req));
  success(res, data, '绑定并登录成功');
});

exports.bindByCode = asyncHandler(async (req, res) => {
  const data = await employeeAuthService.bindByCode(req.companyId, req.body, requestMeta(req));
  success(res, data, '绑定并登录成功');
});

exports.profile = asyncHandler(async (req, res) => {
  const data = await employeeAuthService.getProfile(req.companyId, req.user);
  success(res, data);
});
