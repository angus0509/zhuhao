const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../scripts/post-deploy-verify.sh'), 'utf8');
const deploySource = fs.readFileSync(path.resolve(__dirname, '../scripts/deploy-production.sh'), 'utf8');

assert.match(source, /SECONDARY_BASE_URL/, '上线后验证必须覆盖主域名和 www 域名');
assert.match(source, /HEALTH_STATUS/, '健康检查必须使用 HTTP 状态码判断');
assert.match(source, /HEALTH_STATUS[^\n]*200/, '健康接口必须返回 HTTP 200');
assert.doesNotMatch(source, /"database"[^\n]*"connected"|database.*connected/, '上线检查不得依赖公网健康接口的数据库详情');
assert.match(source, /Strict-Transport-Security/i, '上线后验证必须检查 HSTS 响应头');
assert.match(source, /\/js\/views\/roster\.js/, '上线后验证必须读取实际花名册资源');
assert.match(source, /grep -Fq ['"]'activeRoster'['"]/, '上线后验证必须确认网页花名册声明在职视图');
assert.match(source, /view \? `view=\$\{view\}`/, '上线后验证必须确认在职视图参数会写入请求');
assert.doesNotMatch(source, /grep -Fq ['"]view=activeRoster['"]/, '上线后验证不得依赖源码中不存在的固定查询字符串');
assert.match(source, /优企云数字化管理系统/, '上线后验证必须确认当前品牌页面');
assert.doesNotMatch(source, /发起离职流程/, '上线后验证不应依赖已失效的旧前端文案');
assert.match(source, /HTTP 401/, '上线后验证必须保留未授权访问拦截');
assert.doesNotMatch(source, /\$[A-Z_]+[，。；：]/, 'Shell变量紧邻中文标点时必须使用花括号，避免变量名被错误延长');

// 部署使用严格 umask，新增静态目录必须在覆盖代码后恢复为 Nginx 可读。
const permissionScript = path.resolve(__dirname, '../scripts/normalize-public-permissions.sh');
assert.match(deploySource, /normalize-public-permissions\.sh/, '生产部署未执行公开静态目录权限规范化');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'moluo-public-permissions-'));
try {
  const nestedDir = path.join(fixtureRoot, 'js', 'views');
  const staticFile = path.join(nestedDir, 'roster.js');
  fs.mkdirSync(nestedDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(staticFile, 'window.test = true;\n', { mode: 0o600 });
  execFileSync('bash', [permissionScript, fixtureRoot]);
  assert.equal(fs.statSync(nestedDir).mode & 0o777, 0o755, '静态子目录必须允许 Nginx 进入');
  assert.equal(fs.statSync(staticFile).mode & 0o777, 0o644, '静态文件必须允许 Nginx 读取');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('post-deploy-verification-contract-tests-ok');
