# 服务号通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为优企云增加微信公众号服务号员工绑定、工资条通知队列和失败重试能力。

**Architecture:** 复用现有 Express/MySQL、员工微信绑定和 scheduler。服务号 OAuth 负责产生独立 openid，通知服务采用“发布入队、定时发送、状态可审计”的异步模式，不改变工资条主流程。

**Tech Stack:** Node.js 18+, Express, MySQL, 原生微信 OAuth/模板消息接口。

**Spec:** `docs/superpowers/specs/2026-08-27-wechat-official-notification-design.md`

## Global Constraints

- 不记录 AppSecret、Token、完整身份证号、银行卡号或工资明细。
- 不改变现有短信通知和小程序登录行为。
- 所有 SQL 必须使用命名参数；所有查询带 company_id。
- 不提交 Git，不写入生产数据。

### Task 1: 数据库迁移与环境配置

**Files:**
- Create: `sql/migrate-wechat-official-notification-20260827.mysql.sql`
- Modify: `.env.production.example`
- Test: `test/wechat-official-schema.test.js`

- [ ] 写失败测试，断言两张表、唯一去重索引和五个配置项存在。
- [ ] 运行 `node test/wechat-official-schema.test.js`，确认失败。
- [ ] 添加 `employee_official_binding` 与 `wechat_official_notification_job` 幂等迁移。
- [ ] 补充示例环境变量为空值。
- [ ] 运行该测试确认通过。

### Task 2: 服务号 OAuth 与 access_token 服务

**Files:**
- Create: `src/services/wechat-official.service.js`
- Create: `test/wechat-official-service.test.js`

- [ ] 先测试未配置时拒绝发送、access_token 缓存、回调参数校验和 unionid 不匹配拒绝。
- [ ] 实现配置读取、微信接口请求封装、短期 token 缓存、OAuth URL 生成与安全回调解析。
- [ ] 测试日志和错误对象不包含 Secret、完整 openid 以外的个人敏感信息。

### Task 3: 绑定与通知队列服务

**Files:**
- Create: `src/services/official-notification.service.js`
- Create: `test/official-notification.test.js`

- [ ] 先测试员工只能绑定本人、跨企业拒绝、重复 dedupe 不重复入队、通知 payload 不含敏感字段。
- [ ] 实现绑定写入、解绑、状态查询、工资条发布/提醒入队、队列 claim、成功/失败/重试状态更新。
- [ ] 重试仅允许三次，使用 60/300/1800 秒间隔。

### Task 4: 路由、控制器与 scheduler 接入

**Files:**
- Create: `src/controllers/wechat-official.controller.js`
- Create: `src/routes/wechat-official.routes.js`
- Modify: `src/routes/index.js`
- Modify: `src/scheduler.js`
- Test: `test/wechat-official-routes.test.js`

- [ ] 先测试路由鉴权、企业范围和员工本人范围。
- [ ] 实现 bind-url、callback、unbind、bind-status、通知记录查询接口。
- [ ] scheduler 增加每分钟服务号队列处理，并防止并发重复运行。

### Task 5: 工资条发布接入与验证

**Files:**
- Modify: `src/services/payslip.service.js` 或现有发布服务
- Modify: `src/config/env.js`
- Modify: `package.json`

- [ ] 先增加发布后入队的行为测试，确认发布失败不产生任务、重复发布不重复通知。
- [ ] 在发布事务成功后调用入队函数，不阻塞主交易。
- [ ] 运行 `npm run lint`、`npm run check`、`npm run postcheck`、`npm audit --audit-level=high`、`git diff --check`。

