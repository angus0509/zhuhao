# Attendance Hourly Wage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有项目考勤扩展为白班/夜班小时制计薪，支持补贴、员工日结、自动工资预览、工资批次生成和腾讯地图围栏选点。

**Architecture:** 保留现有分钟制考勤事实表，在项目规则下增加版本化双班次和补贴明细，并用员工项目计薪版本及每日排班确定当日班次。自动工资使用独立纯函数和版本化预览快照，人工确认后写入现有 `salary_batch` / `salary_detail`；地图 Key 缺失或加载失败时降级为手工坐标。

**Tech Stack:** Node.js 18+、Express 4、MySQL 8.4、mysql2 命名参数、Vanilla JS SPA、原生微信小程序、腾讯地图 JavaScript API。

**Spec:** `docs/superpowers/specs/2026-09-16-attendance-hourly-wage-design.md`

## Global Constraints

- 数据库内部继续以整数分钟保存考勤；Web 和小程序业务展示使用小时。
- 每个员工日按半小时四舍五入：`Math.floor((approvedMinutes + 15) / 30) * 30`。
- 跨夜班归属于上班日期；标准工时和超出标准工时使用相同班次时薪。
- 金额用整数分计算并以 `DECIMAL` 存储，禁止用 JavaScript 浮点数累计金额。
- 原始打卡只追加；已确认工资快照不可被重算覆盖。
- SQL 全部参数化；所有工资查询同时校验 `company_id`、`projectScope` 和员工项目任职。
- 自动工资预览存在阻断项时不得确认；重复确认必须返回同一个 `salaryBatchId`。
- 腾讯地图浏览器 Key 仅通过环境变量读取并限制域名；服务端 Key 不返回客户端。
- 保留现有工资表上传、复核、发放、签收流程和历史数据。
- 当前工作区有未提交的工资条和页面修改。每个任务开始前运行 `git status --short`，只暂存本任务文件，禁止 `reset`、`checkout --` 或覆盖无关改动。
- 本计划只完成本地实现和验证，不部署、不上传小程序。

---

### Task 1: 数据库结构与发布迁移契约

**Files:**
- Create: `sql/migrate-attendance-hourly-wage-20260916.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `scripts/build-release-package.sh`
- Modify: `scripts/verify-release-package.sh`
- Modify: `scripts/deploy-production.sh`
- Create: `test/attendance-hourly-wage-schema.test.js`
- Modify: `test/release-migration-consistency.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `attendance_project_rules.id`、`attendance_schedules`、`salary_batch`、现有迁移幂等约定。
- Produces: 六张新表、排班/工资批次扩展列及 `npm run test:hourly-wage` 入口。

- [ ] **Step 1: 写迁移契约失败测试**

```js
// test/attendance-hourly-wage-schema.test.js
const fs = require('node:fs');
const assert = require('node:assert/strict');
const sql = fs.readFileSync('sql/migrate-attendance-hourly-wage-20260916.mysql.sql', 'utf8');

for (const table of [
  'attendance_project_shift_rules', 'attendance_allowance_rules',
  'employee_pay_profiles', 'wage_calculation_runs',
  'wage_calculation_daily_lines', 'wage_daily_payments'
]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

assert.match(sql, /attendance_schedules[\s\S]*shift_type/);
assert.match(sql, /attendance_schedules[\s\S]*project_shift_rule_id/);
assert.match(sql, /salary_batch[\s\S]*source_type/);
assert.match(sql, /salary_batch[\s\S]*calculation_run_id/);
assert.doesNotMatch(sql, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.match(sql, /information_schema\.COLUMNS/);
console.log('attendance-hourly-wage-schema.test.js: passed');
```

- [ ] **Step 2: 运行测试并确认因迁移文件缺失而失败**

Run: `node test/attendance-hourly-wage-schema.test.js`

Expected: FAIL with `ENOENT` for `migrate-attendance-hourly-wage-20260916.mysql.sql`.

- [ ] **Step 3: 编写幂等迁移和最终 schema**

迁移必须按设计创建六张表；使用 `information_schema.COLUMNS` 幂等增加：

```sql
ALTER TABLE attendance_schedules ADD COLUMN shift_type VARCHAR(10) DEFAULT NULL;
ALTER TABLE attendance_schedules ADD COLUMN project_shift_rule_id BIGINT DEFAULT NULL;
ALTER TABLE salary_batch ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'IMPORT';
ALTER TABLE salary_batch ADD COLUMN calculation_run_id BIGINT DEFAULT NULL;
```

