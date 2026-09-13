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

console.log('web-talent-onboarding-entry-tests-ok');
