const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const routes = read('src/routes/payslip.routes.js');
const service = read('src/services/payslip.service.js');
const signatureService = read('src/services/payslip-signature.service.js');
const controller = read('src/controllers/payslip.controller.js');
const miniSign = read('wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.js');
const miniDetail = read('wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.js');
const miniMarkup = [
  read('wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.wxml'),
  read('wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxml')
].join('\n');

assert.match(routes, /router\.use\('\/me\/payslips',\s*requireAuth,\s*requireEmployeeAccount\)/,
  '工资条所有接口必须先通过登录和员工账号守卫');
assert.match(routes, /router\.post\('\/me\/payslips\/:id\/signature',\s*sensitiveLimiter,\s*singlePayslipSignature/,
  '签名上传必须先经过敏感接口限流和专用PNG上传中间件');
assert.match(routes, /router\.post\('\/me\/payslips\/:id\/receipt',\s*sensitiveLimiter/,
  '签收接口必须启用敏感操作限流');
assert.match(routes, /router\.post\('\/me\/payslips\/:id\/dispute',\s*sensitiveLimiter/,
  '工资异议接口必须启用敏感操作限流');

for (const source of [service, signatureService]) {
  assert.match(source, /company_id=:companyId/, '工资条写操作必须绑定登录企业');
  assert.match(source, /employee_id=:employeeId/, '工资条写操作必须绑定登录员工');
}
assert.match(signatureService, /employeeIdFromUser\(user\)/,
  '签名员工ID必须从登录会话取得');
assert.doesNotMatch(signatureService, /body\.employeeId|body\.companyId/,
  '签名接口不能信任请求体传入的企业或员工ID');
assert.match(signatureService, /mode:\s*0o600/,
  '签名文件必须使用仅属主可读写权限');
assert.match(signatureService, /signatureSha256/,
  '签名文件必须保存不可抵赖校验值');
assert.doesNotMatch(controller, /storagePath|absolutePath|relativePath/,
  '签名接口响应层不能暴露服务器存储路径');

assert.match(miniSign, /authorization:\s*`Bearer \$\{session\.token\}`/,
  '小程序签名上传必须使用请求头携带员工Token');
assert.doesNotMatch(miniSign, /[?&](?:token|employeeId|companyId)=/i,
  'Token、员工ID和企业ID不能进入签名请求URL');
assert.doesNotMatch(miniSign + miniDetail, /console\.(?:log|info|debug|warn)/,
  '工资条页面不能把Token、签名或工资信息写入调试日志');
assert.doesNotMatch(miniMarkup, /idCard|bankCard|phone(?:No)?|身份证号|银行卡号/,
  '工资条签收页面不得渲染身份证、银行卡或手机号');
assert.doesNotMatch(miniMarkup, /storagePath|filePath|signatureSha256/,
  '工资条页面不得渲染签名路径或文件校验值');

console.log('payslip-signature-security-tests-ok');