实际迁移中每条 `ALTER` 都通过预处理语句条件执行。为旧 `attendance_project_rules` 使用 `INSERT IGNORE ... SELECT` 创建 `DAY` 兼容班次，`hourly_rate` 保持 `NULL`，不得推测员工时薪。为 `salary_batch.calculation_run_id` 创建唯一索引，保证一个确认计算只能生成一个工资批次。

- [ ] **Step 4: 接入发布脚本和结构核验**

在构建/验证脚本的迁移清单加入新 SQL；在部署脚本的项目考勤迁移之后执行。新增只读核验：六张新表存在、四个扩展列存在、`wage_calculation_runs` 唯一索引存在。

- [ ] **Step 5: 增加专项测试命令并运行**

在 `package.json` 增加：

```json
"test:hourly-wage": "node test/attendance-hourly-wage-schema.test.js"
```

Run: `npm run test:hourly-wage`

Expected: PASS and print `attendance-hourly-wage-schema.test.js: passed`.

- [ ] **Step 6: 验证脚本语法和迁移一致性**

Run: `bash -n scripts/build-release-package.sh`

Run: `bash -n scripts/verify-release-package.sh`

Run: `bash -n scripts/deploy-production.sh`

Run: `node test/release-migration-consistency.test.js`

Expected: all exit 0.

- [ ] **Step 7: 提交数据库任务**

```bash
git add sql/migrate-attendance-hourly-wage-20260916.mysql.sql sql/schema.mysql.sql scripts/build-release-package.sh scripts/verify-release-package.sh scripts/deploy-production.sh test/attendance-hourly-wage-schema.test.js test/release-migration-consistency.test.js package.json
git commit -m "feat: add hourly wage persistence schema"
```

### Task 2: 小时工资纯函数与金额定点计算

**Files:**
- Create: `src/services/hourly-wage-calculator.service.js`
- Create: `test/hourly-wage-calculator.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `approvedMinutes`、班次时薪、补贴和结算方式。
- Produces: `parseMoneyToCents(value)`、`formatCents(cents)`、`roundPayableMinutes(minutes)`、`calculateDailyWage(input)`。

- [ ] **Step 1: 写半小时边界和工资公式失败测试**

```js
const assert = require('node:assert/strict');
const { roundPayableMinutes, calculateDailyWage } = require('../src/services/hourly-wage-calculator.service');

assert.equal(roundPayableMinutes(434), 420);
assert.equal(roundPayableMinutes(435), 450);
assert.equal(roundPayableMinutes(464), 450);
assert.equal(roundPayableMinutes(465), 480);

const result = calculateDailyWage({
  approvedMinutes: 465,
  shiftType: 'NIGHT',
  hourlyRate: '23.00',
  allowances: [
    { allowanceName: '夜班补贴', shiftScope: 'NIGHT', calculationType: 'PER_SHIFT', unitAmount: '30.00' },
    { allowanceName: '高温补贴', shiftScope: 'ALL', calculationType: 'PER_HOUR', unitAmount: '1.50' }
  ],
  settlementMode: 'DAILY_ACCRUAL', dailyPaidAmount: '0.00', attendanceStatus: 'NORMAL'
});
assert.deepEqual(result, {
  payableMinutes: 480, payableHours: '8.00', baseAmount: '184.00',
  allowanceAmount: '42.00', earnedAmount: '226.00', dailyPaidAmount: '0.00',
  payableAmount: '226.00', allowanceItems: [
    { allowanceName: '夜班补贴', amount: '30.00' },
    { allowanceName: '高温补贴', amount: '12.00' }
  ], calculationStatus: 'READY', blockedReason: null
});
```

同时断言 `ABSENT` 返回零、`MISSING_PUNCH` 返回 `BLOCKED`、`DAILY_PAID` 从待发金额扣除已支付金额、负数和非法金额抛出 `INVALID_WAGE_INPUT`。

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `node test/hourly-wage-calculator.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现纯函数**

金额先解析为整数分；半小时时薪使用以下整数公式：

```js
const baseCents = Math.round(hourlyRateCents * payableMinutes / 60);
const hourlyAllowanceCents = Math.round(unitAmountCents * payableMinutes / 60);
```

只接受 `DAY` / `NIGHT`、三种结算方式和两种补贴方式。`MISSING_PUNCH` 或未审核异常返回阻断结果，不抛系统错误。

- [ ] **Step 4: 运行纯函数测试**

Run: `node test/hourly-wage-calculator.test.js`

Expected: PASS.

- [ ] **Step 5: 扩展专项命令并提交**

将该测试追加到 `test:hourly-wage`，然后执行：

Run: `npm run test:hourly-wage`

```bash
git add src/services/hourly-wage-calculator.service.js test/hourly-wage-calculator.test.js package.json
git commit -m "feat: calculate half-hour wages and allowances"
```

### Task 3: 项目双班次与补贴规则服务

