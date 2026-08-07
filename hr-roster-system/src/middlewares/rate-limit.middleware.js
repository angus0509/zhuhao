const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function response(message) {
  return { code: 429, message, data: null };
}

// API 总体限流。健康检查不计入，避免云监控探测占用业务额度。
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: req => req.path === '/health',
  message: response('请求过于频繁，请稍后再试')
});

// 登录按“来源 IP + 用户名”限制，避免同一办公网络内不同账号互相影响。
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}:${String(req.body?.username || '').trim().toLowerCase() || 'unknown'}`,
  message: response('登录尝试次数过多，请15分钟后再试')
});

// 新增、审批、发布等写操作限制，防止重复点击和脚本批量调用。
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: response('操作过于频繁，请稍后再试')
});

// 批量导入计算和写入量较大，单独使用更严格的额度。
const batchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: response('批量操作过于频繁，请稍后再试')
});

module.exports = { globalLimiter, loginLimiter, sensitiveLimiter, batchLimiter };
