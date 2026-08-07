const path = require('path');
const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const db = require('./db');
const apiRoutes = require('./routes');
const { attachContext } = require('./middlewares/context.middleware');
const { fail, logApiError } = require('./utils/response');
const { globalLimiter } = require('./middlewares/rate-limit.middleware');

env.assertProductionSecurityConfig();

const app = express();

app.use((_req, res, next) => {
  // 阻止动态业务文本被解释为可执行脚本，并限制页面被第三方站点嵌入。
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.bootcdn.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// 腾讯云生产环境由 Nginx 反向代理一层，正确解析真实客户端 IP。
if (env.nodeEnv === 'production') app.set('trust proxy', 1);

const developmentOrigins = env.nodeEnv === 'production'
  ? []
  : ['http://localhost:3100', 'http://127.0.0.1:3100'];
const allowedOrigins = new Set([...env.corsOrigins, ...developmentOrigins]);
app.use(cors({
  origin(origin, callback) {
    // 微信小程序和原生请求通常不携带浏览器 Origin，允许继续交由 Token 权限校验。
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
}));
app.use(express.json({ limit: '10mb' }));
app.use('/api', globalLimiter);
app.use(attachContext);

app.get('/api/health', async (_req, res) => {
  try {
    const database = await db.first('SELECT 1 AS ok');
    if (Number(database?.ok) !== 1) throw new Error('database_unavailable');
    res.json({
      code: 0,
      message: 'ok',
      data: {
        service: 'hr-roster-system',
        mode: 'express-mysql',
        database: 'connected',
        uptimeSeconds: Math.floor(process.uptime())
      }
    });
  } catch (_error) {
    // 健康检查不返回数据库地址、账号或错误原文，避免向公网泄露基础设施信息。
    res.status(503).json({
      code: 503,
      message: 'service unavailable',
      data: { service: 'hr-roster-system', database: 'unavailable' }
    });
  }
});

app.use('/api', apiRoutes);

// API 未匹配时必须返回 JSON，避免前端把 SPA 首页 HTML 当成 JSON 解析。
app.use('/api', (req, res) => {
  res.status(404).json({ code: 404, message: `接口不存在：${req.method} ${req.path}`, data: null });
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  logApiError(error, req);
  fail(res, error);
});

if (require.main === module) {
  app.listen(env.port, () => {
    console.log(`优益数字化管理系统生产服务已启动：http://localhost:${env.port}`);
    if (env.nodeEnv === 'production') require('./scheduler').startScheduler();
  });
}

module.exports = app;