**Files:**
- Modify: `src/services/attendance-project.service.js`
- Modify: `test/web-project-attendance-service.test.js`
- Create: `test/attendance-project-wage-rules.test.js`

**Interfaces:**
- Consumes: 现有 `getProjectSettings`、`saveProjectSettings`、规则不可变检查和项目围栏事务。
- Produces: `validateShiftRules(shifts)`、`validateAllowances(allowances)`；设置响应中的 `shifts` 和 `allowances`。

- [ ] **Step 1: 写规则校验失败测试**

```js
const validShifts = [
  { shiftType: 'DAY', workStartTime: '08:00', workEndTime: '17:00', restStartTime: '12:00', restEndTime: '13:00', standardHours: 8, hourlyRate: '20.00' },
  { shiftType: 'NIGHT', workStartTime: '20:00', workEndTime: '05:00', restStartTime: '00:00', restEndTime: '01:00', standardHours: 8, hourlyRate: '23.00' }
];
assert.equal(service.validateShiftRules(validShifts)[1].standardMinutes, 480);
assert.throws(() => service.validateShiftRules(validShifts.slice(0, 1)), error => error.businessCode === 'INVALID_SHIFT_RULE');
assert.throws(() => service.validateShiftRules([{ ...validShifts[0], standardHours: 7.25 }, validShifts[1]]), error => error.businessCode === 'INVALID_SHIFT_RULE');
assert.throws(() => service.validateAllowances([
  { allowanceName: '餐补', shiftScope: 'ALL', calculationType: 'PER_SHIFT', unitAmount: '10.00' },
  { allowanceName: '餐补', shiftScope: 'ALL', calculationType: 'PER_SHIFT', unitAmount: '12.00' }
]), error => error.businessCode === 'DUPLICATE_ALLOWANCE');
```

- [ ] **Step 2: 运行测试确认新接口不存在**

Run: `node test/attendance-project-wage-rules.test.js`

Expected: FAIL because `validateShiftRules` is not exported.

- [ ] **Step 3: 实现读取、校验和事务写入**

`saveProjectSettings` 仍写父规则，父表时间字段使用白班兼容值；同一事务插入两条 `attendance_project_shift_rules` 和全部 `attendance_allowance_rules`。新规则要求时薪大于等于零、标准小时为 `0.5` 倍数且不超过 24；夜班允许 `workEndTime <= workStartTime`。已生效或已被排班/计算引用的版本继续返回 `PROJECT_RULE_IMMUTABLE`。

- [ ] **Step 4: 更新旧服务测试的请求和响应**

现有 `saveProjectSettings` 测试补充 `shifts`、`allowances`，并断言事务内恰好插入 `DAY`、`NIGHT` 两条班次；旧规则读取没有子表时返回兼容 `shifts`，但标记 `hourlyRate: null`，不能自动计薪。

- [ ] **Step 5: 运行项目规则回归**

Run: `node test/attendance-project-wage-rules.test.js`

Run: `node test/web-project-attendance-service.test.js`

Expected: PASS.

- [ ] **Step 6: 提交规则服务**

```bash
git add src/services/attendance-project.service.js test/attendance-project-wage-rules.test.js test/web-project-attendance-service.test.js
git commit -m "feat: configure project day and night wages"
```

### Task 4: 员工计薪版本与每日班次覆盖

**Files:**
- Create: `src/services/employee-pay-profile.service.js`
- Modify: `src/services/attendance.service.js`
- Create: `test/employee-pay-profile.test.js`
- Create: `test/attendance-shift-assignment.test.js`

**Interfaces:**
- Consumes: `projectScope`、`factory_staff` 有效任职、项目生效规则。
- Produces: `savePayProfile(companyId,user,operatorId,projectId,employeeId,body)`、`resolvePayProfile(client,companyId,projectId,employeeId,date)`、`upsertProjectSchedules(...)`、`resolveEmployeeShift(...)`。

- [ ] **Step 1: 写数据范围和版本解析失败测试**

覆盖：员工不属于项目返回 `EMPLOYEE_PROJECT_FORBIDDEN`；`effective_from <= shiftDate` 按日期倒序取一条；每日 `NIGHT` 排班覆盖员工默认 `DAY`；无每日排班时返回默认班次；无计薪配置时返回阻断信息而不是猜测。

```js
assert.deepEqual(await service.resolvePayProfile(client, 3, 12, 101, '2026-10-08'), {
  profileId: 9, defaultShiftType: 'DAY', settlementMode: 'DAILY_PAID', effectiveFrom: '2026-10-01'
});
assert.equal((await attendance.resolveEmployeeShift(client, 3, 12, 101, '2026-10-08')).shiftType, 'NIGHT');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node test/employee-pay-profile.test.js`

