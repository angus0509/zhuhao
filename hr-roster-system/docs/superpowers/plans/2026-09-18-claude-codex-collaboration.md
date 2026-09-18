# Claude 与 Codex 安全协作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的 Claude 与 Codex 隔离协作规则、任务交接模板和只读状态检查工具落地到项目中。

**Architecture:** 使用项目级 `AGENTS.md` 约束所有代理，用独立 Markdown 模板传递任务边界，并用单一 Bash 脚本只读输出仓库、分支、提交和高冲突文件状态。脚本不读取文件内容，不访问环境变量文件，不执行 Git 写操作；Node.js 契约测试同时验证文档约束和脚本运行时安全。

**Tech Stack:** Markdown、Bash、Node.js 24、`node:assert/strict`、Git

**Spec:** `docs/superpowers/specs/2026-09-18-claude-codex-collaboration-design.md`

## Global Constraints

- 必须在独立 Worktree 和 `codex/claude-codex-collaboration` 分支执行，不得在有未提交考勤改动的集成目录直接开发。
- 一个任务只能有一个主开发者，另一方默认只读审核。
- 不得使用 `git reset --hard`、`git checkout --`、`git clean` 或批量覆盖文件。
- 使用显式文件列表暂存，禁止在计划步骤中使用 `git add .`。
- 脚本不得读取或输出 `.env`、Token、身份证、手机号、银行卡或工资数据。
- 不实现自动合并、自动推送、自动部署、自动上传小程序或自动清理工作区。
- 本计划只修改协作规则、模板、只读脚本、测试和 `package.json` 测试入口。

## File Map

| 文件 | 操作 | 职责 |
|---|---|---|
| `AGENTS.md` | 修改 | 增加 Claude/Codex 双代理硬性协作规则 |
| `docs/collaboration/TASK-HANDOFF-TEMPLATE.md` | 新建 | 提供每项任务可复制的交接单 |
| `scripts/collaboration-status.sh` | 新建 | 只读输出目录、分支、HEAD、改动数量和高冲突文件 |
| `test/collaboration-docs.test.js` | 新建 | 验证项目规则和交接模板完整性 |
| `test/collaboration-status-script.test.js` | 新建 | 在临时 Git 仓库验证脚本只读、安全和输出契约 |
| `package.json` | 修改 | 将两项协作契约测试加入 `npm run check` |

## Execution Preflight

从包含本计划的最新提交创建独立 Worktree。原仓库根目录是 `/Users/zhuhao/Documents/moluo`，项目位于其 `hr-roster-system` 子目录：

```bash
cd /Users/zhuhao/Documents/moluo
BASE_COMMIT="$(git rev-parse HEAD)"
git worktree add -b codex/claude-codex-collaboration \
  /Users/zhuhao/CodexWorktrees/hr-roster-collaboration "$BASE_COMMIT"
cd /Users/zhuhao/CodexWorktrees/hr-roster-collaboration/hr-roster-system
git status --short --branch
```

Expected: 新 Worktree 位于 `codex/claude-codex-collaboration`，且没有未提交改动。集成目录中原有的考勤测试改动保持不变。

---

### Task 1: 固化项目规则与任务交接模板

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/collaboration/TASK-HANDOFF-TEMPLATE.md`
- Create: `test/collaboration-docs.test.js`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-09-18-claude-codex-collaboration-design.md`
- Produces: `AGENTS.md` 中的 `## 9. Claude 与 Codex 协作规则`；可复制的任务交接模板

- [ ] **Step 1: 写文档契约失败测试**

