const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const addJs = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
const addWxml = read('wechat-miniprogram/miniprogram/pages/employees/add/index.wxml');
const onboardJs = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.js');
const onboardWxml = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.wxml');
const service = read('src/services/employee.service.js');
const controller = read('src/controllers/employee.controller.js');
const migration = read('sql/migrate-optional-employee-phone-20260813.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const releaseVerify = read('scripts/verify-release-package.sh');

assert.match(addJs, /f\.phone\s*&&\s*!\/\^1\[3-9\]/, '手机号为空时仍会触发格式校验');
assert.doesNotMatch(addWxml, /手机号[\s\S]{0,100}class="required"/, '小程序新增员工仍把手机号标为必填');
assert.match(service, /if \(body\.phone && !\/\^1\[3-9\]/, '后端仍要求手机号必须填写');

assert.match(service, /talentCandidates/, '员工预检查未返回人才库候选');
assert.match(service, /t\.name=:name[\s\S]*t\.id_card_hash=:idCardHash/, '人才库候选未按同名或同身份证匹配');
assert.match(controller, /precheckEmployee\(req\.companyId, req\.body, req\.user\)/, '人才库预检查未应用当前账号数据范围');
assert.match(addJs, /checkTalentCandidates/, '新增员工页缺少人才库候选检查');
assert.match(addJs, /applyTalentCandidate/, '新增员工页缺少人才库信息拉取');
assert.match(addWxml, /人才库发现相似人员/, '新增员工页缺少人才库候选提示');
assert.match(service, /selectedTalentId/, '创建员工时未精确关联用户选择的人才库记录');

assert.doesNotMatch(service.match(/async function onboardEmployee[\s\S]*?\n}\n\nasync function handleInterviewResult/)?.[0] || '', /missingFields\.push\('手机号'\)/, '确认入职仍把手机号作为必填');
assert.doesNotMatch(onboardJs, /if \(!basic\.phone\) missingFields\.push\('手机号'\)/, '小程序确认入职仍把手机号列为缺失资料');
assert.match(onboardJs, /showIncompleteProfilePrompt/, '确认入职资料不全时没有可操作提示');
assert.match(onboardJs, /onShow\(\)[\s\S]*loadEmployee\(\)/, '补全资料返回确认页后未自动刷新员工信息');
assert.doesNotMatch(onboardWxml, /disabled="\{\{submitting \|\| !profileComplete\}\}"/, '资料不全时确认入职按钮仍不可点击');
assert.match(onboardWxml, /补全入职信息/, '确认入职页缺少补全资料的明确操作');

assert.match(migration, /ALTER TABLE talent_candidate MODIFY COLUMN phone VARCHAR\(20\) NULL/, '人才库手机号字段仍阻止无手机号员工回流');
assert.match(deploy, /migrate-optional-employee-phone-20260813\.mysql\.sql/, '生产部署未执行手机号可选迁移');
assert.match(releaseVerify, /migrate-optional-employee-phone-20260813\.mysql\.sql/, '发布包未校验手机号可选迁移');
assert.match(service, /canViewSensitiveTalent/, '人才库候选未按敏感信息权限返回身份证和手机号');
assert.match(service, /function talentCandidateScope/, '人才库候选没有统一数据范围函数');
assert.match(service, /sys_user_project[\s\S]*project_id=\$\{alias\}\.project_id/, '驻厂账号无法拉取授权项目的人才信息');

console.log('miniprogram-talent-prefill-onboarding-tests-ok');
