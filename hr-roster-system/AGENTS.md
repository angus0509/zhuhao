# 优益数字化管理系统 — 项目约定

本文件是 Codex 与 Claude Code 共享的项目级约定，优先级高于全局默认假设（`~/.codex/AGENTS.md` / `~/.claude/CLAUDE.md`）。所有代码修改、PRD、接口设计、数据库结构都必须遵守本文件。

## 1. 项目定位

面向中国劳务公司 / 人力资源服务公司的内部管理平台，覆盖 Web 端 + 手机端 + 微信小程序 + 后端 API。

## 2. 技术栈（以此为准，覆盖全局默认假设）

- 前端 Web：原生 Vanilla JS 单页应用（`public/`，无框架，SPA）
- 移动端：微信小程序（原生，`wechat-miniprogram/`）
- 后端：Node.js + Express 4.21 + MySQL2 3.12
- 数据库：MySQL 8.4，库名 `hr_roster`，22 张表
- 认证：JWT Bearer Token
- 部署：腾讯云 Ubuntu + Docker Compose + Nginx 反向代理

## 3. 目录结构

- `server.js` — 应用入口（含大量路由与中间件）
- `src/` — 后端模块（app、db、middlewares 等）
- `public/` — Web 前端 SPA（`index.html` + `app.js` + `styles.css` + `theme-*.css`）
- `wechat-miniprogram/` — 微信小程序（6 个 Tab 页 + 登录页）
- `sql/` — 数据库迁移文件
- `scripts/` — 部署脚本（`build-release-package.sh`、`verify-release-package.sh`、`deploy-production.sh`）
- `test/` — 测试

## 4. 权限模型（四角色）

- `company_admin` 企业管理员
- `hr_manager` HR 主管
- `onsite_staff` 驻厂专员
- `payroll_staff` 薪资专员

权限中间件 `requirePermission` + 数据范围隔离 `employeeScope` / `projectScope` / `customerScope`。改权限相关代码时必须同时验证中间件和数据范围过滤。

## 5. 安全规范（硬性）

- 身份证号、银行卡号 AES-256-CBC 加密存储，SHA-256 摘要检索，禁止明文落库或明文回显
- SQL 一律参数化查询，禁止字符串拼接（含 LIMIT/OFFSET）
- CORS 白名单精确匹配，禁止反射任意 Origin
- 敏感文件（`.env`、`.env.production`）不进发布包

## 6. 发布与部署规范（硬性，不可跳过）

1. 发布包必须用 `scripts/build-release-package.sh` 生成（`PACKAGE_VALID` flag + `EXIT` trap，失败只删本次生成文件，不用通配符）
2. `verify-release-package.sh` 解压前完成 tar 安全审计：符号/硬链接用 `tar tvzf | awk '{print $1}' | grep -E '^[lh]'`，路径穿越用 `(^|/)\.\.(/|$)`；不通过则 exit 1 不解压
3. `npm audit --json` 动态读取 low/moderate/high/critical，high/critical > 0 阻止发布
4. 数据库备份三重验证：`gzip -t`、`test -s`、`grep "Table structure for table"`
5. 迁移文件禁止 DELETE/DROP/TRUNCATE；ALTER 前查 `information_schema`；INSERT 必须 `ON DUPLICATE KEY` / `INSERT IGNORE` / `WHERE NOT EXISTS` 保证幂等
6. `.env.production` 解压前后 SHA-256 必须一致
7. 健康检查用最多 12 次重试 × 5 秒，不用固定 `sleep`
8. 所有脚本 `set -euo pipefail`、`umask 077`

## 7. 验证规范

- 部署前必须通过 `npm run check` + 小程序契约检查
- 所有 shell 脚本改动后跑 `bash -n` 语法检查
- 不伪造数据、不跳过测试、不虚构通过结果

## 8. 协作规则

- 最小改动，不重构未破坏的代码，不清理无关死代码
- 部署方式为本地打包 → scp 上传 → 服务器解压覆盖，**不使用 git pull**
- 不上传、不 SSH、不部署生产，除非用户明确要求
- 生产操作前先备份（代码 + 数据库）并验证备份可用

## 9. Claude 与 Codex 协作规则

- Claude、Codex 和集成发布必须使用独立 Worktree 与独立分支；集成目录不用于双方同时开发。
- 一个任务只能有一个主开发者，另一方默认只读审核；代为修复必须获得用户明确授权并使用独立提交。
- 每项任务必须声明基础提交、工作目录、分支、允许修改、禁止修改、高冲突文件占用和发布权限。
- `public/app.js`、`public/index.html`、`public/styles.css`、`src/services/operations.service.js`、`package.json`、全部 `sql/*.sql` 以及名称包含 `deploy` 或 `release` 的 Shell 脚本同一时间只能由一个任务占用。
- 交接只接受明确提交号，禁止通过复制整个文件覆盖另一方改动。
- 使用显式文件列表暂存，禁止使用 `git add .`。
- 禁止使用 `git reset --hard`、`git checkout --`、`git clean` 清理另一方或用户改动。
- 本地修改、提交、交叉审核、完整测试、远程推送、Web/API 部署和小程序上传必须分别汇报。
- 每次生产发布只指定一个单一发布人；另一方只能复核，不得对同一版本重复部署。
- 推送、生产 SSH、数据库迁移、Web/API 部署和小程序上传均需用户单独明确确认。
