const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('public/index.html');
const app = read('public/app.js');
const service = read('src/services/employee.service.js');
const desktopEmployeeForm = html.match(/<form[^>]+id="employeeForm"[\s\S]*?<\/form>/)?.[0] || '';
const mobileEmployeeForm = html.match(/<form[^>]+id="mobileEmployeeForm"[\s\S]*?<\/form>/)?.[0] || '';

assert.doesNotMatch(app, /const requiredOnCreate = \['idCardNo', 'phone'\]/, '网页端仍把手机号设置为新增必填');
assert.match(app, /const requiredOnCreate = name === 'idCardNo'/, '网页端没有保留身份证新增必填规则');
assert.doesNotMatch(html, /“面试”只需姓名和手机号/, '网页端仍提示面试必须填写手机号');
assert.doesNotMatch(desktopEmployeeForm, /<input name="phone"[^>]*required/, '电脑网页新增员工手机号仍带 required');
assert.doesNotMatch(mobileEmployeeForm, /<input name="phone"[^>]*required/, '手机 Web 新增员工手机号仍带 required');
assert.match(desktopEmployeeForm, /name="selectedTalentId"/, '电脑网页员工表单缺少人才库候选关联字段');
assert.match(mobileEmployeeForm, /name="selectedTalentId"/, '手机 Web 员工表单缺少人才库候选关联字段');

assert.match(app, /async function checkWebTalentCandidates/, '网页端缺少人才库候选预检查');
assert.match(app, /\/api\/employees\/precheck/, '网页端没有调用员工预检查接口');
assert.match(app, /function applyWebTalentCandidate/, '网页端缺少人才库信息拉取逻辑');
assert.match(app, /selectedTalentId/, '网页端创建员工没有提交所选人才记录');
assert.match(app, /function resetWebTalentSelection/, '网页端修改姓名或身份证后没有清除旧人才关联');
assert.match(app, /name !== 'name' && name !== 'idCardNo'/, '网页端未监听身份字段变化');
assert.match(app, /saveEmployee[\s\S]*checkWebTalentCandidates/, '电脑网页保存员工前未检查人才库候选');
assert.match(app, /submitMobileEmployee[\s\S]*checkWebTalentCandidates/, '手机 Web 保存员工前未检查人才库候选');

assert.match(service, /function talentCandidateScope/, '人才库候选没有统一数据范围函数');
assert.match(service, /sys_user_project[\s\S]*project_id=\$\{alias\}\.project_id/, '驻厂人员不能查看授权项目的人才候选');
assert.match(service, /\$\{alias\}\.owner_user_id=:scopeUserId/, '非全量账号未保留本人录入候选范围');

console.log('web-optional-phone-talent-prefill-tests-ok');
