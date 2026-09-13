const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/services/operations.service.js', 'utf8');
const start = source.indexOf('async function publishPayrollBatch');
const end = source.indexOf('\nasync function submitPayrollBatch', start);
const publishSource = source.slice(start, end);

assert.match(source, /require\('\.\/sms-delivery\.service'\)/);
assert.match(publishSource, /enqueuePublishedJobs\(connection/,
  '工资发布事务必须同步创建短信任务');
assert.doesNotMatch(publishSource, /sendTemplate|SendSms/,
  '工资发布HTTP请求不得直接调用腾讯云');
assert.match(publishSource, /smsQueued/);
assert.match(publishSource, /smsSkippedNoPhone/);

console.log('payroll-publish-sms-isolation-tests-ok');
