---
name: claude-codex-collaboration
description: Claude 与 Codex 协作协议与脚本。当需要与 Codex 分工、接任务(claim)、交接(handoff)、只读审核，或涉及 push/SSH/数据库迁移/部署/小程序上传等高权限操作时使用。
---

# Claude ⇄ Codex 协作

与 Codex 协作时遵循本协议。完整规则见 [PROTOCOL.md](./PROTOCOL.md)，脚本见 [collaborate.sh](./collaborate.sh)。规则冲突以 `AGENTS.md` §9 为准。

## 快速动作

- 接任务前：`bash .claude/skills/collaboration/collaborate.sh status` 确认 `worktree_state=clean`
- 交接时：`bash .claude/skills/collaboration/collaborate.sh handoff <base>`
- 显式文件列表暂存，禁止 `git add .`

## 核心铁律

1. 一个任务一个主开发者，另一方只读审核
2. 交接只认提交号，不复制文件覆盖
3. push / SSH / 数据库迁移 / 部署 / 小程序上传需用户逐项确认

详见 PROTOCOL.md 的 5 阶段状态机。
