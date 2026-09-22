const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

assert.match(app, /data-talent-onboard=/, '人才库缺少转入员工录入入口');
assert.match(app, /function openTalentOnboarding\(talentId\)/, '人才库缺少统一转入员工逻辑');
assert.match(app, /form\.elements\.selectedTalentId\.value = String\(talent\.id\)/, '人才转入未关联原人才记录');
assert.match(app, /openExistingEmployeeRecord\(/, '离职或未入职回流人才没有复用已有员工档案');
assert.match(app, /event\.target\.closest\('\[data-talent-onboard\]'\)/, '人才转入按钮缺少点击处理');
assert.match(app, /Number\(item\.employeeStatus\) === 1[\s\S]*data-talent-confirm-onboard=/,
  '人才库待到岗员工缺少确认入职入口');
assert.match(app, /permissions\.includes\('employee:update'\)[\s\S]*data-talent-confirm-onboard=/,
  '人才库确认入职入口没有按 employee:update 权限显示');
assert.match(app, /async function confirmTalentOnboarding\(talentId, button\)/,
  '人才库缺少确认入职处理函数');
assert.match(app, /confirmTalentOnboarding[\s\S]*confirmDialog\([\s\S]*\/api\/employees\/\$\{talent\.employeeId\}\/onboard/,
  '人才库确认入职必须二次确认并复用现有入职接口');
assert.match(app, /confirmTalentOnboarding[\s\S]*loadTalents\(\)[\s\S]*refreshEmployeeWorkspace\(\)/,
  '人才入职成功后没有刷新人才库和员工工作台');
assert.match(app, /event\.target\.closest\('\[data-talent-confirm-onboard\]'\)/,
  '人才库确认入职按钮缺少点击处理');

console.log('web-talent-onboarding-entry-tests-ok');
