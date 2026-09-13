const fs = require('fs');
const path = require('path');
const migration = fs.readFileSync(path.join(__dirname, '..', 'sql', 'migrate-wechat-official-notification-20260827.mysql.sql'), 'utf8');
const env = fs.readFileSync(path.join(__dirname, '..', '.env.production.example'), 'utf8');
for (const table of ['employee_official_binding', 'wechat_official_notification_job']) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`).test(migration)) throw new Error(`缺少${table}`);
}
for (const index of ['uk_company_employee_official', 'uk_official_notification_dedupe']) {
  if (!migration.includes(index)) throw new Error(`缺少去重索引${index}`);
}
for (const key of ['WECHAT_OFFICIAL_ENABLED', 'WECHAT_OFFICIAL_APPID', 'WECHAT_OFFICIAL_SECRET', 'WECHAT_OFFICIAL_TEMPLATE_PAYSLIP_PUBLISHED', 'WECHAT_OFFICIAL_TEMPLATE_PAYSLIP_REMINDER', 'WECHAT_OFFICIAL_REDIRECT_URI']) {
  if (!env.includes(`${key}=`)) throw new Error(`缺少配置${key}`);
}
console.log('wechat-official-schema-tests-ok');
