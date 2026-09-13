const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');

for (const [id, permission] of [
  ['createTalentButton', 'employee:create'],
  ['createChannelButton', 'employee:create'],
  ['createBlacklistButton', 'blacklist:manage'],
  ['batchBlacklistButton', 'blacklist:manage'],
  ['quickAddBlacklist', 'blacklist:manage'],
  ['quickBatchBlacklist', 'blacklist:manage']
]) {
  assert.match(
    html,
    new RegExp(`id="${id}"[^>]*data-action-perm="${permission}"`),
    `${id} 未与后端操作权限 ${permission} 对齐`
  );
}

assert.match(html, /id="createPermissionUserButton"[^>]*class="[^"]*hidden/, '权限页新增账号按钮初始状态应隐藏，避免只读账号闪现');
assert.match(app, /const canEditChannels = isCompanyAdmin \|\| permissions\.includes\('employee:update'\)/, '招聘渠道编辑按钮没有按 employee:update 控制');
assert.match(app, /canEditChannels \? `<button class="table-button" data-edit-channel=/, '招聘渠道只读账号仍会看到编辑按钮');
assert.match(app, /const canAssignOnsite = isCompanyAdmin;/, '派遣驻厂入口没有与企业管理员后端限制保持一致');
assert.doesNotMatch(app, /const canAssignOnsite = isCompanyAdmin[\s\S]{0,120}system:role/, '派遣驻厂仍错误依赖可被误配的 system:role 权限');
assert.match(app, /canCreateEmployee \? '无需处理' : '只读'/, '人才库只读账号仍显示误导性的“无需处理”');

console.log('web-action-permission-alignment-tests-ok');
