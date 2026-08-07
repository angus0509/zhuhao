const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

// 员工导出必须记录审计信息，且不能把导出正文写入日志。
{
  const controller = read('src/controllers/employee.controller.js');
  const service = read('src/services/employee.service.js');
  assert.match(controller, /req\.operatorId/, '员工导出未传递操作人');
  assert.match(controller, /req\.ip/, '员工导出未记录客户端IP');
  assert.match(service, /function recordEmployeeExport/, '员工导出缺少统一审计函数');
  assert.match(service, /actionType:\s*'export_employee'/, 'CSV 导出未写操作日志');
  assert.match(service, /actionType:\s*'export_employee_xlsx'/, 'XLSX 导出未写操作日志');
  assert.match(service, /fileSha256/, '员工导出日志缺少文件摘要');
  assert.match(service, /filterSummary/, '员工导出日志缺少筛选条件摘要');
  assert.doesNotMatch(service, /afterData:\s*JSON\.stringify\([^)]*csv/s, '导出正文不得写入操作日志');
}

// CSV 单元格必须阻止 Excel 公式注入。
{
  const service = read('src/services/employee.service.js');
  assert.match(service, /function escapeCsvCell/, '缺少统一 CSV 单元格安全编码');
  assert.ok(service.includes('/^[=+@-]/'), 'CSV 未识别危险公式首字符');
  const { escapeCsvCell } = require('../src/services/employee.service');
  assert.equal(escapeCsvCell('=HYPERLINK("https://evil.example")'), '"\'=HYPERLINK(""https://evil.example"")"');
  assert.equal(escapeCsvCell('+1+1'), '"\'+1+1"');
  assert.equal(escapeCsvCell('正常姓名'), '"正常姓名"');
  const { safeExcelText } = require('../src/services/employee.service');
  assert.equal(safeExcelText('=1+1'), "'=1+1");
  assert.equal(safeExcelText('正常姓名'), '正常姓名');
}

// 密码和权限变化后，已签发 Token 必须失效。
{
  const schema = read('sql/schema.mysql.sql');
  const authService = read('src/services/auth.service.js');
  const authMiddleware = read('src/middlewares/auth.middleware.js');
  const systemService = read('src/services/system.service.js');
  assert.match(schema, /token_version INT NOT NULL DEFAULT 0/, 'sys_user 缺少 Token 版本字段');
  assert.match(authService, /tokenVersion:\s*Number\(user\.token_version/, '登录签发 Token 时未包含版本');
  assert.match(authMiddleware, /payload\.tokenVersion/, '鉴权时未校验 Token 版本');
  assert.match(authService, /token_version=token_version\+1/, '用户修改密码后未撤销旧 Token');
  assert.match(systemService, /password_hash\s*=\s*:hash,\s*token_version\s*=\s*token_version\+1/s, '管理员重置密码后未撤销旧 Token');
  assert.match(systemService, /UPDATE sys_user SET token_version=token_version\+1[^\n]+id IN \(SELECT user_id/s, '角色权限变化后未撤销关联用户 Token');
}

console.log('p1-security-hardening-tests-ok');
