const authService = require('../services/auth.service');
const { success, asyncHandler } = require('../utils/response');
const env = require('../config/env');

const SESSION_COOKIE = 'hr_session';

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/api',
    maxAge: env.auth.tokenExpiresInSeconds * 1000
  };
}

exports.login = asyncHandler(async (req, res) => {
  const data = await authService.login({
    companyId: req.companyId,
    username: req.body.username,
    password: req.body.password
  });
  // Web 使用 HttpOnly Cookie；小程序继续使用响应体中的 Bearer Token，保持现有兼容性。
  res.cookie(SESSION_COOKIE, data.token, sessionCookieOptions());
  success(res, data, '登录成功');
});

exports.logout = asyncHandler(async (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
  success(res, null, '已退出登录');
});

exports.me = asyncHandler(async (req, res) => {
  success(res, req.user);
});

exports.changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.companyId, req.operatorId, req.body);
  success(res, null, '密码修改成功');
});