Run: `node test/attendance-shift-assignment.test.js`

Expected: FAIL with missing modules/functions.

- [ ] **Step 3: 实现员工计薪版本服务**

保存时验证 `DAY` / `NIGHT`、三种结算方式、日期和有效任职；同一生效日期使用参数化 `INSERT ... ON DUPLICATE KEY UPDATE`，已进入已确认工资计算的版本不可修改。写入 `hr_operation_log`，审计数据只含 ID、班次、结算方式和生效日期。

- [ ] **Step 4: 扩展排班写入和班次解析**

新增项目批量排班事务：先校验所有员工属于项目，再根据日期解析项目规则和对应班次规则，写入 `project_rule_id`、`project_shift_rule_id`、`shift_type`。保留现有单员工 `upsertSchedule` 兼容入口。

- [ ] **Step 5: 运行专项与原考勤测试**

Run: `node test/employee-pay-profile.test.js`

Run: `node test/attendance-shift-assignment.test.js`

Run: `npm run test:attendance`

Expected: PASS.

- [ ] **Step 6: 提交员工计薪和排班**

```bash
git add src/services/employee-pay-profile.service.js src/services/attendance.service.js test/employee-pay-profile.test.js test/attendance-shift-assignment.test.js
git commit -m "feat: resolve employee pay profiles and shifts"
```

### Task 5: 工资预览生成与版本化快照

**Files:**
- Create: `src/services/wage-calculation.service.js`
- Create: `test/wage-calculation-preview.test.js`
- Create: `test/wage-calculation-isolation.test.js`

**Interfaces:**
- Consumes: `calculateDailyWage`、员工计薪版本、班次规则、核准考勤、日结记录。
- Produces: `createPreview(companyId,user,operatorId,{projectId,salaryMonth})`、`getPreview(companyId,user,runId)`。

- [ ] **Step 1: 写预览事务失败测试**

构造两名员工：一名 `DAILY_ACCRUAL` 正常出勤，一名缺卡。断言新 revision 取消旧 `PREVIEW`、读取 `approved_normal_minutes + approved_overtime_minutes`、保存逐日快照、汇总金额，并返回 `blockedCount: 1`。

```js
const result = await service.createPreview(3, scopedUser, 9, { projectId: 12, salaryMonth: '2026-10' });
assert.equal(result.revisionNo, 2);
assert.equal(result.totalEarned, '226.00');
assert.equal(result.totalDailyPaid, '0.00');
assert.equal(result.totalPayable, '226.00');
assert.equal(result.blockedCount, 1);
assert.ok(writes.some(item => /UPDATE wage_calculation_runs SET status='CANCELLED'/.test(item.sql)));
```

- [ ] **Step 2: 运行测试确认服务缺失**