创建 `test/collaboration-docs.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');

const agents = fs.readFileSync('AGENTS.md', 'utf8');
const templatePath = 'docs/collaboration/TASK-HANDOFF-TEMPLATE.md';

assert.match(agents, /## 9\. Claude 与 Codex 协作规则/);
for (const rule of [
  '独立 Worktree',
  '一个任务只能有一个主开发者',
  '禁止使用 `git add .`',
  '单一发布人',
  '不得对同一版本重复部署',
  'git reset --hard',
  'git checkout --',
  'git clean'
]) {
  assert.ok(agents.includes(rule), `AGENTS.md 缺少规则：${rule}`);
}

assert.equal(fs.existsSync(templatePath), true, '缺少任务交接模板');
const template = fs.readFileSync(templatePath, 'utf8');
for (const field of [
  '任务名称：', '主开发者：', '审核者：', '基础提交：', '工作目录：', '工作分支：',
  '允许修改：', '禁止修改：', '高冲突文件占用：', '数据库影响：',
  '允许提交：', '允许推送：', '允许部署：', '允许上传小程序：', '完成标准：'
]) {
  assert.ok(template.includes(field), `交接模板缺少字段：${field}`);
}
assert.match(template, /本地修改：[\s\S]*本地提交：[\s\S]*交叉审核：[\s\S]*完整测试：[\s\S]*远程推送：[\s\S]*Web\/API部署：[\s\S]*小程序上传：[\s\S]*生产验收：/);

console.log('collaboration-docs-tests-ok');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node test/collaboration-docs.test.js`

Expected: FAIL，首先提示 `AGENTS.md` 缺少 `## 9. Claude 与 Codex 协作规则`。

- [ ] **Step 3: 在 AGENTS.md 增加最小硬性规则**

在现有第 8 节后新增：

```markdown
## 9. Claude 与 Codex 协作规则

- Claude、Codex 和集成发布必须使用独立 Worktree 与独立分支；集成目录不用于双方同时开发。
- 一个任务只能有一个主开发者，另一方默认只读审核；代为修复必须获得用户明确授权并使用独立提交。
- 每项任务必须声明基础提交、工作目录、分支、允许修改、禁止修改、高冲突文件占用和发布权限。
- `public/app.js`、`src/services/operations.service.js`、`package.json`、数据库迁移和部署脚本同一时间只能由一个任务占用。
- 交接只接受明确提交号，禁止通过复制整个文件覆盖另一方改动。
- 使用显式文件列表暂存，禁止使用 `git add .`。
- 禁止使用 `git reset --hard`、`git checkout --`、`git clean` 清理另一方或用户改动。
- 本地修改、提交、交叉审核、完整测试、远程推送、Web/API 部署和小程序上传必须分别汇报。
- 每次生产发布只指定一个单一发布人；另一方只能复核，不得对同一版本重复部署。
- 推送、生产 SSH、数据库迁移、Web/API 部署和小程序上传均需用户单独明确确认。
```

- [ ] **Step 4: 新建任务交接模板**

创建 `docs/collaboration/TASK-HANDOFF-TEMPLATE.md`：

```markdown
# Claude / Codex 任务交接单

任务名称：
主开发者：Claude / Codex
审核者：Codex / Claude
基础提交：
工作目录：
工作分支：

## 范围

本次目标：
允许修改：
禁止修改：
高冲突文件占用：
数据库影响：无 / 有，迁移文件：

## 权限

允许提交：是 / 否
允许推送：是 / 否
允许部署：是 / 否
允许上传小程序：是 / 否

## 完成标准：

1. 专项测试通过
2. `npm run check` 通过
3. `git diff --check` 通过
4. 提供提交号、测试证据和遗留问题

## 完成状态

本地修改：有 / 无
本地提交：提交号 / 无
交叉审核：通过 / 未执行 / 有待修复项
完整测试：通过 / 未执行 / 失败
远程推送：已推送 / 未推送
Web/API部署：已部署 / 未部署
小程序上传：已上传 / 未上传
生产验收：通过 / 未执行 / 失败
遗留风险：
```

- [ ] **Step 5: 运行文档契约测试**

Run: `node test/collaboration-docs.test.js`

Expected: PASS，输出 `collaboration-docs-tests-ok`。

- [ ] **Step 6: 检查差异并提交**

```bash
git diff --check
git add AGENTS.md docs/collaboration/TASK-HANDOFF-TEMPLATE.md test/collaboration-docs.test.js
git commit -m "docs: enforce Claude Codex collaboration boundaries"
```

Expected: 只提交本任务三个文件。

---

### Task 2: 新增只读协作状态检查脚本

**Files:**
- Create: `scripts/collaboration-status.sh`
- Create: `test/collaboration-status-script.test.js`

**Interfaces:**
- Consumes: 可选位置参数 `[repository-path]`，省略时使用当前目录
- Produces: `workspace_root`、`branch`、`owner`、`head`、`worktree_state`、`tracked_changes`、`high_conflict_files`

