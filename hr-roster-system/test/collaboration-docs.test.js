const assert = require('node:assert/strict');
const fs = require('node:fs');

const agents = fs.readFileSync('AGENTS.md', 'utf8');
const templatePath = 'docs/collaboration/TASK-HANDOFF-TEMPLATE.md';

assert.match(agents, /^## 9\. Claude 与 Codex 协作规则$/m);

const requiredRules = [
  /独立 Worktree.*独立分支/,
  /一个任务只能有一个主开发者.*只读审核/,
  /显式文件列表暂存.*禁止使用 `git add \.`/,
  /禁止使用 `git reset --hard`、`git checkout --`、`git clean`/,
  /单一发布人.*不得对同一版本重复部署/,
  /本地修改.*提交.*完整测试.*远程推送.*Web\/API 部署.*小程序上传/
];
for (const rule of requiredRules) {
  assert.match(agents, rule, `AGENTS.md 缺少协作规则：${rule}`);
}

assert.equal(fs.existsSync(templatePath), true, '缺少任务交接模板');
const template = fs.readFileSync(templatePath, 'utf8');

const requiredFields = [
  '任务名称：',
  '主开发者：',
  '审核者：',
  '基础提交：',
  '工作目录：',
  '工作分支：',
  '允许修改：',
  '禁止修改：',
  '高冲突文件占用：',
  '数据库影响：',
  '允许提交：',
  '允许推送：',
  '允许生产 SSH：',
  '允许数据库迁移：',
  '允许部署：',
  '允许上传小程序：',
  '完成标准：'
];
for (const field of requiredFields) {
  assert.ok(template.includes(field), `交接模板缺少字段：${field}`);
}

assert.match(
  template,
  /本地修改：[\s\S]*本地提交：[\s\S]*交叉审核：[\s\S]*完整测试：[\s\S]*远程推送：[\s\S]*生产 SSH：[\s\S]*数据库迁移：[\s\S]*Web\/API部署：[\s\S]*小程序上传：[\s\S]*生产验收：/
);

const packageJson = require('../package.json');
assert.match(
  packageJson.scripts.check,
  /node test\/collaboration-docs\.test\.js/,
  '完整检查未包含协作文档契约'
);
assert.match(
  packageJson.scripts.check,
  /node test\/collaboration-status-script\.test\.js/,
  '完整检查未包含协作脚本运行时契约'
);

console.log('collaboration-docs-tests-ok');
