const fs = require('fs');
const path = require('path');
const scheduler = require('../src/scheduler');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const beforeRun = new Date(2026, 7, 4, 1, 30, 0, 0);
assert(scheduler.millisecondsUntilNextRun(beforeRun) === 30 * 60 * 1000, '凌晨2点前应安排当天扫描');

const afterRun = new Date(2026, 7, 4, 2, 30, 0, 0);
assert(scheduler.millisecondsUntilNextRun(afterRun) === 23.5 * 60 * 60 * 1000, '凌晨2点后应安排次日扫描');

const schedulerSource = read('src/scheduler.js');
assert(schedulerSource.includes("SELECT id FROM hr_company WHERE status=1"), '定时扫描未覆盖全部启用企业');
assert(schedulerSource.includes('previous_scan_running'), '定时扫描缺少并发重入保护');
assert(schedulerSource.includes('hr_risk_scan_log'), '定时扫描未写执行日志');

const appSource = read('src/app.js');
assert(appSource.includes("env.nodeEnv === 'production'"), '定时任务未限制为生产环境启动');
assert(appSource.includes("require('./scheduler').startScheduler()"), '生产服务未启动风险调度器');

const frontend = read('public/app.js');
const bootBlock = frontend.slice(frontend.indexOf('async function bootAuthedApp()'));
assert(!bootBlock.includes('scanRisks().catch'), '登录流程仍会重复触发风险扫描');

const compose = read('docker-compose.prod.yml');
assert(compose.includes('TZ: Asia/Shanghai'), '生产容器未固定中国时区');

const migration = read('sql/migrate-risk-scan-log-20260804.mysql.sql');
assert(migration.includes('CREATE TABLE IF NOT EXISTS hr_risk_scan_log'), '缺少风险扫描日志迁移');

console.log('每日风险扫描、执行日志、时区与防重入检查通过。');