- [ ] **Step 1: 写脚本运行时失败测试**

创建 `test/collaboration-status-script.test.js`：

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve('scripts/collaboration-status.sh');
assert.equal(fs.existsSync(script), true, '缺少协作状态检查脚本');
const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(source, /git\s+(?:reset|clean|checkout)|rm\s+-[a-z]*r|\.env|cat\s+/i,
  '协作检查脚本包含写操作或敏感文件读取');

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'collaboration-status-'));
const run = (command, args) => spawnSync(command, args, { cwd: repo, encoding: 'utf8' });
assert.equal(run('git', ['init', '-b', 'codex/safe-test']).status, 0);
fs.mkdirSync(path.join(repo, 'public'), { recursive: true });
fs.writeFileSync(path.join(repo, 'public/app.js'), 'console.log("safe");\n');
fs.writeFileSync(path.join(repo, '.env'), 'DO_NOT_PRINT=secret-marker\n');
assert.equal(run('git', ['add', 'public/app.js']).status, 0);
assert.equal(run('git', [
  '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
  'commit', '-m', 'test: seed repository'
]).status, 0);

fs.appendFileSync(path.join(repo, 'public/app.js'), 'console.log("dirty");\n');
const statusBefore = run('git', ['status', '--short']).stdout;
const result = spawnSync('bash', [script, repo], { encoding: 'utf8' });
const statusAfter = run('git', ['status', '--short']).stdout;

assert.equal(result.status, 0, result.stderr);
assert.equal(statusAfter, statusBefore, '脚本不得改变工作区状态');
assert.match(result.stdout, /branch=codex\/safe-test/);
assert.match(result.stdout, /owner=Codex/);
assert.match(result.stdout, /head=[0-9a-f]{7,40}/);
assert.match(result.stdout, /worktree_state=dirty/);
assert.match(result.stdout, /tracked_changes=1/);
assert.match(result.stdout, /high_conflict_files=public\/app\.js/);
assert.doesNotMatch(result.stdout + result.stderr, /secret-marker|DO_NOT_PRINT/);

fs.rmSync(repo, { recursive: true, force: true });
console.log('collaboration-status-script-tests-ok');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node test/collaboration-status-script.test.js`

Expected: FAIL，提示 `缺少协作状态检查脚本`。

- [ ] **Step 3: 实现只读状态检查脚本**

创建 `scripts/collaboration-status.sh`：

```bash
#!/bin/bash
set -euo pipefail

REPOSITORY_PATH="${1:-.}"
git -C "$REPOSITORY_PATH" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "错误: 目标不是 Git 工作区" >&2
  exit 1
}

