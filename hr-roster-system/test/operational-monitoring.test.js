const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const response = fs.readFileSync(path.join(root, 'src/utils/response.js'), 'utf8');

assert(app.includes("db.first('SELECT 1 AS ok')"), '健康检查未验证数据库连接');
assert(app.includes("database: 'connected'"), '健康检查未返回数据库健康状态');
assert(app.includes('uptimeSeconds: Math.floor(process.uptime())'), '健康检查缺少服务运行时长');
assert(app.includes('res.status(503)'), '数据库异常时健康检查未返回 503');
assert(!app.includes('execSync('), '健康检查不得执行系统命令');
assert(!app.includes('data: { error:'), '健康检查不得向公网返回数据库错误原文');
assert(response.includes('function logApiError('), '缺少服务端错误日志收集');
assert(response.includes("split('?')[0]"), '错误日志未移除查询参数');
assert(response.includes('不记录请求体、查询参数、Token'), '错误日志缺少敏感信息保护说明');

console.log('operational-monitoring-tests-ok');
