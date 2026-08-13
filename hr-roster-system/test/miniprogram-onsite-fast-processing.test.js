const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
const homeWxml = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
const listJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const listWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const addJs = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
const addWxml = read('wechat-miniprogram/miniprogram/pages/employees/add/index.wxml');
const detailJs = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.js');
const detailWxml = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml');
const resignJs = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.js');
const resignWxml = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.wxml');
const service = read('src/services/employee.service.js');
const migration = read('sql/migrate-onsite-fast-processing-20260813.mysql.sql');

for (const label of ['录入新员工', '待到岗', '在职员工', '已离职']) {
  assert.match(homeWxml, new RegExp(label), `工作台缺少快速入口：${label}`);
}
for (const removed of ['驻厂待处理', '合规待办', '驻厂处理队列']) {
  assert.doesNotMatch(homeWxml, new RegExp(removed), `工作台仍显示已取消模块：${removed}`);
}
assert.doesNotMatch(homeJs, /\/work-tasks\?taskStatus=/, '工作台仍加载驻厂处理队列');
assert.doesNotMatch(homeJs, /ONBOARDING_COMPLIANCE|goOnsiteTask|goRiskCenter/, '工作台仍保留合规或待办处理逻辑');

for (const label of ['全部人员', '待到岗', '在职员工', '已离职']) {
  assert.match(listWxml, new RegExp(label), `驻厂状态栏缺少：${label}`);
}
for (const removed of ['面试', '未通过/不做', '一键确认合同和雇主险', '雇主险状态']) {
  assert.doesNotMatch(listWxml, new RegExp(removed), `驻厂页仍显示旧流程：${removed}`);
}
assert.doesNotMatch(listJs, /goCompliance|goInsurance|handleInterviewResult|activeInsurance/, '驻厂页仍保留合规、保险或面试操作');
assert.match(listJs, /const isPending = Number\(item\.employeeStatus\) === 1 \|\| Number\(item\.employeeStatus\) === 6/, '历史面试人员未并入待到岗');
assert.match(listWxml, /isPending[\s\S]*确认入职[\s\S]*未入职/, '待到岗缺少确认入职和未入职操作');
assert.match(listWxml, /isActive[\s\S]*一键办理离职/, '在职员工缺少一键离职操作');

assert.doesNotMatch(addWxml, /录入状态|employeeStatusNames|面试简登/, '新增员工仍允许选择面试或其他状态');
assert.match(addWxml, /保存后进入待到岗/, '新增员工页未说明快速流转结果');
assert.match(addJs, /employeeStatus: 1/, '新增员工未固定提交待到岗状态');
assert.doesNotMatch(addJs, /EMPLOYEE_STATUSES|EMPLOYEE_STATUS_VALUES|onEmployeeStatusChange/, '新增员工仍保留多状态选择逻辑');

assert.doesNotMatch(detailWxml, /登记合同|办理雇主险|合同和雇主险|办理增保/, '员工详情仍显示合同或雇主险办理入口');
assert.doesNotMatch(detailJs, /goContract|goInsurance|goCompliance|canContract|canInsurance|canCompliance/, '员工详情仍保留合规办理逻辑');

assert.doesNotMatch(resignWxml, /雇主险减保|已减保/, '离职页面仍要求雇主险减保确认');
assert.doesNotMatch(resignJs, /terminateEmployerInsurance|employerInsuranceCovered/, '离职请求仍依赖雇主险减保');

const onboardStart = service.indexOf('async function onboardEmployee');
const onboardEnd = service.indexOf('async function handleInterviewResult', onboardStart);
const onboardBlock = service.slice(onboardStart, onboardEnd);
assert.ok(onboardStart >= 0 && onboardEnd > onboardStart, '无法定位确认入职服务');
assert.doesNotMatch(onboardBlock, /createOnboardingCompliance|ONBOARDING_COMPLIANCE|contract_missing:|employer_insurance_missing:/, '确认入职仍生成合同或雇主险合规事项');
assert.match(onboardBlock, /lifecycle_status='ACTIVE'/, '确认入职未直接进入在职状态');

const completionStart = service.indexOf('async function syncResignationCompletion');
const completionEnd = service.indexOf('async function terminateEmployerInsuranceForResignation', completionStart);
const completionBlock = service.slice(completionStart, completionEnd);
assert.ok(completionStart >= 0 && completionEnd > completionStart, '无法定位离职完成服务');
assert.match(completionBlock, /const insuranceDone = true/, '快速离职仍被雇主险状态阻塞');
assert.doesNotMatch(completionBlock, /insurance_status='TERMINATED'/, '快速离职不应伪造雇主险已减保状态');
assert.match(service, /handleArrivalResult[\s\S]*!\[1, 6\]\.includes/, '历史面试人员无法按待到岗标记未入职');
assert.match(migration, /UPDATE hr_work_task[\s\S]*task_type IN \('CONTRACT','INSURANCE','ONBOARDING_COMPLIANCE'\)[\s\S]*task_status IN \(0,1\)/, '迁移未关闭全部开放旧合规待办');
assert.doesNotMatch(migration, /completed\.company_id IS NULL/, '迁移会因历史完成记录而漏掉仍开放的重复待办');

console.log('miniprogram-onsite-fast-processing-tests-ok');