WORKSPACE_ROOT="$(git -C "$REPOSITORY_PATH" rev-parse --show-toplevel)"
BRANCH="$(git -C "$REPOSITORY_PATH" symbolic-ref --quiet --short HEAD || printf 'DETACHED')"
HEAD_COMMIT="$(git -C "$REPOSITORY_PATH" rev-parse --short=12 HEAD)"
case "$BRANCH" in
  claude/*) OWNER="Claude" ;;
  codex/*) OWNER="Codex" ;;
  integration/*) OWNER="Integration" ;;
  *) OWNER="Unassigned" ;;
esac

TRACKED_STATUS="$(git -C "$REPOSITORY_PATH" status --short --untracked-files=no)"
if [ -n "$TRACKED_STATUS" ]; then
  WORKTREE_STATE="dirty"
  TRACKED_CHANGES="$(printf '%s\n' "$TRACKED_STATUS" | awk 'NF { count += 1 } END { print count + 0 }')"
else
  WORKTREE_STATE="clean"
  TRACKED_CHANGES=0
fi

HIGH_CONFLICT_FILES="$(
  git -C "$REPOSITORY_PATH" status --porcelain=v1 --untracked-files=no \
    | cut -c4- \
    | awk '
      $0 == "public/app.js" || $0 == "public/index.html" || $0 == "public/styles.css" ||
      $0 == "src/services/operations.service.js" || $0 == "package.json" ||
      $0 == "sql/schema.mysql.sql" || $0 == "scripts/build-release-package.sh" ||
      $0 == "scripts/verify-release-package.sh" || $0 == "scripts/deploy-production.sh" { print }
    ' \
    | paste -sd, -
)"

printf 'workspace_root=%s\n' "$WORKSPACE_ROOT"
printf 'branch=%s\n' "$BRANCH"
printf 'owner=%s\n' "$OWNER"
printf 'head=%s\n' "$HEAD_COMMIT"
printf 'worktree_state=%s\n' "$WORKTREE_STATE"
printf 'tracked_changes=%s\n' "$TRACKED_CHANGES"
printf 'high_conflict_files=%s\n' "${HIGH_CONFLICT_FILES:-none}"
```

- [ ] **Step 4: 运行 Shell 语法与运行时测试**

```bash
bash -n scripts/collaboration-status.sh
node test/collaboration-status-script.test.js
```

Expected: 两条命令均为 exit 0，测试输出 `collaboration-status-script-tests-ok`。

- [ ] **Step 5: 在当前 Worktree 进行只读试运行**

```bash
bash scripts/collaboration-status.sh .
git status --short --untracked-files=no
```

Expected:

- `branch=codex/claude-codex-collaboration`
- `owner=Codex`
- 脚本执行前后 Git 状态一致
- 输出中不包含任何文件内容或敏感值

- [ ] **Step 6: 提交脚本和测试**

```bash
git diff --check
git add scripts/collaboration-status.sh test/collaboration-status-script.test.js
git commit -m "feat: add read-only collaboration status check"
```

Expected: 只提交脚本及其运行时测试。

---

### Task 3: 接入全量检查并完成协作验收

**Files:**
- Modify: `package.json`
- Modify: `test/collaboration-docs.test.js`
- Test: `test/collaboration-status-script.test.js`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的两个 Node.js 测试入口
- Produces: `npm run check` 自动执行协作文档与脚本契约

- [ ] **Step 1: 写测试入口失败断言**

在 `test/collaboration-docs.test.js` 的 `console.log` 前增加：

```js
const packageJson = require('../package.json');
assert.match(packageJson.scripts.check, /node test\/collaboration-docs\.test\.js/,
  '完整检查未包含协作文档契约');
assert.match(packageJson.scripts.check, /node test\/collaboration-status-script\.test\.js/,
  '完整检查未包含协作脚本运行时契约');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node test/collaboration-docs.test.js`

Expected: FAIL，提示 `完整检查未包含协作文档契约`。

- [ ] **Step 3: 将测试加入 package.json**

在 `package.json` 的 `check` 命令中，将以下两个命令放在 JavaScript 语法检查之后、其他业务测试之前：

```text
node test/collaboration-docs.test.js && node test/collaboration-status-script.test.js &&
```

不得调整其他测试顺序或删除现有测试。

- [ ] **Step 4: 运行专项检查**

```bash
node test/collaboration-docs.test.js
bash -n scripts/collaboration-status.sh
node test/collaboration-status-script.test.js
git diff --check
```

Expected: 全部 exit 0，两个 Node.js 测试分别输出 `collaboration-docs-tests-ok` 和 `collaboration-status-script-tests-ok`。

- [ ] **Step 5: 运行完整项目检查**

```bash
npm run check
npm audit --audit-level=high
```

Expected: `npm run check` exit 0；`npm audit` 输出 `found 0 vulnerabilities`。

- [ ] **Step 6: 自查敏感信息与危险命令**

```bash
rg -n "git reset --hard|git checkout --|git clean|git add \.|\.env|Token|身份证|手机号|银行卡|工资数据" \
  scripts/collaboration-status.sh test/collaboration-status-script.test.js
```

Expected: 只允许测试中的禁止模式字符串命中；`scripts/collaboration-status.sh` 本身不得命中。

- [ ] **Step 7: 提交检查入口**

```bash
git add package.json test/collaboration-docs.test.js
git commit -m "test: enforce collaboration workflow contracts"
```

Expected: 提交只包含 `package.json` 和文档契约测试入口调整。

- [ ] **Step 8: 最终交付检查**

```bash
git log -3 --oneline
git status --short --branch
bash scripts/collaboration-status.sh .
```

Expected:

- 最近三个提交分别对应规则模板、只读脚本、测试入口
- 当前协作 Worktree 没有未提交改动
- 未执行远程推送、生产部署或小程序上传
