const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('wechat-miniprogram/miniprogram/pages/employees/contract/index.js');
const wxml = read('wechat-miniprogram/miniprogram/pages/employees/contract/index.wxml');
const wxss = read('wechat-miniprogram/miniprogram/pages/employees/contract/index.wxss');
const onboardJs = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.js');
const onboardWxml = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.wxml');

const saveStart = js.indexOf('async saveContract()');
const saveEnd = js.indexOf('async uploadSavedContractAttachment', saveStart);
const saveBlock = js.slice(saveStart, saveEnd);
assert.match(saveBlock, /const signStatus = SIGN_STATUS_VALUES\[this\.data\.signStatusIndex\]/, '保存合同时仍使用未定义的签署状态');
assert.match(saveBlock, /data:\s*\{ signStatus, contractDate: form\.contractDate \}/, '合同保存请求未提交当前签署状态');
assert.ok(js.includes("loadError: ''") && js.includes("submitError: ''"), '合同读取错误与保存错误仍共用同一状态');
assert.match(wxml, /wx:elif="\{\{loadError\}\}"/, '合同读取错误未独立展示');
assert.match(wxml, /wx:if="\{\{submitError\}\}"/, '合同保存错误会导致表单消失');
assert.ok(wxml.includes('class="sign-status-options"'), '合同签署状态仍需要打开下拉框');
assert.ok(wxss.includes('.sign-option.active'), '合同签署状态缺少明确选中反馈');
assert.match(js, /wx\.redirectTo\(\{ url: `\/pages\/employees\/insurance\/index\?id=\$\{this\.data\.employeeId\}&action=ADD` \}\)/, '合同登记后不能连续办理雇主险');
assert.ok(onboardJs.includes('onboardingChecked: false'), '入职页未合并重复核验操作');
assert.ok(onboardJs.includes('toggleOnboardingCheck()'), '入职资料缺少一次确认入口');
assert.ok(!onboardJs.includes('toggleIdentity()') && !onboardJs.includes('toggleJob()'), '入职页仍要求两次重复核验');
assert.ok(onboardWxml.includes('入职资料已核验'), '入职页未显示合并后的核验内容');

console.log('miniprogram-contract-save-fix-tests-ok');
