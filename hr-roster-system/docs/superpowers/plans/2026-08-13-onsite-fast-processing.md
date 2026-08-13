# 驻厂快速办理流程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将微信小程序驻厂流程简化为录入新员工、待到岗、在职员工、已离职四步闭环，并取消驻厂合规待办和处理队列。

**Architecture:** REST API 和 MySQL 继续作为跨端事实源。小程序只调整驻厂入口、筛选和操作；后端确认入职不再创建合同/雇主险风险与合并待办，历史接口和数据仍保留给网页端。新增幂等迁移关闭历史开放合规待办，所有写操作继续使用企业和项目数据范围校验。

**Tech Stack:** 微信小程序、Node.js、Express、MySQL、原生 Web、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-08-13-onsite-fast-processing-design.md`

## Global Constraints

- 小程序驻厂工作台只保留录入新员工、待到岗、在职员工、已离职四个核心入口。
- 新增员工默认状态固定为 `employee_status=1`。
- 确认入职不得创建合同、雇主险或 `ONBOARDING_COMPLIANCE` 待办。
- 合同、雇主险历史表和网页端历史管理能力不得删除。
- 驻厂专员数据范围和敏感字段权限不得放宽。
- 未入职和离职继续同步人才库。
- 每个行为变更必须先有失败测试，再实施最小修复。

---

### Task 1: 小程序工作台收敛为四个快速入口

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/home/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/home/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/home/index.wxss`
- Create: `test/miniprogram-onsite-fast-processing.test.js`

**Interfaces:**
- Consumes: `GET /api/operations/home`, `GET /api/employees/onsite-overview`
- Produces: `goAddEmployee()`, `goEmployeeStage(event)`，四个固定状态入口

- [ ] 写失败测试，断言首页不请求工作待办、不显示驻厂待处理/合规待办/驻厂处理队列，只显示四个快速入口。
- [ ] 运行 `node test/miniprogram-onsite-fast-processing.test.js`，确认因旧首页结构失败。
- [ ] 删除首页待办加载、待办跳转和合规权限状态，只保留概览和四个入口。
- [ ] 运行专项测试，确认通过。

### Task 2: 驻厂人员页只保留待到岗、在职和已离职

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.wxss`
- Modify: `test/miniprogram-onsite-fast-processing.test.js`

**Interfaces:**
- Consumes: `GET /api/employees`, `GET /api/employees/onsite-overview`
- Produces: `pending`、`active`、`left` 三种筛选；历史面试人员并入 `pending`

- [ ] 扩展失败测试，断言状态栏不显示面试、未入职、离职办理和雇主险筛选。
- [ ] 运行专项测试，确认旧状态和合规按钮触发失败。
- [ ] 将 `employee_status=1/6` 统一映射为待到岗，删除面试操作、合规和保险入口。
- [ ] 保留查看、编辑、确认入职、未入职和一键离职。
- [ ] 运行专项测试，确认通过。

### Task 3: 新增员工固定进入待到岗

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/employees/add/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/add/index.wxml`
- Modify: `test/miniprogram-onsite-fast-processing.test.js`

**Interfaces:**
- Consumes: `POST /api/employees`, `PUT /api/employees/:id`
- Produces: 新增请求固定 `employeeStatus: 1`；编辑请求不修改状态

- [ ] 扩展失败测试，断言新增页无状态选择且固定提交 `employeeStatus: 1`。
- [ ] 运行专项测试，确认旧面试选择导致失败。
- [ ] 删除新增状态数组、选择器和面试分支校验，统一按待到岗校验和提交。
- [ ] 保持编辑模式、OCR、客户项目范围和敏感字段权限逻辑。
- [ ] 运行专项测试，确认通过。

### Task 4: 确认入职不再生成合规待办

**Files:**
- Modify: `src/services/employee.service.js`
- Create: `sql/migrate-onsite-fast-processing-20260813.mysql.sql`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Modify: `test/miniprogram-onsite-fast-processing.test.js`
- Modify: `test/release-migration-consistency.test.js`

**Interfaces:**
- Consumes: `POST /api/employees/:id/onboard`
- Produces: `employee_status=2`、`lifecycle_status='ACTIVE'`、`arrival_status='CONFIRMED'`，关闭到岗待办，不创建合规待办

- [ ] 扩展失败测试，断言 `onboardEmployee` 不调用 `createOnboardingCompliance`。
- [ ] 运行专项测试，确认旧服务创建合规风险和待办而失败。
- [ ] 修改确认入职和直接入职逻辑，不创建合同/保险风险与待办。
- [ ] 新增幂等迁移，关闭开放的 `CONTRACT`、`INSURANCE`、`ONBOARDING_COMPLIANCE` 驻厂待办但保留历史。
- [ ] 将迁移加入生产部署和发布包安全检查。
- [ ] 运行服务、迁移和跨端专项测试。

### Task 5: 一键离职取消雇主险减保确认

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/employees/resign/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/resign/index.wxml`
- Modify: `src/services/employee.service.js`
- Modify: `test/miniprogram-onsite-fast-processing.test.js`
- Modify: `test/one-click-resignation-flow.test.js`

**Interfaces:**
- Consumes: `POST /api/employees/:id/resign`
- Produces: 离职日期、类型、原因和交接项一次办结；不要求 `terminateEmployerInsurance`

- [ ] 扩展失败测试，断言离职页面和服务不要求雇主险减保确认。
- [ ] 运行专项测试，确认旧减保要求导致失败。
- [ ] 删除小程序减保选择和请求字段；后端保留字段兼容但不再阻塞离职。
- [ ] 确认离职仍关闭待办/风险、停用账号并同步人才库。
- [ ] 运行离职专项测试。

### Task 6: 员工详情只保留驻厂快速操作

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/employees/detail/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml`
- Modify: `test/miniprogram-onsite-fast-processing.test.js`

**Interfaces:**
- Consumes: `GET /api/employees/:id`
- Produces: 待到岗查看/编辑/确认入职/未入职，在职查看/编辑/离职，已离职查看

- [ ] 扩展失败测试，断言详情页不显示合同、雇主险和合并合规操作。
- [ ] 运行专项测试，确认旧入口导致失败。
- [ ] 删除驻厂详情页合同、保险和合规按钮，保留全字段展示、编辑和生命周期操作。
- [ ] 运行专项测试。

### Task 7: 更新旧验收并完成跨端全量验证

**Files:**
- Modify: `test/miniprogram-employee-core.test.js`
- Modify: `test/miniprogram-simplified-onsite-flow.test.js`
- Modify: `test/miniprogram-workbench-onsite-link.test.js`
- Modify: other stale acceptance tests discovered by the full run

**Interfaces:**
- Consumes: 新驻厂快速办理规格
- Produces: 不再要求旧合规队列、面试入口、保险入口的语义验收

- [ ] 更新明确编码旧产品行为的验收测试，改为四步快速流程语义断言。
- [ ] 运行 `npm run lint`、`npm run check:web`、`npm run check`、`npm run postcheck`。
- [ ] 逐个运行 `test/*.test.js`，不得遗漏聚合脚本外测试。
- [ ] 运行 `npm audit --audit-level=high`、父/嵌套仓库 `git diff --check`。
- [ ] 核查网页端、小程序端与 API 状态、数量和数据范围一致性。

