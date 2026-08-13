const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const operations = read('src/services/operations.service.js');

assert.match(html, /id="complianceModal"/, '网页缺少合同和雇主险合并办理弹窗');
assert.match(html, /name="contractDate"[\s\S]*name="insuranceStartDate"/, '合并办理弹窗字段不完整');
assert.match(app, /async function submitOnboardingCompliance\(/, '网页缺少一键合规提交函数');
assert.match(app, /\/onboarding-compliance\/confirm/, '网页未调用合并合规接口');
assert.match(app, /data-action="compliance"/, '员工详情或风险中心缺少一键合规入口');
assert.match(
  app,
  /canContract && canInsurance[\s\S]*一键确认合同和雇主险/,
  '风险中心未按双权限提供合并办理入口'
);
assert.match(app, /ONBOARDING_COMPLIANCE[\s\S]*一键确认办理/, '网页待办中心未识别合并合规待办');
assert.match(operations, /ONBOARDING_COMPLIANCE: \['合同和雇主险待确认'/, '工作台未配置合并合规待办');
assert.match(
  operations,
  /filter\(item => !\['CONTRACT', 'INSURANCE', 'ONBOARDING_COMPLIANCE'\]\.includes\(item\.taskType\)\)/,
  '工作台未从生命周期队列排除合规待办'
);

console.log('web-simplified-onsite-flow-tests-ok');
