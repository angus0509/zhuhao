# 优益数字化管理系统全面核查实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task with verification checkpoints.

**Goal:** 核查网页端、手机 Web、小程序、Node/MySQL 后端、权限隔离和发布配置，修复可复现错误并形成可重复验证的验收结果。

**Architecture:** 以 REST API 和 MySQL 为业务事实源，网页端与微信小程序共享员工、客户、项目、待办和生命周期状态。核查按“静态结构 → 契约测试 → 权限/数据范围 → 运行时健康 → 发布配置”顺序执行，修复坚持最小改动。

**Tech Stack:** Node.js、Express、MySQL、原生 Web、微信小程序、Docker Compose、腾讯云。

**Spec:** 用户“使用小白开发助手和刚安装的开发流程，再核查下所有内容”。

## Global Constraints

- 不删除或覆盖用户已有未提交改动。
- 未明确授权前不提交 Git、不部署、不上传小程序。
- HR 敏感信息必须脱敏，权限和企业/项目数据隔离不能回退。
- 每个修复必须有对应测试，并重新运行 lint、check、postcheck、依赖安全检查。

### Task 1: 项目结构与基线核查

**Files:**
- Read: `package.json`, `README.md`, `src/app.js`, `wechat-miniprogram/miniprogram/app.json`
- Test: existing `test/*.test.js`

- [ ] 检查技术栈、启动命令、版本配置、嵌套小程序仓库状态。
- [ ] 运行 `npm run lint`、`npm run check`、`npm run postcheck`、`npm audit --audit-level=high`。
- [ ] 记录失败项，进入对应专项修复。

### Task 2: 网页端与小程序页面/事件核查

**Files:**
- Read: `public/index.html`, `public/app.js`, `wechat-miniprogram/miniprogram/pages/**/*.wxml`, `*.js`
- Test: `test/page-logic-integrity.test.js`

- [ ] 检查页面路由、事件绑定、权限入口、空状态和错误重试。
- [ ] 检查小程序所有页面是否存在对应 JS/WXML/WXSS/JSON 和事件处理器。
- [ ] 修复明确缺失的事件处理器或死链，并先补失败测试。

### Task 3: HR 生命周期与跨端数据一致性核查

**Files:**
- Read: `src/services/employee.service.js`, `src/services/work-task.service.js`, `wechat-miniprogram/miniprogram/pages/employees/**`, `pages/tasks/**`
- Test: `test/onsite-task-lifecycle-sync.test.js`, `test/miniprogram-onsite-unified-flow.test.js`, `test/one-click-resignation-flow.test.js`

- [ ] 核查面试、待到岗、在职、离职中、已离职状态转换。
- [ ] 核查待办创建、关闭、刷新和历史任职归属。
- [ ] 对发现的状态残留增加红测试，最小修复后回归。

### Task 4: 权限、数据隔离与敏感信息核查

**Files:**
- Read: `src/utils/data-scope.js`, `src/services/auth.service.js`, `src/routes/*.routes.js`
- Test: `test/data-scope.test.js`, `test/role-permission-matrix.test.js`, `test/high-risk-security.test.js`, `test/p1-security-hardening.test.js`

- [ ] 核查企业管理员、HR主管、驻厂专员、薪资专员权限。
- [ ] 核查离职员工账号失效、导出审计、身份证/银行卡/工资脱敏。
- [ ] 禁止用前端权限替代后端鉴权。

### Task 5: 发布与运行时核查

**Files:**
- Read: `scripts/build-release-package.sh`, `scripts/verify-release-package.sh`, `scripts/deploy-production.sh`, `scripts/verify-miniprogram-release.sh`
- Test: `test/release-migration-consistency.test.js`, `test/post-deploy-verification-contract.test.js`, `test/miniprogram-release-candidate.test.js`

- [ ] 检查迁移清单、危险文件排除、环境文件保护和小程序 API 域名。
- [ ] 如用户后续授权，再执行生产部署和小程序上传；本轮只做只读验证。

### Task 6: 最终验收

- [ ] 运行全部独立测试：`for f in test/*.test.js; do node "$f"; done`。
- [ ] 运行 `npm run lint && npm run check && npm run postcheck`。
- [ ] 运行 `npm audit --audit-level=high`、`git diff --check`、嵌套仓库 diff 检查。
- [ ] 汇报修改文件、发现问题、验证结果和未执行的外部动作。
