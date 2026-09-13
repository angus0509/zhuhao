const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const response = fs.readFileSync(path.join(root, 'src/utils/response.js'), 'utf8');
const healthHandler = app.slice(app.indexOf("app.get('/api/health'"), app.indexOf("app.use('/api', apiRoutes)"));

assert(app.includes("db.first('SELECT 1 AS ok')"), '健康检查未验证数据库连接');
assert(healthHandler.includes('res.status(200).end()'), '数据库正常时健康检查应只返回 HTTP 200 空响应');
assert(healthHandler.includes('res.status(503).end()'), '数据库异常时健康检查应只返回 HTTP 503 空响应');
for (const leakedMarker of ["service: 'hr-roster-system'", "mode: 'express-mysql'", "database: 'connected'", 'uptimeSeconds']) {
  assert(!healthHandler.includes(leakedMarker), `健康检查泄露内部信息：${leakedMarker}`);
}
assert(!app.includes('execSync('), '健康检查不得执行系统命令');
assert(!app.includes('data: { error:'), '健康检查不得向公网返回数据库错误原文');
assert(response.includes('function logApiError('), '缺少服务端错误日志收集');
assert(response.includes("split('?')[0]"), '错误日志未移除查询参数');
assert(response.includes('不记录请求体、查询参数、Token'), '错误日志缺少敏感信息保护说明');

console.log('operational-monitoring-tests-ok');
