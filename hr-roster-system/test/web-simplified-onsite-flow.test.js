const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const operations = read('src/services/operations.service.js');

assert.doesNotMatch(html, /id="complianceModal"|id="contractModal"|id="socialModal"/, '网页仍保留合同或雇主险办理弹窗');
assert.doesNotMatch(app, /submitOnboardingCompliance|openContractModal|openSocialModal|loadWorkTasks/, '网页仍保留已取消的驻厂合规办理脚本');
assert.doesNotMatch(html, /id="riskView"|id="riskStatusFilter"|id="riskTableBody"/, '网页仍保留已下线风险页面');
assert.doesNotMatch(operations, /ONBOARDING_COMPLIANCE: \['合同和雇主险待确认'/, '工作台仍配置已停用的合并合规待办');
assert.match(
  operations,
  /filter\(item => !\['CONTRACT', 'INSURANCE', 'ONBOARDING_COMPLIANCE'\]\.includes\(item\.taskType\)\)/,
  '工作台未从生命周期队列排除合同、雇主险和合规待办'
);
assert.match(
  operations,
  /filter\(item => item\.taskType !== 'INSURANCE_TERMINATION'\)/,
  '工作台未从生命周期队列排除离职减保待办'
);

console.log('web-simplified-onsite-flow-tests-ok');
