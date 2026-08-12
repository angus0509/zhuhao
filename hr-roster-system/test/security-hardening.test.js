const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, text, message) => {
  if (!source.includes(text)) throw new Error(message);
};

const appSource = read('src/app.js');
assertIncludes(appSource, "app.set('trust proxy', 1)", '生产环境未配置单层反向代理');
assertIncludes(appSource, "app.use('/api', globalLimiter)", 'API 未启用全局限流');
assertIncludes(appSource, 'allowedOrigins.has(origin)', 'CORS 未使用域名白名单');
assertIncludes(appSource, 'if (!origin', '微信小程序无 Origin 请求未兼容');

const authRoutes = read('src/routes/auth.routes.js');
assertIncludes(authRoutes, "router.post('/auth/login', loginLimiter", '登录接口未启用独立限流');

const employeeRoutes = read('src/routes/employee.routes.js');
assertIncludes(employeeRoutes, "router.post('/employees/batch', batchLimiter", '员工批量录入未启用批量限流');
assertIncludes(employeeRoutes, "router.post('/employees/:id/onboard', sensitiveLimiter", '入职接口未启用写操作限流');
assertIncludes(employeeRoutes, "router.put('/employees/:id/social-security', sensitiveLimiter", '保险接口未启用写操作限流');

const operationRoutes = read('src/routes/operations.routes.js');
assertIncludes(operationRoutes, "router.put('/advances/:id/pay', sensitiveLimiter", '预支放款未启用写操作限流');
assertIncludes(operationRoutes, "router.put('/payroll/batches/:id/publish', sensitiveLimiter", '工资发布未启用写操作限流');

const releaseBuilder = read('scripts/build-release-package.sh');
for (const option of ['--no-xattrs', '--no-acls', '--no-fflags', '--no-mac-metadata']) {
  assertIncludes(releaseBuilder, option, `发布包未禁用 macOS 元数据：${option}`);
}
const releaseVerifier = read('scripts/verify-release-package.sh');
assertIncludes(releaseVerifier, 'LIBARCHIVE\\.xattr|SCHILY\\.(xattr|fflags)', '发布包验收未阻止 macOS 扩展属性');

const postDeployVerify = read('scripts/post-deploy-verify.sh');
for (const marker of ['优益数字化管理系统', '/layout-refine.css', '/js/views/roster.js', 'view=activeRoster']) {
  assertIncludes(postDeployVerify, marker, `上线后验证缺少页面标记：${marker}`);
}
assertIncludes(postDeployVerify, 'npm run smoke:onsite', '上线后验证未包含驻厂角色 smoke');
assertIncludes(postDeployVerify, 'UNAUTHORIZED_STATUS', '上线后验证未检查未授权访问拦截');

const limiter = require('../src/middlewares/rate-limit.middleware');
for (const name of ['globalLimiter', 'loginLimiter', 'sensitiveLimiter', 'batchLimiter']) {
  if (typeof limiter[name] !== 'function') throw new Error(`限流中间件不可用：${name}`);
}

console.log('CORS、代理 IP 与接口限流安全加固检查通过。');
