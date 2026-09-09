# Attendance Timekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有优益企服云中交付 Web/微信小程序打卡、每日工时计算、异常审核和月度核准工时汇总。

**Architecture:** 新增独立 attendance 路由、控制器、服务和计算器，复用现有 JWT、employeeScope、审计日志和员工账号。原始打卡追加保存，daily result 可重算，补卡审核通过时追加人工打卡并重算。

**Tech Stack:** Node.js 18、Express、MySQL 8.4/mysql2、Vanilla JS SPA、原生微信小程序、现有 Node 测试脚本。

**Spec:** `docs/superpowers/specs/2026-09-09-attendance-timekeeping-design.md`

## Global Constraints

- 原始打卡只追加，不修改、不删除；纠错通过补卡申请表达。
- SQL 必须参数化；所有写接口校验 `company_id` 和数据范围。
- 员工端不接收客户端正式打卡时间、employeeId 或 companyId；打卡时间取服务端时间。
- 员工只能查看本人；后台沿用 `employeeScope`；薪资角色只读核准工时。
- 身份证、银行卡等敏感字段不得出现在考勤响应和导出中。
- 迁移文件禁止 DELETE/DROP/TRUNCATE，INSERT/ALTER 必须幂等。
- 不执行生产迁移、上传、部署或远程推送。

## 文件结构

- Create: `sql/migrate-attendance-timekeeping-20260909.mysql.sql` — 五张考勤表、索引和幂等权限数据。
- Modify: `sql/schema.mysql.sql`, `sql/seed.mysql.sql` — 同步全量结构和默认角色权限。
- Create: `src/services/attendance-calculator.service.js` — 纯函数计算器。
- Create: `src/services/attendance.service.js` — 事务、范围、排班、打卡、审核和汇总。
- Create: `src/controllers/attendance.controller.js`, `src/routes/attendance.routes.js` — API 层。
- Modify: `src/routes/index.js`, `src/app.js` — 注册后台和员工考勤路由。
- Create/Modify: `public/js/views/attendance.js`, `public/index.html`, `public/app.js` — Web 菜单、日报、月报、审核和员工打卡入口。
- Create/Modify: `wechat-miniprogram/miniprogram/pages/attendance/*`, `pages/home/*`, `app.json` — 小程序打卡和月度明细。
- Create: `test/attendance-calculator.test.js`, `test/attendance-api-contract.test.js`, `test/attendance-permission.test.js`, `test/miniprogram-attendance.test.js` — 单元、接口、权限和小程序契约测试。

### Task 1: 数据库迁移与权限

**Files:**
- Create: `sql/migrate-attendance-timekeeping-20260909.mysql.sql`
- Modify: `sql/schema.mysql.sql`, `sql/seed.mysql.sql`
- Test: `test/attendance-schema.test.js`

- [ ] Step 1: 写失败测试，断言五张表、唯一索引、状态字段和权限编码存在。
- [ ] Step 2: 运行 `node test/attendance-schema.test.js`，确认因表和权限不存在而失败。
- [ ] Step 3: 按设计创建 `attendance_shift_rules`、`attendance_schedules`、`attendance_punches`、`attendance_daily_results`、`attendance_correction_requests`；迁移使用 information_schema 判断后再 ALTER，权限使用幂等 INSERT。
- [ ] Step 4: 将同一结构同步到 `schema.mysql.sql`，将 attendance 权限加入 seed 的权限目录和四角色默认授权。
- [ ] Step 5: 运行测试并执行 `git diff --check`。
- [ ] Step 6: 提交 `git commit -m "feat: add attendance schema and permissions"`。

### Task 2: 工时计算纯函数

**Files:**
- Create: `src/services/attendance-calculator.service.js`
- Test: `test/attendance-calculator.test.js`

**Interfaces:** `calculateDailyAttendance({ schedule, punches, now }) -> { firstInAt, lastOutAt, workedMinutes, approvedNormalMinutes, overtimeCandidateMinutes, lateMinutes, earlyLeaveMinutes, resultStatus }`。

- [ ] Step 1: 写正常班、午休、迟到、早退、缺卡、旷工、休息日、跨天和重复打卡失败测试。
- [ ] Step 2: 运行 `node test/attendance-calculator.test.js`，确认计算函数不存在或断言失败。
- [ ] Step 3: 实现分钟级纯函数：按班次窗口取最早 IN/最晚 OUT，扣除重叠休息，计算迟到/早退/候选加班，并返回稳定状态。
- [ ] Step 4: 运行 `node test/attendance-calculator.test.js`，确认全部通过。
- [ ] Step 5: 提交 `git commit -m "feat: add attendance time calculator"`。

### Task 3: 后端服务与事务

**Files:**
- Create: `src/services/attendance.service.js`
- Test: `test/attendance-service-contract.test.js`

