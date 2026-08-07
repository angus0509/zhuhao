const { verifyToken } = require('../utils/token');
const { createError } = require('../utils/response');
const authService = require('../services/auth.service');
const env = require('../config/env');

function readCookie(req, name) {
  const cookieHeader = String(req.header('cookie') || '');
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return '';
}

function assertCookieRequestOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) return;
  const origin = String(req.header('origin') || '');
  const host = String(req.header('host') || '');
  let sameHost = false;
  try {
    sameHost = Boolean(origin && host && new URL(origin).host === host);
  } catch (_error) {
    sameHost = false;
  }
  if (!sameHost && !env.corsOrigins.includes(origin)) {
    throw createError('请求来源校验失败，请刷新页面后重试', 403);
  }
}

async function requireAuth(req, _res, next) {
  try {
    const header = req.header('authorization') || '';
    const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : '';
    const cookieToken = readCookie(req, 'hr_session');
    const token = bearerToken || cookieToken;
    const payload = verifyToken(token);
    if (!payload?.userId) throw createError('未登录或登录已过期', 401);

    if (!bearerToken && cookieToken) assertCookieRequestOrigin(req);

    const user = await authService.getUserById(payload.userId);
    if (!user) throw createError('用户不存在或已停用', 401);
    if (Number(payload.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      throw createError('登录状态已失效，请重新登录', 401);
    }

    req.user = user;
    req.companyId = Number(user.companyId || payload.companyId || req.companyId);
    req.operatorId = Number(user.id);
    req.authSource = bearerToken ? 'bearer' : 'cookie';
    next();
  } catch (error) {
    next(error);
  }
}

function requirePermission(permissionCode) {
  return (req, _res, next) => {
    if (!req.user) return next(createError('未登录或登录已过期', 401));
    if (!req.user.permissions.includes(permissionCode)) {
      return next(createError('无操作权限', 403));
    }
    next();
  };
}

function requireAnyPermission(permissionCodes) {
  const required = Array.isArray(permissionCodes) ? permissionCodes : [];
  return (req, _res, next) => {
    if (!req.user) return next(createError('未登录或登录已过期', 401));
    if (!required.some(code => req.user.permissions.includes(code))) {
      return next(createError('无操作权限', 403));
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requirePermission,
  requireAnyPermission,
  readCookie,
  assertCookieRequestOrigin
};
