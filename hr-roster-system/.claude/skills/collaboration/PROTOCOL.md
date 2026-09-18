# Claude ⇄ Codex 协作协议

本文件是 `AGENTS.md` §9 的操作落地版，**Claude 与 Codex 双方共用**。
规则冲突时以 `AGENTS.md` 为准；本文件只负责「怎么一步步做」。

## 角色与铁律

- 一个任务只有一个主开发者，另一方默认**只读审核**
- 交接只认**提交号**，禁止复制整个文件覆盖另一方改动
- 高风险动作（推送 / SSH / 数据库迁移 / 部署 / 小程序上传）需用户**逐项单独确认**

## 状态机

`claim(接任务) → develop(开发) → handoff(交接) → review(审核) → publish(发布)`

### 1. claim 接任务
- [ ] 填 `docs/collaboration/TASK-HANDOFF-TEMPLATE.md`（基础提交 / 目录 / 分支 / 允许 / 禁止 / 高冲突占用 / 发布权限）
- [ ] `bash .claude/skills/collaboration/collaborate.sh status` 确认 `worktree_state=clean` 才开工
- [ ] 独立 worktree + 独立分支（`claude/*` 或 `codex/*`），不在集成目录同时开发

### 2. develop 开发
- [ ] 显式文件列表暂存，**禁止 `git add .`**
- [ ] 不碰高冲突文件，除非任务单已声明占用
- [ ] 禁止 `git reset --hard` / `git checkout --` / `git clean`
- [ ] 敏感信息（`.env` / 身份证 / 手机号 / 工资）不读、不打、不落明文

### 3. handoff 交接
- [ ] `bash .claude/skills/collaboration/collaborate.sh handoff <基础提交>`
- [ ] 提交号 + 改动清单 + 测试证据 + 遗留问题 一并交出

### 4. review 审核
- [ ] 只读 review，用文字回意见，不直接改
- [ ] 代改需用户明确授权 + 独立提交

### 5. publish 发布
- [ ] 单一发布人，另一方只复核、不重复部署
- [ ] 推送 / SSH / 数据库迁移 / 部署 / 小程序上传逐项确认

## 命令速查

| 动作 | 命令 |
|---|---|
| 查协作状态 | `bash .claude/skills/collaboration/collaborate.sh status` |
| 生成交接块 | `bash .claude/skills/collaboration/collaborate.sh handoff <base>` |
| 全量校验 | `npm run check` |
| 空白/冲突标记检查 | `git diff --check` |

## 高冲突文件（与 AGENTS.md §9 对齐）

- `public/app.js`、`public/index.html`、`public/styles.css`
- `src/services/operations.service.js`
- `package.json`
- `sql/*.sql`（`schema.mysql.sql` + 全部 `migrate-*.mysql.sql`）
- `scripts/` 下部署与发布脚本（`deploy-*` / `build-*` / `verify-*` / `*-release-*`）

同一时间只能由一个任务占用。