Run: `node test/wage-calculation-preview.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [ ] **Step 3: 实现月份输入、范围校验和批量读取**

月份严格匹配 `YYYY-MM`。一次读取项目员工、月份考勤、排班、项目规则、计薪版本和日结状态，使用 Map 在内存按员工日关联，避免 N+1 查询。所有 SQL 包含 `company_id` 和项目范围条件。

- [ ] **Step 4: 实现 revision 和快照事务**

事务内锁定同项目月份的计算批次，取 `MAX(revision_no)+1`，取消旧预览，创建 run 和 daily lines。金额传入数据库时使用两位小数字符串；`allowance_snapshot` 使用 `JSON.stringify` 后参数化写入。

- [ ] **Step 5: 验证隔离和阻断规则**

Run: `node test/wage-calculation-preview.test.js`

Run: `node test/wage-calculation-isolation.test.js`

Expected: PASS；跨企业、越权项目、缺失时薪、缺失计薪设置、缺卡和待处理异常均被测试覆盖。

- [ ] **Step 6: 提交预览服务**

```bash
git add src/services/wage-calculation.service.js test/wage-calculation-preview.test.js test/wage-calculation-isolation.test.js
git commit -m "feat: generate versioned wage previews"
```

### Task 6: 日结状态与工资批次确认

**Files:**
- Modify: `src/services/wage-calculation.service.js`
- Modify: `src/services/operations.service.js`
- Create: `test/wage-daily-payment.test.js`
- Create: `test/wage-calculation-confirm.test.js`
- Modify: `test/payroll-batch-detail.test.js`
- Modify: `test/payslip-dynamic-items-security.test.js`

**Interfaces:**
- Consumes: 最新无阻断 `PREVIEW`、现有工资批次和动态工资条快照。
- Produces: `setDailyPayment(...)`、`confirmPreview(...)`，以及自动批次中的“当月应得、已日结、月度待发”展示项。

- [ ] **Step 1: 写日结状态测试**

覆盖：仅 `DAILY_PAID` 可标记；金额取最新可计薪日明细；重复 `MARK_PAID` 幂等；`REVOKE` 必须有原因；标记和撤销均写审计；撤销后可重新生成预览。

```js
const paid = await service.setDailyPayment(3, scopedUser, 9, {
  projectId: 12, employeeId: 101, shiftDate: '2026-10-08', action: 'MARK_PAID', remark: '现金日结已确认'
});
assert.deepEqual(paid, { employeeId: 101, shiftDate: '2026-10-08', status: 'PAID', amount: '226.00' });
```

- [ ] **Step 2: 写确认幂等和事务回滚测试**

断言：有阻断项返回 `WAGE_PREVIEW_BLOCKED`；确认创建 `source_type='ATTENDANCE_AUTO'` 的 `salary_batch`；`gross_amount` 为应得、`other_deduction` 包含已日结、`net_amount` 为待发；第二次确认返回同一批次；写明细失败时 run 不得变为 `CONFIRMED`。

- [ ] **Step 3: 运行测试确认失败**

Run: `node test/wage-daily-payment.test.js`

Run: `node test/wage-calculation-confirm.test.js`

Expected: FAIL because methods are missing.

- [ ] **Step 4: 实现日结状态事务**

锁定员工日记录，校验项目任职和结算方式。`MARK_PAID` 保存整日 `earned_amount`；`REVOKE` 更新状态、撤销人、撤销时间和原因，不删除记录。

- [ ] **Step 5: 实现确认事务和工资条快照**

锁定 run 后再次检查其为最新 `PREVIEW` 且 `blocked_count=0`。先查询 `salary_batch.calculation_run_id` 处理幂等，再创建批次和员工汇总明细。`item_snapshot` 包含逐日数组和三个固定展示项，不写员工不应看到的内部规则 ID。

- [ ] **Step 6: 运行工资回归**

Run: `node test/wage-daily-payment.test.js`

Run: `node test/wage-calculation-confirm.test.js`

Run: `node test/payroll-batch-detail.test.js`

Run: `node test/payslip-dynamic-items-security.test.js`

Expected: PASS.

- [ ] **Step 7: 提交日结和确认服务**

```bash
git add src/services/wage-calculation.service.js src/services/operations.service.js test/wage-daily-payment.test.js test/wage-calculation-confirm.test.js test/payroll-batch-detail.test.js test/payslip-dynamic-items-security.test.js
git commit -m "feat: confirm wage previews and daily settlements"
```

### Task 7: 后端 API、权限和契约

**Files:**
- Modify: `src/routes/attendance.routes.js`
- Modify: `src/controllers/attendance.controller.js`
- Modify: `src/routes/operations.routes.js`
- Modify: `src/controllers/operations.controller.js`
- Create: `test/hourly-wage-api.test.js`
- Modify: `test/web-project-attendance-api.test.js`
- Modify: `test/role-permission-matrix.test.js`

**Interfaces:**
- Consumes: Tasks 3-6 的服务方法。
- Produces: 设计文档第 6 节定义的设置、计薪、排班、预览、确认和日结 REST API。

- [ ] **Step 1: 写路由权限失败测试**

```js
assert.match(attendanceRoutes, /put\('\/attendance\/projects\/:projectId\/employees\/:employeeId\/pay-profile',[\s\S]*requirePermission\('payroll:manage'\)/);
assert.match(attendanceRoutes, /put\('\/attendance\/projects\/:projectId\/schedules',[\s\S]*requirePermission\('attendance:manage'\)/);
assert.match(operationsRoutes, /post\('\/payroll\/calculations\/preview',[\s\S]*sensitiveLimiter[\s\S]*requirePermission\('payroll:manage'\)/);
assert.match(operationsRoutes, /get\('\/payroll\/calculations\/:runId',[\s\S]*requirePermission\('payroll:view'\)/);
assert.match(operationsRoutes, /post\('\/payroll\/calculations\/:runId\/confirm',[\s\S]*sensitiveLimiter[\s\S]*requirePermission\('payroll:manage'\)/);
assert.match(operationsRoutes, /get\('\/payroll\/daily-payments',[\s\S]*requirePermission\('payroll:view'\)/);
assert.match(operationsRoutes, /put\('\/payroll\/daily-payments',[\s\S]*sensitiveLimiter[\s\S]*requirePermission\('payroll:manage'\)/);
```

- [ ] **Step 2: 运行 API 契约并确认失败**

Run: `node test/hourly-wage-api.test.js`

Expected: FAIL on the first missing route.

- [ ] **Step 3: 添加 controller 适配和路由**

Controller 只负责从 `req.companyId`、`req.user`、`req.operatorId`、路径、query 和 body 取值，调用服务并使用 `success`。生成预览、确认和更新日结状态接口必须经过 `sensitiveLimiter`；预览详情和日结列表使用 `payroll:view` 并执行项目范围校验。

- [ ] **Step 4: 补充接口输入和错误响应测试**

覆盖无权限、项目越权、非法月份、非法班次、无效结算方式、重复确认和阻断确认；错误码与设计文档一致。

- [ ] **Step 5: 运行契约和权限回归**

Run: `node test/hourly-wage-api.test.js`

Run: `node test/web-project-attendance-api.test.js`

Run: `node test/role-permission-matrix.test.js`

Run: `node -e "require('./src/app'); console.log('express-route-load-ok')"`

Expected: PASS and route load output.

- [ ] **Step 6: 提交 API**

```bash
git add src/routes/attendance.routes.js src/controllers/attendance.controller.js src/routes/operations.routes.js src/controllers/operations.controller.js test/hourly-wage-api.test.js test/web-project-attendance-api.test.js test/role-permission-matrix.test.js
git commit -m "feat: expose hourly wage management APIs"
```

### Task 8: 考勤小时展示、双班次、补贴和员工设置页面

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/views/attendance.js`
- Modify: `public/styles.css`
- Create: `test/web-attendance-hours-ui.test.js`
- Create: `test/web-attendance-wage-settings.test.js`
- Modify: `test/web-project-attendance-ui.test.js`

**Interfaces:**
- Consumes: 项目 settings、员工 pay-profile、批量 schedules API。
- Produces: 小时制日报/月报、白班/夜班设置、动态补贴、员工默认班次/结算方式和每日排班操作界面。

- [ ] **Step 1: 写小时展示和表单契约失败测试**

断言页面不再出现“标准分钟”“核准正常分钟”“核准加班分钟”，存在两组 `data-shift-type="DAY|NIGHT"`、`standardHours`、`hourlyRate`、补贴增删区、员工计薪区和每日排班区。

```js
assert.doesNotMatch(html, />标准分钟</);
assert.match(html, /data-shift-type="DAY"/);
assert.match(html, /data-shift-type="NIGHT"/);
assert.match(html, /name="standardHours"[^>]*step="0\.5"/);
assert.match(html, /id="attendanceAllowanceRows"/);
assert.match(html, /id="attendanceEmployeePayBody"/);
```

- [ ] **Step 2: 运行 UI 契约确认失败**

Run: `node test/web-attendance-hours-ui.test.js`

Run: `node test/web-attendance-wage-settings.test.js`

Expected: FAIL on missing markup.

- [ ] **Step 3: 改造项目设置表单和序列化**

`fillAttendanceSettings` 按 `shiftType` 填入白班/夜班；保存时构建 `shifts` 和 `allowances` 数组。补贴新增行使用原生模板函数，删除按钮使用熟悉的删除图标并提供 `title`。金额字段使用 `step="0.01"`，标准小时使用 `step="0.5"`。

- [ ] **Step 4: 增加员工计薪和每日排班交互**

项目切换后加载有效员工和配置；保存员工配置时要求生效日期。每日排班以日期和员工勾选列表批量提交，未选择的员工不写排班，不覆盖其默认班次。

- [ ] **Step 5: 将报表文案和数值统一为小时**

保留 API 分钟值，使用统一格式函数输出最多两位小数小时，例如 `480 -> 8小时`、`450 -> 7.5小时`；日报/月报汇总标题改为“核准正常小时”“核准加班小时”。

- [ ] **Step 6: 完成响应式样式并运行测试**

白班/夜班区域并列显示，窄屏改为单列；补贴、员工和排班使用独立表格区，不嵌套卡片。固定输入宽度和操作列宽度，避免动态行导致布局跳动。

Run: `node test/web-attendance-hours-ui.test.js`

Run: `node test/web-attendance-wage-settings.test.js`

Run: `node test/web-project-attendance-ui.test.js`

Expected: PASS.

- [ ] **Step 7: 提交考勤页面**

```bash
git add public/index.html public/js/views/attendance.js public/styles.css test/web-attendance-hours-ui.test.js test/web-attendance-wage-settings.test.js test/web-project-attendance-ui.test.js
git commit -m "feat: manage hourly shifts and employee pay settings"
```

### Task 9: 工资预览与日结统计页面

**Files:**
- Create: `public/js/views/wage-calculation.js`
- Modify: `public/index.html`
- Modify: `public/js/core/router.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Create: `test/web-wage-calculation-ui.test.js`
- Create: `test/web-daily-payment-ui.test.js`

**Interfaces:**
- Consumes: 工资预览、预览详情、确认和日结 API。
- Produces: 工资模块“自动计算”和“日结统计”工作区，并在确认后刷新现有工资批次列表。

- [ ] **Step 1: 写页面结构失败测试**

```js
assert.match(html, /data-payroll-workspace="calculation"/);
assert.match(html, /id="wageCalculationProject"/);
assert.match(html, /id="wageCalculationMonth"/);
assert.match(html, /id="wagePreviewSummary"/);
assert.match(html, /id="wageDailyPaymentBody"/);
assert.match(html, /src="\/js\/views\/wage-calculation\.js"/);
```

同时断言确认按钮只有 `blockedCount === 0` 时启用，撤销日结必须通过确认对话框并提交非空原因。

- [ ] **Step 2: 运行 UI 测试确认失败**

Run: `node test/web-wage-calculation-ui.test.js`

Run: `node test/web-daily-payment-ui.test.js`

Expected: FAIL on missing workspace.

- [ ] **Step 3: 实现工资计算工作区**

实现项目/月选择、生成预览、四项汇总、员工折叠明细和阻断列表。预览行展示日期、班次、实际小时、计薪小时、时薪、补贴、应得、已日结和待发；金额统一 `¥0.00`。

- [ ] **Step 4: 实现确认和现有工资模块衔接**

确认前显示项目、月份、人数、应得和待发金额；调用确认 API 后切换到现有工资批次列表并执行 `loadPayroll()`。不复刻复核、发布和工资条功能。

- [ ] **Step 5: 实现日结筛选和状态操作**

按项目、日期、员工关键字和支付状态筛选。标记支付使用提交锁；撤销先要求输入原因，空原因不得发请求。操作成功后重载当前预览和日结列表。

- [ ] **Step 6: 运行页面测试与工资回归**

Run: `node test/web-wage-calculation-ui.test.js`

Run: `node test/web-daily-payment-ui.test.js`

Run: `node test/web-payroll-overview-records.test.js`

Run: `node test/payroll-batch-detail.test.js`

Expected: PASS.

- [ ] **Step 7: 提交工资页面**

```bash
git add public/js/views/wage-calculation.js public/index.html public/js/core/router.js public/app.js public/styles.css test/web-wage-calculation-ui.test.js test/web-daily-payment-ui.test.js
git commit -m "feat: add wage preview and daily settlement workspace"
```

### Task 10: 腾讯地图围栏选点与无 Key 降级

**Files:**
- Modify: `src/config/env.js`
- Create: `src/services/attendance-map-config.service.js`
- Modify: `src/controllers/attendance.controller.js`
- Modify: `src/routes/attendance.routes.js`
- Create: `public/js/views/attendance-map.js`
- Modify: `public/index.html`
- Modify: `public/js/views/attendance.js`
- Modify: `public/styles.css`
- Create: `test/attendance-map-config.test.js`
- Create: `test/web-attendance-map.test.js`

**Interfaces:**
- Consumes: `TENCENT_MAP_JS_KEY`、现有围栏经纬度和半径表单。
- Produces: `GET /api/attendance/map-config`、搜索/点选/半径预览和手工输入降级。

- [ ] **Step 1: 写配置安全和降级失败测试**

```js
assert.deepEqual(service.getClientConfig({ tencentMapJsKey: '' }), {
  provider: 'TENCENT', enabled: false, jsKey: null
});
assert.deepEqual(service.getClientConfig({ tencentMapJsKey: 'domain-limited-key' }), {
  provider: 'TENCENT', enabled: true, jsKey: 'domain-limited-key'
});
assert.doesNotMatch(configSource, /TENCENT_MAP_SERVER_KEY.*jsKey/);
```

页面测试断言：地图容器、地址搜索、加载失败提示存在；纬度、经度输入始终保留且 SDK 失败时不禁用保存按钮。

- [ ] **Step 2: 运行配置和页面测试确认失败**

Run: `node test/attendance-map-config.test.js`

Run: `node test/web-attendance-map.test.js`

Expected: FAIL with missing service/markup.

- [ ] **Step 3: 添加环境配置和受权接口**

`src/config/env.js` 读取 `TENCENT_MAP_JS_KEY`，不设置默认真实值。接口仅允许 `attendance:manage`，返回浏览器 Key；日志、错误和测试输出不得打印 Key。

- [ ] **Step 4: 实现地图适配器**

`attendance-map.js` 暴露 `initAttendanceMap({container,searchInput,latitudeInput,longitudeInput,radiusInput,statusElement})`。按需加载腾讯地图 SDK；点击地图或搜索结果时更新坐标；半径变化时更新圆形覆盖物；重复初始化先销毁旧实例和监听器。

- [ ] **Step 5: 实现失败降级**

无 Key、脚本超时、SDK 报错或搜索失败时显示“地图服务未配置或暂不可用，请手工填写经纬度”，保持坐标和保存按钮可编辑。地图错误不能调用围栏保存 API，也不能清空用户已输入坐标。

- [ ] **Step 6: 运行地图、围栏和安全测试**

Run: `node test/attendance-map-config.test.js`

Run: `node test/web-attendance-map.test.js`

Run: `npm run test:attendance-geofence`

Run: `node test/security-hardening.test.js`

Expected: PASS.

- [ ] **Step 7: 提交地图功能**

```bash
git add src/config/env.js src/services/attendance-map-config.service.js src/controllers/attendance.controller.js src/routes/attendance.routes.js public/js/views/attendance-map.js public/index.html public/js/views/attendance.js public/styles.css test/attendance-map-config.test.js test/web-attendance-map.test.js
git commit -m "feat: select attendance geofences on Tencent Map"
```

### Task 11: 小程序显示、完整回归和本地验收文档

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/attendance-management/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/attendance-management/index.wxml`
- Modify: `test/miniprogram-manager-attendance.test.js`
- Modify: `package.json`
- Create: `docs/attendance-hourly-wage-verification.md`

**Interfaces:**
- Consumes: 后端仍返回的分钟字段和全部新功能。
- Produces: 小程序小时文案、完整专项测试命令和可重复的本地验收清单。

- [ ] **Step 1: 写小程序小时文案失败测试**

断言管理端考勤页不显示“正常分钟/加班分钟”，`hoursText` 对 `480` 返回 `8小时`、对 `450` 返回 `7.5小时`，且不改变员工打卡请求结构。

- [ ] **Step 2: 运行测试确认旧文案失败**

Run: `node test/miniprogram-manager-attendance.test.js`

Expected: FAIL on minute wording or hour formatting assertion.

- [ ] **Step 3: 修改小程序展示并保持接口兼容**

只修改管理端考勤展示，不增加地图选点、不修改员工打卡定位和小程序版本号。继续接收 `approvedNormalMinutes` / `approvedOvertimeMinutes`，本地转换为小时文本。

- [ ] **Step 4: 完善专项命令**

`test:hourly-wage` 最终依次运行 schema、calculator、project rules、pay profile、shift assignment、preview、isolation、daily payment、confirm、API 和 Web UI/地图测试。命令中不得跳过失败测试。

- [ ] **Step 5: 编写本地验收文档**

文档包含以下可执行场景：

1. 配置白班 08:00-17:00、夜班 20:00-05:00及各自时薪。
2. 配置一个按班次夜班补贴和一个按小时全班次补贴。
3. 设置月结、日累计月底发、日结已支付三名测试员工。
4. 验证 7:14、7:15、7:44、7:45 四个取整边界。
5. 验证夜班归属上班日、每日排班覆盖默认班次。
6. 验证缺卡阻断、处理后重算、日结标记和月底防重复。
7. 验证有 Key 地图选点及无 Key 手工输入。
8. 验证自动批次进入现有待复核流程。

验收文档不得包含真实员工、工资、电话、身份证、Token 或地图 Key。

- [ ] **Step 6: 运行专项和全量检查**

Run: `npm run test:hourly-wage`

Run: `npm run test:attendance`

Run: `npm run test:attendance-geofence`

Run: `npm run test:web-project-attendance`

Run: `npm run check`

Run: `npm run postcheck`

Run: `npm audit --audit-level=high`

Run: `git diff --check`

Expected: all exit 0; audit has zero high/critical vulnerabilities.

- [ ] **Step 7: 做桌面与移动视觉验收**

启动本地服务后使用 Playwright 检查 `1440x900`、`1024x768` 和 `390x844`：项目双班次、补贴表、员工计薪、工资预览、日结列表和地图降级均无重叠或横向溢出；保存截图到临时目录，不提交包含业务数据的截图。

- [ ] **Step 8: 核对工作区边界并提交最终验证改动**

先运行 `git status --short`，确认没有暂存任务外文件。

```bash
git add wechat-miniprogram/miniprogram/pages/attendance-management/index.js wechat-miniprogram/miniprogram/pages/attendance-management/index.wxml test/miniprogram-manager-attendance.test.js package.json docs/attendance-hourly-wage-verification.md
git commit -m "test: verify hourly attendance wage workflow"
```

## Execution Notes

- 每个任务结束后先运行该任务列出的测试，再提交；不能把多个失败任务堆到最后统一修复。
- 若现有未提交改动与计划文件重叠，先读取并合并当前内容，不从 `HEAD` 覆盖文件。
- 任何生产迁移、部署、腾讯地图控制台配置或小程序上传都需要新的明确确认。
