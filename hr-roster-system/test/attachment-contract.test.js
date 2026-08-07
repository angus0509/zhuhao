const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, text, message) => {
  if (!source.includes(text)) throw new Error(message);
};

const packageJson = require('../package.json');
if (!packageJson.dependencies?.multer) throw new Error('附件上传依赖 multer 未安装');

const middleware = read('src/middlewares/upload.middleware.js');
assertIncludes(middleware, 'multer.memoryStorage()', '附件必须先在内存校验业务权限，不能提前写入磁盘');
assertIncludes(middleware, '10 * 1024 * 1024', '附件缺少10MB限制');
for (const extension of ['.jpg', '.png', '.pdf', '.doc', '.docx']) {
  assertIncludes(middleware, extension, `附件缺少格式支持：${extension}`);
}

const service = read('src/services/attachment.service.js');
assertIncludes(service, 'assertEmployeeScope', '附件未复用员工数据范围隔离');
const employeeService = read('src/services/employee.service.js');
assertIncludes(employeeService, '  assertEmployeeScope,', '员工数据范围校验函数未导出，附件权限检查将无法执行');
assertIncludes(service, "permission: 'contract:manage'", '合同附件未校验管理权限');
assertIncludes(service, "permission: 'social:manage'", '保险附件未校验管理权限');
assertIncludes(service, "permission: 'cert:manage'", '证件附件未校验管理权限');
assertIncludes(service, "permission: 'risk:handle'", '整改证据未校验处理权限');
assertIncludes(service, "flag: 'wx'", '附件写入未阻止同名覆盖');
assertIncludes(service, "createHash('sha256')", '附件未生成完整性摘要');
assertIncludes(service, 'includeStoragePath', '附件内部存储路径未与普通响应隔离');

const routes = read('src/routes/attachment.routes.js');
assertIncludes(routes, 'router.use(requireAuth)', '附件接口未强制登录');
assertIncludes(routes, "router.post('/attachments', sensitiveLimiter", '附件上传未启用写操作限流');
assertIncludes(routes, "router.get('/attachments/:id/download'", '缺少受保护附件下载接口');

const migration = read('sql/migrate-attachments-20260804.mysql.sql');
for (const field of ['employee_id BIGINT', 'storage_path VARCHAR', 'file_sha256 CHAR(64)', 'created_by BIGINT', 'updated_at DATETIME']) {
  assertIncludes(migration, field, `附件表缺少关键字段：${field}`);
}

const compose = read('docker-compose.prod.yml');
assertIncludes(compose, './uploads:/app/uploads', '生产容器未持久化附件目录');

const buildScript = read('scripts/build-release-package.sh');
assertIncludes(buildScript, "--exclude='uploads'", '发布包未排除真实业务附件');
const dockerfile = read('Dockerfile');
assertIncludes(dockerfile, 'COPY . .', 'Docker镜像仍使用易遗漏测试依赖的逐目录复制方式');
const dockerignore = read('.dockerignore');
for (const ignored of ['.env*', '.runtime', 'uploads', 'wechat-miniprogram', '*.pem', '*.key']) {
  assertIncludes(dockerignore, ignored, `Docker构建上下文未排除敏感或无关目录：${ignored}`);
}
const backupScript = read('scripts/backup-mysql.sh');
assertIncludes(backupScript, 'attachments-$TIMESTAMP.tar.gz', '每日备份未覆盖合规附件');

const html = read('public/index.html');
if ((html.match(/data-attachment-input/g) || []).length < 3) throw new Error('合同、证件和整改三类业务附件入口不完整');
const frontend = read('public/app.js');
assertIncludes(frontend, "fetch('/api/attachments'", '前端未接入附件上传接口');
assertIncludes(frontend, 'data-download-attachment', '员工详情未提供附件下载入口');

console.log('合规附件格式限制、权限隔离、持久化、备份与页面闭环检查通过。');