**Interfaces:** `punchEmployee(companyId, employeeAccountId, body)`, `getEmployeeToday(companyId, employeeId)`, `getEmployeeMonth(companyId, employeeId, month)`, `createCorrection(companyId, employeeId, body)`, `listDaily(companyId, user, params)`, `listMonthly(companyId, user, params)`, `reviewCorrection(companyId, user, id, body)`, `recalculate(companyId, user, params)`, `attendanceSummaryForPayroll(companyId, user, params)`。

- [ ] Step 1: 写服务契约测试，覆盖重复 clientRequestId、未排班拒绝、员工本人范围和审核重算。
- [ ] Step 2: 运行测试，确认服务接口不存在。
- [ ] Step 3: 实现事务：验证企业和在职状态，服务器时间匹配排班，插入原始记录，调用计算器 upsert daily result；审核通过追加 `MANUAL_APPROVED` 记录并重算。
- [ ] Step 4: 为后台列表和薪酬汇总应用 `employeeScope`，确保查询参数全部绑定变量。
- [ ] Step 5: 运行服务契约测试和 `node --check src/services/attendance.service.js`。
- [ ] Step 6: 提交 `git commit -m "feat: add attendance service workflow"`。

### Task 4: API、权限和路由

**Files:**
- Create: `src/controllers/attendance.controller.js`, `src/routes/attendance.routes.js`
- Modify: `src/routes/index.js`, `src/app.js`, `src/routes/employee-auth.routes.js`
- Test: `test/attendance-api-contract.test.js`, `test/attendance-permission.test.js`

- [ ] Step 1: 写接口契约测试，断言员工打卡/查询、后台日报/月报、班次、排班、审核、重算和薪酬汇总路径。
- [ ] Step 2: 运行测试确认路由未注册。
- [ ] Step 3: 注册员工端和后台端路由，使用现有 `requireEmployeeAccount`、`requirePermission`、限流和统一错误响应模式。
- [ ] Step 4: 运行接口和权限测试，确认角色矩阵与数据范围。
- [ ] Step 5: 提交 `git commit -m "feat: expose attendance APIs"`。

### Task 5: Web 后台与员工端

**Files:**
- Create: `public/js/views/attendance.js`
- Modify: `public/index.html`, `public/app.js`, `public/js/core/navigation-groups.js`
- Test: `test/web-attendance-flow.test.js`

- [ ] Step 1: 写页面契约测试，断言考勤菜单、今日考勤、月度汇总、异常审核、班次排班和员工打卡入口。
- [ ] Step 2: 运行测试确认页面标记不存在。
- [ ] Step 3: 按现有 SPA 视图和 API 封装实现后台四视图，员工端打卡按钮使用 clientRequestId、提交锁定和状态回查。
- [ ] Step 4: 增加异常筛选、审核操作、月度导出和无敏感字段显示。
- [ ] Step 5: 运行页面契约测试及 `node --check`。
- [ ] Step 6: 提交 `git commit -m "feat: add web attendance workspace"`。

### Task 6: 微信小程序打卡与月度明细

**Files:**
- Create: `wechat-miniprogram/miniprogram/pages/attendance/index.js`, `index.wxml`, `index.wxss`, `index.json`
- Modify: `wechat-miniprogram/miniprogram/app.json`, `pages/home/index.*`, `utils/request.js`
- Test: `test/miniprogram-attendance.test.js`

- [ ] Step 1: 写小程序契约测试，断言页面注册、首页入口、按钮状态和接口路径。
- [ ] Step 2: 运行测试确认页面未注册。
- [ ] Step 3: 实现考勤页：获取今日状态、上/下班按钮、月度列表、补卡入口和错误提示；客户端不提交正式时间或员工 ID。
- [ ] Step 4: 运行小程序契约测试和 `node scripts/check-miniprogram-contracts.js`。
- [ ] Step 5: 提交 `git commit -m "feat: add mini program attendance page"`。

### Task 7: 集成验证与文档

**Files:**
- Modify: `package.json`, `README.md`
- Test: all existing checks plus attendance tests

- [ ] Step 1: 将新增测试加入 `npm run check` 或独立 `test:attendance`，不删除既有检查。
- [ ] Step 2: 运行 `npm run check`、`npm run lint` 和 `node scripts/check-miniprogram-contracts.js`。
- [ ] Step 3: 针对失败项按根因修复并重复原命令；不跳过失败测试。
- [ ] Step 4: 在 README 增加本地迁移、测试账号使用方式和第一期限制，不写生产部署说明。
- [ ] Step 5: 运行 `git diff --check`，确认只包含考勤相关文件和设计/计划文档。
- [ ] Step 6: 提交 `git commit -m "test: verify attendance timekeeping flow"`。

## Self-review checklist

- [ ] 覆盖原始打卡、排班、每日结果、补卡、权限、Web、小程序和薪酬读取。
- [ ] 覆盖重复打卡、跨天、缺卡、休息日、补卡重算和权限隔离。
- [ ] 未包含生产部署、考勤机、GPS、人脸或自动工资金额计算。
- [ ] 计划中无 TBD、TODO 或未定义接口。
