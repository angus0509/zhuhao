const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const routes = fs.readFileSync('src/routes/operations.routes.js', 'utf8');
const serviceSource = fs.readFileSync('src/services/sms-delivery.service.js', 'utf8');
const { createSmsDeliveryService } = require('../src/services/sms-delivery.service');

assert.match(routes, /get\('\/payroll\/batches\/:id\/sms-summary'[\s\S]*requirePermission\('payroll:view'\)/);
assert.match(routes, /post\('\/payroll\/batches\/:id\/sms-reminders'[\s\S]*sensitiveLimiter[\s\S]*requirePermission\('payroll:manage'\)/);
assert.match(routes, /post\('\/payroll\/batches\/:id\/sms-retry'[\s\S]*sensitiveLimiter[\s\S]*requirePermission\('payroll:manage'\)/);
assert.match(serviceSource, /projectScope\(user, params, 'p'\)/,
  '短信管理必须复用工资批次项目数据范围');
assert.match(serviceSource, /confirmed !== true/);
assert.match(serviceSource, /> 500/);
assert.match(serviceSource, /receipt_status=1/);
assert.doesNotMatch(serviceSource, /SELECT[^;]*e\.phone\s+phone[^;]*sms-summary/i,
  '短信统计不得返回完整手机号');

const service = createSmsDeliveryService({ db: {} });
Promise.all([
  assert.rejects(
    () => service.enqueueReminderJobs({ companyId: 1, batchId: 7, operatorId: 9, user: {}, confirmed: false }),
    /请确认/
  ),
  assert.rejects(
    () => service.retryFailedJobs({ companyId: 1, batchId: 7, operatorId: 9, user: {}, confirmed: false }),
    /请确认/
  )
]).then(() => {
  console.log('payroll-sms-management-tests-ok');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
