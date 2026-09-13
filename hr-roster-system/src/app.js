const path = require('path');
const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const db = require('./db');
const apiRoutes = require('./routes');
const { attachContext } = require('./middlewares/context.middleware');
const { fail, logApiError } = require('./utils/response');
const { globalLimiter } = require('./middlewares/rate-limit.middleware');
const { renderPayslipLandingPage } = require('./services/wechat-landing.service');

const exceljsBrowserPath = require.resolve('exceljs/dist/exceljs.min.js');

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
  if (env.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
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
    res.status(200).end();
  } catch (_error) {
    // 公网健康检查只用状态码表达结果，不暴露服务、技术栈或数据库细节。
    res.status(503).end();
  }
});

app.use('/api', apiRoutes);

// API 未匹配时必须返回 JSON，避免前端把 SPA 首页 HTML 当成 JSON 解析。
app.use('/api', (req, res) => {
  res.status(404).json({ code: 404, message: `接口不存在：${req.method} ${req.path}`, data: null });
});

app.get('/vendor/exceljs.min.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(exceljsBrowserPath);
});

app.get('/wx/payslip', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(renderPayslipLandingPage(env.wechatMini.urlScheme));
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
    console.log(`优企云数字化管理系统生产服务已启动：http://localhost:${env.port}`);
    if (env.nodeEnv === 'production') require('./scheduler').startScheduler();
  });
}

module.exports = app;
