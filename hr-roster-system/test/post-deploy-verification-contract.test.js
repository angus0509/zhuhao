const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../scripts/post-deploy-verify.sh'), 'utf8');

assert.match(source, /SECONDARY_BASE_URL/, '上线后验证必须覆盖主域名和 www 域名');
assert.match(source, /"database"[^\n]*"connected"|database.*connected/, '健康检查必须确认数据库已连接');
assert.match(source, /\/js\/views\/roster\.js/, '上线后验证必须读取实际花名册资源');
assert.match(source, /view=activeRoster/, '上线后验证必须确认网页花名册为在职视图');
assert.match(source, /优益数字化管理系统/, '上线后验证必须确认当前品牌页面');
assert.doesNotMatch(source, /发起离职流程/, '上线后验证不应依赖已失效的旧前端文案');
assert.match(source, /HTTP 401/, '上线后验证必须保留未授权访问拦截');
assert.doesNotMatch(source, /\$[A-Z_]+[，。；：]/, 'Shell变量紧邻中文标点时必须使用花括号，避免变量名被错误延长');

console.log('post-deploy-verification-contract-tests-ok');
