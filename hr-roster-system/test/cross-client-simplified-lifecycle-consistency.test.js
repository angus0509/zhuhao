const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('src/services/employee.service.js');
const migration = read('sql/migrate-simplified-onsite-flow-20260813.mysql.sql');

const onboard = service.match(/async function onboardEmployee[\s\S]*?\n}\n\nasync function handleInterviewResult/)?.[0] || '';
assert.match(onboard, /!\[1, 6\]\.includes\(Number\(employee\.employee_status\)\)[\s\S]*已不在待到岗状态/, '确认入职必须只允许待到岗或历史面试员工');
assert.match(service, /INTERVIEW_REJECTED[\s\S]*talentSourceType: 'INTERVIEW_REJECTED'/, '人才库必须区分面试未通过来源');

const miniTasksPath = path.join(root, 'wechat-miniprogram/miniprogram/pages/tasks/index.js');
if (fs.existsSync(miniTasksPath)) {
  const contracts = read('scripts/check-miniprogram-contracts.js');
  for (const route of [["put", '/employees/:id/arrival-result']]) {
    assert.ok(contracts.includes(`["${route[0]}", '${route[1]}']`), `小程序契约检查缺少接口：${route[0].toUpperCase()} ${route[1]}`);
  }
}

assert.doesNotMatch(migration, /UPDATE hr_work_task[\s\S]*EXISTS \([\s\S]*FROM hr_work_task merged/, '迁移不能在更新同表时直接子查询同表');
assert.match(migration, /JOIN \([\s\S]*ONBOARDING_COMPLIANCE[\s\S]*\) merged/, '迁移应通过派生表关闭旧待办');

console.log('cross-client-simplified-lifecycle-consistency-tests-ok');
