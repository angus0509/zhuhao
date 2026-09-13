const crypto = require('crypto');
const env = require('../config/env');
const officialProvider = require('../services/wechat-official.service').createWechatOfficialService();
const service = require('../services/official-notification.service').createOfficialNotificationService();
const { success, asyncHandler, createError } = require('../utils/response');

function signState(companyId, employeeId) {
  const raw = `${Number(companyId)}:${Number(employeeId)}`;
  const secret = env.employeeBinding.hmacSecret || env.auth.jwtSecret;
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex').slice(0, 32);
  return Buffer.from(`${raw}:${sig}`).toString('base64url');
}

function readState(state) {
  let decoded;
  try { decoded = Buffer.from(String(state || ''), 'base64url').toString('utf8'); } catch (_error) { throw createError('绑定状态无效', 400); }
  const [companyId, employeeId, sig] = decoded.split(':');
  const raw = `${Number(companyId)}:${Number(employeeId)}`;
  const secret = env.employeeBinding.hmacSecret || env.auth.jwtSecret;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex').slice(0, 32);
  if (!companyId || !employeeId || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw createError('绑定状态无效或已过期', 400);
  return { companyId: Number(companyId), employeeId: Number(employeeId) };
}

exports.bindUrl = asyncHandler(async (req, res) => {
  const employeeId = Number(req.user.employeeId || req.query.employeeId);
  if (!employeeId) throw createError('当前账号未关联员工档案', 403);
  success(res, { url: officialProvider.buildAuthUrl(signState(req.companyId, employeeId)) });
});

exports.callback = asyncHandler(async (req, res) => {
  const scope = readState(req.query.state);
  const identity = await officialProvider.exchangeCode(req.query.code);
  const result = await service.bindEmployee({ ...scope, ...identity });
  success(res, result, '服务号绑定成功');
});

exports.status = asyncHandler(async (req, res) => {
  const employeeId = Number(req.user.employeeId || req.query.employeeId);
  success(res, await service.getBindingStatus(req.companyId, employeeId));
});

exports.unbind = asyncHandler(async (req, res) => {
  const employeeId = Number(req.user.employeeId || req.body.employeeId);
  success(res, await service.unbindEmployee(req.companyId, employeeId, req.operatorId), '服务号已解绑');
});

exports.listNotifications = asyncHandler(async (req, res) => {
  success(res, await service.listNotifications({
    companyId: req.companyId,
    batchId: req.query.batchId,
    status: req.query.status,
    page: req.query.page,
    pageSize: req.query.pageSize
  }));
});
