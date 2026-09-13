const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

// 一、Web 会话和 XSS 防护：浏览器不得持久化 Bearer Token，服务端必须下发安全响应头。
{
  const app = read('src/app.js');
  const web = [read('public/app.js'), read('public/js/views/roster.js')].join('\n');
  const authController = read('src/controllers/auth.controller.js');
  assert.match(app, /Content-Security-Policy/, '缺少 CSP，存储型 XSS 仍可执行脚本');
  assert.match(app, /X-Content-Type-Options/, '缺少 nosniff 安全响应头');
  assert.doesNotMatch(web, /localStorage\.getItem\('hrRosterToken'\)/, 'Web Token 仍存储在 localStorage');
  assert.doesNotMatch(web, /localStorage\.setItem\('hrRosterToken'/, '登录后仍会把 Token 写入 localStorage');
  assert.match(web, /credentials:\s*'same-origin'/, 'Web 请求未启用 HttpOnly 会话 Cookie');
  assert.match(authController, /httpOnly:\s*true/, '登录接口未设置 HttpOnly Cookie');
  assert.match(web, /escapeHtml\(row\.name\)/, '员工姓名仍未经转义进入 innerHTML');
  assert.match(web, /escapeHtml\(item\.reason\)/, '黑名单原因仍未经转义进入 innerHTML');
}

// 二、敏感字段必须使用独立权限，普通员工编辑权限不能查看完整身份证和银行卡。
{
  const controller = read('src/controllers/employee.controller.js');
  const web = read('public/app.js');
  const miniProgram = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
  assert.doesNotMatch(controller, /canReadForEditing/, 'employee:update 仍可绕过敏感信息独立权限');
  assert.match(controller, /employee:sensitive:view/, '缺少敏感信息独立权限校验');
  assert.match(web, /canViewSensitiveEmployee/, 'Web 编辑页未根据敏感权限决定是否读取完整字段');
  assert.match(miniProgram, /canViewSensitiveEmployee/, '小程序编辑页未根据敏感权限决定是否读取完整字段');
}

// 三、工资批次员工必须同时属于当前企业和当前项目。
{
  const service = read('src/services/operations.service.js');
  assert.match(service, /e\.company_id=:companyId/, '工资批次员工查询未限制当前企业');
  assert.match(service, /EXISTS[\s\S]*project_job\.customer_id=:customerId[\s\S]*project_job\.project_id=:projectId/,
    '工资批次仍可混入其他客户或其他项目员工');
  assert.match(service, /e\.employee_status IN \(2,3\)/,
    '工资批次应仅允许在职和已离职员工');
  assert.match(service, /projectId:\s*project\.id/, '工资员工查询未绑定当前项目参数');
}

// 四、工资条必须提供员工本人接口，并对查看和签收留痕。
{
  const routes = read('src/routes/payslip.routes.js');
  const service = read('src/services/payslip.service.js');
  const operationsService = read('src/services/operations.service.js');
  const schema = read('sql/schema.mysql.sql');
  assert.match(routes, /router\.get\('\/me\/payslips'/, '缺少员工本人工资条列表接口');
  assert.match(routes, /router\.get\('\/me\/payslips\/:id'/, '缺少员工本人工资条详情接口');
  assert.match(routes, /router\.post\('\/me\/payslips\/:id\/receipt'/, '缺少工资条签收接口');
  assert.match(routes, /router\.post\('\/me\/payslips\/:id\/signature'/, '缺少工资条手写签名接口');
  assert.match(routes, /router\.post\('\/me\/payslips\/:id\/dispute'/, '缺少工资异议接口');
  assert.match(routes, /requireEmployeeAccount/, '员工工资条接口缺少员工账号类型守卫');
  assert.match(service, /d\.employee_id=:employeeId/, '工资条查询未强制绑定当前员工');
  assert.match(service, /b\.batch_status=5/, '员工端可能读取未发布工资数据');
  assert.match(service, /salary_receipt_log/, '工资条查看和签收没有证据日志');
  assert.match(schema, /CREATE TABLE salary_receipt_log/, '数据库缺少工资条证据日志表');
  assert.match(schema, /CREATE TABLE salary_signature/, '数据库缺少工资条手写签名表');
  assert.match(schema, /CREATE TABLE salary_dispute/, '数据库缺少工资异议表');
  assert.match(routes, /sensitiveLimiter[\s\S]*receiptMine/, '工资条签收接口缺少敏感操作限流');
  const operationsRoutes = read('src/routes/operations.routes.js');
  assert.match(operationsRoutes, /router\.get\('\/payroll\/disputes',\s*requirePermission\('payroll:view'\)/,
    '工资异议列表缺少工资查看权限');
  assert.match(operationsRoutes, /router\.put\('\/payroll\/disputes\/:id\/handle',\s*sensitiveLimiter,\s*requirePermission\('payroll:manage'\)/,
    '工资异议处理缺少限流或工资管理权限');
  assert.match(operationsRoutes, /router\.get\('\/payroll\/batches\/:id\/details',\s*requirePermission\('payroll:view'\)/,
    '工资批次员工签收详情缺少工资查看权限');
  assert.match(operationsRoutes, /router\.post\('\/payroll\/batches\/preview',\s*sensitiveLimiter,\s*requirePermission\('payroll:manage'\)/,
    '工资表预校验接口缺少敏感操作限流或工资管理权限');
  assert.match(operationsService, /e\.id_card_hash=:idCardHash/, '工资导入仍可能使用完整身份证号查询');
  assert.match(operationsService, /params\.idCardHash\s*=\s*sha256\(row\.idCardNo\)/, '工资导入身份证匹配未使用不可逆摘要');
}

// 五、离职闭环必须停用管理账号，并仅保留受限员工端工资条账号。
{
  const employeeService = read('src/services/employee.service.js');
  assert.match(
    employeeService,
    /UPDATE sys_user SET status=CASE WHEN account_type='EMPLOYEE' THEN 1 ELSE 0 END,[\s\S]*token_version=token_version\+1[\s\S]*employee_id=:employeeId/s,
    '离职完成后未保留受限员工账号、停用管理账号或使旧 Token 失效'
  );
}

// 六、生产密钥必须失败关闭；新敏感数据使用带认证的随机 nonce 加密。
{
  const envSource = read('src/config/env.js');
  const cryptoSource = read('src/utils/crypto.js');
  const deploy = read('scripts/deploy-production.sh');
  assert.match(envSource, /assertProductionSecurityConfig/, '生产环境缺少密钥启动校验');
  assert.match(cryptoSource, /aes-256-gcm/, '敏感数据仍未使用认证加密');
  assert.match(cryptoSource, /randomBytes\(12\)/, '敏感数据加密仍使用固定 IV');
  assert.doesNotMatch(cryptoSource, /if \(!encryptionReady\(\)\) return String\(text\)/, '加密配置缺失时仍会明文存储');
  for (const variable of ['DB_PASSWORD', 'JWT_SECRET', 'DATA_ENCRYPT_KEY', 'DATA_ENCRYPT_IV']) {
    assert.match(deploy, new RegExp(`\\$\\{${variable}:\\?`), `生产部署未校验 ${variable}`);
  }
}

// 七、加密回归：新格式可解密、随机 nonce 使相同明文产生不同密文、缺少密钥时拒绝写入。
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters';
process.env.DATA_ENCRYPT_KEY = '12345678901234567890123456789012';
process.env.DATA_ENCRYPT_IV = '1234567890123456';
const env = require('../src/config/env');
const dataCrypto = require('../src/utils/crypto');
const { readCookie, assertCookieRequestOrigin } = require('../src/middlewares/auth.middleware');
const first = dataCrypto.encrypt('340101199001011234');
const second = dataCrypto.encrypt('340101199001011234');
assert.match(first, /^enc:v2:/, '新写入敏感数据不是 v2 认证加密格式');
assert.notEqual(first, second, '相同明文不应生成相同密文');
assert.equal(dataCrypto.decrypt(first), '340101199001011234', 'v2 敏感数据无法正确解密');
const originalKey = env.crypto.key;
env.crypto.key = '';
assert.throws(() => dataCrypto.encrypt('sensitive'), /加密密钥/, '缺少密钥时仍允许写入敏感信息');
env.crypto.key = originalKey;

const request = (method, headers) => ({ method, header: name => headers[String(name).toLowerCase()] || '' });
assert.equal(readCookie(request('GET', { cookie: 'other=1; hr_session=secure-token' }), 'hr_session'), 'secure-token');
assert.doesNotThrow(() => assertCookieRequestOrigin(request('POST', { origin: 'https://lczpt.com', host: 'lczpt.com' })));
assert.throws(
  () => assertCookieRequestOrigin(request('POST', { origin: 'https://attacker.example', host: 'lczpt.com' })),
  error => error?.statusCode === 403,
  'Cookie 认证的跨站写请求未被拒绝'
);

console.log('high-risk-security-tests-ok');
