# 驻厂员工生命周期简化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将驻厂员工流程简化为面试、待到岗、正常在职、已离职四个页面状态，并合并入职合同与雇主险办理、离职与减保流程。

**Architecture:** MySQL 和 Node.js 服务作为唯一状态事实源；网页端和微信小程序只根据后端返回的 `employeeStatus`、`lifecycleStatus` 和待办类型渲染。所有状态转换均在事务内同步员工、任职、人才库、待办、风险和操作日志。

**Tech Stack:** Node.js、Express、MySQL、原生 Web、微信小程序。

**Spec:** `docs/superpowers/specs/2026-08-13-onsite-lifecycle-simplification-design.md`

## Global Constraints

- 不删除旧状态、旧接口和历史业务记录。
- 驻厂账号继续按授权项目隔离员工数据。
- 新增写接口必须校验权限、状态和企业范围。
- 身份证、银行卡和手机号脱敏规则不得改变。
- 每项修改先运行失败测试，再写最小实现。
- 本次开发不自动提交 Git、不部署、不上传小程序。

---

### Task 1: 面试与待到岗状态转换

**Files:**
- Modify: `src/services/employee.service.js`
- Modify: `src/controllers/employee.controller.js`
- Modify: `src/routes/employee.routes.js`
- Create: `test/onsite-simplified-stage-flow.test.js`

**Interfaces:**
- Produces: `handleInterviewResult(companyId, employeeId, body, operatorId, user)`
- Produces: `handleArrivalResult(companyId, employeeId, body, operatorId, user)`
- REST: `PUT /employees/:id/interview-result`
- REST: `PUT /employees/:id/arrival-result`

- [ ] **Step 1: 写失败测试**

测试必须断言面试转待到岗、面试未通过、待到岗未入职、人才库同步、待办关闭和状态不匹配校验。

- [ ] **Step 2: 验证测试失败**

Run: `node test/onsite-simplified-stage-flow.test.js`

Expected: FAIL，提示缺少接口或业务函数。

- [ ] **Step 3: 实现最小后端逻辑**

在事务中更新员工状态、创建或关闭 `ARRIVAL` 待办、同步人才库和写操作日志。

- [ ] **Step 4: 验证测试通过**

Run: `node test/onsite-simplified-stage-flow.test.js`

Expected: PASS。

### Task 2: 合同与雇主险一键办理

**Files:**
- Modify: `src/services/employee.service.js`
- Modify: `src/controllers/employee.controller.js`
- Modify: `src/routes/employee.routes.js`
- Modify: `src/services/work-task.service.js`
- Create: `test/one-click-onboarding-compliance.test.js`

**Interfaces:**
- Produces: `confirmOnboardingCompliance(companyId, employeeId, body, operatorId, user)`
- REST: `POST /employees/:id/onboarding-compliance/confirm`
- New task type: `ONBOARDING_COMPLIANCE`

- [ ] **Step 1: 写失败测试**

断言路由同时要求 `contract:manage`、`social:manage`，服务在单事务写入合同、雇主险、员工状态、待办、风险和日志。

- [ ] **Step 2: 验证测试失败**

Run: `node test/one-click-onboarding-compliance.test.js`

- [ ] **Step 3: 实现合并接口和待办兼容**

新入职只创建一个 `ONBOARDING_COMPLIANCE` 待办；旧 `CONTRACT` 和 `INSURANCE` 待办仍可读取，但合并页面按员工去重。

- [ ] **Step 4: 验证测试通过**

Run: `node test/one-click-onboarding-compliance.test.js`

### Task 3: 一键离职直接办结

**Files:**
- Modify: `src/services/employee.service.js`
- Modify: `src/services/work-task.service.js`
- Modify: `test/simplified-resignation-flow.test.js`
- Modify: `test/one-click-resignation-flow.test.js`

**Interfaces:**
- Existing REST: `POST /employees/:id/resign`

- [ ] **Step 1: 扩展失败测试**

断言离职完成后关闭该员工全部开放待办和风险，员工直接为 `LEFT`，不创建新 `OFFBOARD` 或 `INSURANCE_TERMINATION` 待办。

- [ ] **Step 2: 验证测试失败**

Run: `node test/simplified-resignation-flow.test.js && node test/one-click-resignation-flow.test.js`

- [ ] **Step 3: 实现事务内直接办结**

保留历史进度接口，但新离职请求直接减保、归档、人才库回流、账号失效并关闭全部待办风险。

- [ ] **Step 4: 验证测试通过**

### Task 4: 小程序驻厂页面简化

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.wxss`
- Create: `wechat-miniprogram/miniprogram/pages/employees/compliance/index.js`
- Create: `wechat-miniprogram/miniprogram/pages/employees/compliance/index.json`
- Create: `wechat-miniprogram/miniprogram/pages/employees/compliance/index.wxml`
- Create: `wechat-miniprogram/miniprogram/pages/employees/compliance/index.wxss`
- Modify: `wechat-miniprogram/miniprogram/app.json`
- Modify: `wechat-miniprogram/miniprogram/pages/home/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/tasks/index.js`
- Create: `test/miniprogram-simplified-onsite-flow.test.js`

**Interfaces:**
- Consumes: Task 1、Task 2、Task 3 REST 接口。

- [ ] **Step 1: 写失败测试**

断言状态栏只有全部、面试、待到岗、正常在职、已离职；面试和待到岗卡片显示两个明确操作；在职卡片显示一键合规和一键离职。

- [ ] **Step 2: 验证测试失败**

- [ ] **Step 3: 修改页面和事件逻辑**

状态操作成功后清空本页缓存并刷新员工、工作台和待办。

- [ ] **Step 4: 验证测试通过**

### Task 5: 网页端合并入口

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `src/services/operations.service.js`
- Create: `test/web-simplified-onsite-flow.test.js`

- [ ] **Step 1: 写失败测试**

断言工作台和合规中心按员工合并合同/雇主险事项，员工详情提供一键合规入口。

- [ ] **Step 2: 验证测试失败**

- [ ] **Step 3: 修改网页页面、事件和待办展示**

- [ ] **Step 4: 验证测试通过**

### Task 6: 发布迁移与最终验收

**Files:**
- Modify: `sql/schema.mysql.sql`
- Create: `sql/migrate-simplified-onsite-flow-20260813.mysql.sql`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Modify: `package.json`
- Create: `test/simplified-onsite-release.test.js`

- [ ] **Step 1: 写失败测试并验证迁移清单缺失**
- [ ] **Step 2: 增加幂等迁移和发布校验**
- [ ] **Step 3: 运行所有专项测试**
- [ ] **Step 4: 运行 `npm run lint && npm run check && npm run postcheck`**
- [ ] **Step 5: 运行全部独立测试和 `npm audit --audit-level=high`**
- [ ] **Step 6: 运行父仓库与小程序仓库 `git diff --check`**
