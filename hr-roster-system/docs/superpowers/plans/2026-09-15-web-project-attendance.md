# Web Project Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在优益数字化管理系统网页端交付按授权客户项目隔离的考勤设置、客户围栏复用、按天查看和按月汇总。

**Architecture:** 在现有 attendance 路由和服务之上增加项目规则、特殊日历、客户围栏库及项目围栏关系，并为排班、打卡、每日结果补充不可变的项目快照。网页端继续使用原生 SPA，通过客户和项目级联选择驱动所有读取与写入，服务端以 `projectScope` / `customerScope` 做最终授权。

**Tech Stack:** Node.js 18、Express 4.22、MySQL 8.4/mysql2、Vanilla JS SPA、现有 Node `assert` 契约测试。

**Spec:** `docs/superpowers/specs/2026-09-15-web-project-attendance-design.md`

## Global Constraints

- 网页端驻厂人员只能查看和维护 `sys_user_project` 授权范围内的项目。
- 日报、月报和异常列表必须提供 `projectId`，不提供驻厂跨项目合并统计。
- 日报和月报使用 `attendance:view`，项目规则与围栏设置使用 `attendance:manage`，异常处理保持独立的 `attendance:review` 权限。
- 客户围栏可被同一客户的多个项目复用，一个项目可启用多个围栏，禁止跨客户关联。
- 围栏异常允许打卡并进入审核；不保存轨迹，不在普通列表返回原始经纬度。
- 项目规则按生效日期版本化，员工调项目后不改变历史项目归属。
- SQL 全部参数化；迁移禁止 `DELETE`、`DROP`、`TRUNCATE`，`ALTER` 先查 `information_schema`。
- 本期不实现复杂轮班、跨夜班、多段班、自动薪资结算和 Excel 导出。
- 不执行生产迁移、上传、部署或远程推送。
- 工作区已有考勤、工资条和发布脚本改动；修改重叠文件前先阅读完整差异，禁止覆盖、回退或把不属于本任务的改动误归入任务提交。无法干净拆分时保留为未提交并在验收报告中说明。

---

### Task 1: 项目考勤数据库兼容迁移

**Files:**
- Create: `sql/migrate-web-project-attendance-20260915.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Modify: `package.json`
- Test: `test/web-project-attendance-schema.test.js`
- Test: `test/release-migration-consistency.test.js`

**Interfaces:**
- Consumes: `labor_customer.id`、`labor_project.customer_id`、现有 `attendance_geofences.project_id`。
- Produces: `attendance_project_rules`、`attendance_project_calendar`、`attendance_project_geofence`，以及三个历史表的 `project_id` 快照列。

- [ ] **Step 1: 写失败的结构契约测试**

```js
const fs = require('node:fs');
const assert = require('node:assert/strict');
const sql = fs.readFileSync('sql/migrate-web-project-attendance-20260915.mysql.sql', 'utf8');

for (const table of ['attendance_project_rules', 'attendance_project_calendar', 'attendance_project_geofence']) {
  assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(sql, /attendance_geofences[\s\S]*customer_id/);
for (const table of ['attendance_schedules', 'attendance_punches', 'attendance_daily_results']) {
  assert.match(sql, new RegExp(`TABLE_NAME='${table}'[\\s\\S]*COLUMN_NAME='project_id'`));
}
assert.doesNotMatch(sql, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
```

- [ ] **Step 2: 运行测试确认正确失败**

Run: `node test/web-project-attendance-schema.test.js`

Expected: FAIL，原因是迁移文件或新表尚不存在。

- [ ] **Step 3: 创建幂等迁移**

迁移必须包含以下实体和索引：

```sql
CREATE TABLE IF NOT EXISTS attendance_project_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  rule_name VARCHAR(100) NOT NULL,
  work_start_time TIME NOT NULL,
  work_end_time TIME NOT NULL,
  rest_start_time TIME DEFAULT NULL,
  rest_end_time TIME DEFAULT NULL,
  standard_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 480,
  late_grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  early_grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  overtime_min_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  work_weekdays VARCHAR(20) NOT NULL,
  effective_from DATE NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_rule_effective (company_id, project_id, effective_from),
  KEY idx_attendance_project_rule_lookup (company_id, project_id, status, effective_from)
);
```

同时创建 `attendance_project_calendar`、`attendance_project_geofence`，为 `attendance_geofences` 幂等增加 `customer_id` / `updated_by`，为 `attendance_schedules`、`attendance_punches`、`attendance_daily_results` 幂等增加 `project_id` 和 `(company_id, project_id, shift_date)` 索引。用 `attendance_geofences.project_id -> labor_project.customer_id` 回填客户和项目围栏关系；无法可靠确定的历史快照保持空值。

- [ ] **Step 4: 同步全量结构和发布清单**

在 `sql/schema.mysql.sql` 表达最终结构；将新迁移按现有顺序加入部署和发布包验证脚本。`package.json` 新增：

```json
"test:web-project-attendance": "node test/web-project-attendance-schema.test.js && node test/web-project-attendance-service.test.js && node test/web-project-attendance-api.test.js && node test/web-project-attendance-ui.test.js && node test/web-project-attendance-isolation.test.js"
```

- [ ] **Step 5: 验证迁移和脚本**

Run: `node test/web-project-attendance-schema.test.js && node test/release-migration-consistency.test.js && bash -n scripts/deploy-production.sh && bash -n scripts/verify-release-package.sh && npm run lint && git diff --check`

Expected: 全部退出码 0。

- [ ] **Step 6: 提交数据库任务**

```bash
git add sql/migrate-web-project-attendance-20260915.mysql.sql sql/schema.mysql.sql scripts/deploy-production.sh scripts/verify-release-package.sh package.json test/web-project-attendance-schema.test.js test/release-migration-consistency.test.js
git commit -m "feat: add project attendance schema"
```

### Task 2: 项目规则、特殊日期与可访问项目服务

**Files:**
- Create: `src/services/attendance-project.service.js`
- Modify: `src/controllers/attendance.controller.js`
- Modify: `src/routes/attendance.routes.js`
- Test: `test/web-project-attendance-service.test.js`
- Test: `test/web-project-attendance-api.test.js`

**Interfaces:**
- Consumes: `projectScope(user, params, 'p')`、`attendance_project_rules`、`attendance_project_calendar`。
- Produces: `listProjects(companyId, user)`、`getProjectSettings(companyId, user, projectId)`、`saveProjectSettings(companyId, user, operatorId, projectId, body)`、`listCalendar(companyId, user, projectId, month)`、`saveCalendarDay(companyId, user, operatorId, projectId, body)`、`resolveProjectRule(client, companyId, projectId, shiftDate)`。

- [ ] **Step 1: 写服务和路由失败测试**

```js
const service = require('../src/services/attendance-project.service');
for (const name of ['listProjects', 'getProjectSettings', 'saveProjectSettings', 'listCalendar', 'saveCalendarDay', 'resolveProjectRule']) {
  assert.equal(typeof service[name], 'function', `${name} missing`);
}
assert.match(routes, /get\('\/attendance\/projects'/);
assert.match(routes, /get\('\/attendance\/projects\/:projectId\/settings'/);
assert.match(routes, /put\('\/attendance\/projects\/:projectId\/settings'/);
assert.match(routes, /get\('\/attendance\/projects\/:projectId\/exceptions'/);
assert.match(routes, /put\('\/attendance\/projects\/:projectId\/exceptions'/);
```

- [ ] **Step 2: 运行测试确认正确失败**

Run: `node test/web-project-attendance-service.test.js && node test/web-project-attendance-api.test.js`

Expected: FAIL，原因是项目服务和路由尚不存在。

- [ ] **Step 3: 实现输入校验和规则解析**

`saveProjectSettings` 校验：项目授权、`HH:mm` 时间、`workWeekdays` 是 1-7 的去重整数、分钟为 0-1440 整数、`effectiveFrom` 为 `YYYY-MM-DD`。规则解析顺序：

```js
async function resolveProjectRule(client, companyId, projectId, shiftDate) {
  const rule = await firstActiveRuleOnOrBefore(client, companyId, projectId, shiftDate);
  if (!rule) return null;
  const exception = await findCalendarDay(client, companyId, projectId, shiftDate);
  const weekday = isoWeekday(shiftDate);
  return { ...rule, scheduleStatus: exception ? exception.dayType === 'WORKDAY' ? 'WORK' : 'REST' : rule.workWeekdays.includes(weekday) ? 'WORK' : 'REST' };
}
```

写入规则和日历使用参数化 SQL 与 upsert；新增、更新写 `sys_operation_log`，审计详情只记录项目、规则和日期摘要。

- [ ] **Step 4: 注册权限明确的控制器和路由**

```js
router.get('/attendance/projects', requireAuth, requirePermission('attendance:view'), controller.projects);
router.get('/attendance/projects/:projectId/settings', requireAuth, requirePermission('attendance:view'), controller.projectSettings);
router.put('/attendance/projects/:projectId/settings', requireAuth, requirePermission('attendance:manage'), controller.saveProjectSettings);
router.get('/attendance/projects/:projectId/exceptions', requireAuth, requirePermission('attendance:view'), controller.projectExceptions);
router.put('/attendance/projects/:projectId/exceptions', requireAuth, requirePermission('attendance:manage'), controller.saveProjectException);
```

- [ ] **Step 5: 运行专项检查**

Run: `node test/web-project-attendance-service.test.js && node test/web-project-attendance-api.test.js && npm run lint && git diff --check`

Expected: 全部退出码 0。

- [ ] **Step 6: 提交规则服务任务**

```bash
git add src/services/attendance-project.service.js src/controllers/attendance.controller.js src/routes/attendance.routes.js test/web-project-attendance-service.test.js test/web-project-attendance-api.test.js
git commit -m "feat: add project attendance settings"
```

### Task 3: 客户围栏库和多围栏项目关联

**Files:**
- Modify: `src/services/attendance-geofence-management.service.js`
- Modify: `src/services/attendance.service.js`
- Modify: `src/controllers/attendance.controller.js`
- Modify: `src/routes/attendance.routes.js`
- Test: `test/attendance-geofence-management.test.js`
- Test: `test/attendance-geofence-privacy.test.js`
- Test: `test/web-project-attendance-service.test.js`

**Interfaces:**
- Consumes: `customerScope`、`projectScope`、`attendance_project_geofence`。
- Produces: `list(companyId, user, { customerId, includeCoordinates })`、`create(companyId, user, operatorId, body)`、`update(companyId, user, operatorId, id, body)`、`replaceProjectGeofences(client, companyId, user, operatorId, projectId, geofenceIds)`、`evaluateEmployeeLocation(client, companyId, employeeId, projectId, location)`。

- [ ] **Step 1: 扩展失败测试**

新增断言覆盖：客户围栏不要求项目 ID；项目可关联多个同客户围栏；跨客户围栏返回 `GEOFENCE_CUSTOMER_MISMATCH`；`attendance:view` 列表不返回经纬度；驻厂不能修改未授权项目客户的孤立围栏；任一围栏命中即 `INSIDE`。

- [ ] **Step 2: 运行测试确认正确失败**

Run: `node test/attendance-geofence-management.test.js && node test/attendance-geofence-privacy.test.js && node test/web-project-attendance-service.test.js`

Expected: FAIL，原因是服务仍使用单项目围栏。

- [ ] **Step 3: 改造围栏管理服务**

创建和更新先调用客户范围断言：驻厂必须至少拥有该客户下一个授权项目；关联项目时分别执行项目授权、项目客户和围栏客户三项校验。只读列表使用明确字段投影：

```sql
SELECT g.id,g.customer_id AS customerId,c.customer_name AS customerName,
       g.fence_name AS fenceName,g.radius_meters AS radiusMeters,
       g.max_accuracy_meters AS maxAccuracyMeters,g.status
FROM attendance_geofences g
JOIN labor_customer c ON c.id=g.customer_id AND c.company_id=g.company_id
WHERE g.company_id=:companyId AND g.customer_id=:customerId
```

只有 `attendance:manage` 请求加入 `latitude`、`longitude`。

- [ ] **Step 4: 改造打卡多围栏判定**

从员工当日项目快照读取所有有效关联围栏；逐个执行现有 `evaluateGeofence`。任一结果 `INSIDE` 即返回该围栏；全部未命中时优先返回 `LOW_ACCURACY`、`LOCATION_FAILED`，否则返回距离最近的 `OUTSIDE`。写入 `attendance_punches.project_id`、实际围栏 ID、距离和半径快照。

- [ ] **Step 5: 运行围栏回归**

Run: `npm run test:attendance-geofence && node test/web-project-attendance-service.test.js && npm run lint && git diff --check`

Expected: 全部退出码 0；普通日报响应不包含 `latitude` / `longitude`。

- [ ] **Step 6: 提交围栏任务**

```bash
git add src/services/attendance-geofence-management.service.js src/services/attendance.service.js src/controllers/attendance.controller.js src/routes/attendance.routes.js test/attendance-geofence-management.test.js test/attendance-geofence-privacy.test.js test/web-project-attendance-service.test.js
git commit -m "feat: reuse customer geofences by project"
```

### Task 4: 项目排班快照、日报和月报

**Files:**
- Modify: `src/services/attendance.service.js`
- Modify: `src/controllers/attendance.controller.js`
- Test: `test/web-project-attendance-service.test.js`
- Test: `test/web-project-attendance-isolation.test.js`
- Test: `test/attendance-security-regression.test.js`

**Interfaces:**
- Consumes: `resolveProjectRule(client, companyId, projectId, shiftDate)`、`employeeScope`、`projectScope`。
- Produces: `ensureProjectSchedules(companyId, user, projectId, shiftDate)`、`listDaily(companyId, user, { projectId, date }) -> { project, summary, list, unresolvedHistoryCount }`、`listMonthly(companyId, user, { projectId, month }) -> { project, summary, list, unresolvedHistoryCount }`。

- [ ] **Step 1: 写统计和隔离失败测试**

用替身数据库记录 SQL 与参数，覆盖：缺少 `projectId` 返回 `PROJECT_REQUIRED`；未授权项目拒绝；日报按 `d.project_id` 过滤；月报按同一项目聚合；员工调项前后归属不同项目；特殊休息日不计旷工；没有规则显示 `NO_PROJECT_RULE`；汇总各状态合计与明细一致。

- [ ] **Step 2: 运行测试确认正确失败**

Run: `node test/web-project-attendance-service.test.js && node test/web-project-attendance-isolation.test.js`

Expected: FAIL，原因是日报和月报尚未要求项目 ID，也未返回项目汇总。

- [ ] **Step 3: 实现按日项目排班快照**

`ensureProjectSchedules` 在事务中查询目标日期有效项目员工，解析项目规则并幂等写入：

```sql
INSERT INTO attendance_schedules
  (company_id,employee_id,project_id,shift_date,shift_rule_id,schedule_status,created_by)
VALUES
  (:companyId,:employeeId,:projectId,:shiftDate,:shiftRuleId,:scheduleStatus,:operatorId)
ON DUPLICATE KEY UPDATE
  project_id=COALESCE(project_id,VALUES(project_id)), updated_at=CURRENT_TIMESTAMP
```

已有员工单日排班不覆盖其 `shift_rule_id` 和 `schedule_status`。

- [ ] **Step 4: 实现项目日报/月报**

入口先断言项目授权，再按 `attendance_daily_results.project_id` 查询。日报返回固定键：`scheduled`、`normal`、`late`、`earlyLeave`、`missingPunch`、`absent`、`geofenceException`；月报返回固定键：`employeeCount`、`approvedNormalMinutes`、`approvedOvertimeMinutes`。异常次数按同项目的打卡围栏状态聚合，不返回坐标。

- [ ] **Step 5: 强化异常审核项目范围**

异常列表要求 `projectId` 并按 `attendance_punches.project_id` 或每日结果项目快照过滤。审核前读取异常项目快照并调用项目范围断言，不能依赖员工当前项目。

- [ ] **Step 6: 运行考勤与隔离回归**

Run: `npm run test:attendance && node test/web-project-attendance-service.test.js && node test/web-project-attendance-isolation.test.js && node test/attendance-security-regression.test.js && npm run lint && git diff --check`

Expected: 全部退出码 0。

- [ ] **Step 7: 提交报表任务**

```bash
git add src/services/attendance.service.js src/controllers/attendance.controller.js test/web-project-attendance-service.test.js test/web-project-attendance-isolation.test.js test/attendance-security-regression.test.js
git commit -m "feat: scope attendance reports by project"
```

### Task 5: 网页端项目考勤工作台

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/views/attendance.js`
- Modify: `public/styles.css`
- Test: `test/web-project-attendance-ui.test.js`
- Test: `test/web-attendance-geofence.test.js`

**Interfaces:**
- Consumes: Task 2-4 的项目、设置、日历、围栏、日报、月报和异常 API。
- Produces: `loadAttendanceProjects()`、`selectAttendanceProject(projectId)`、`loadAttendanceDaily(projectId, date)`、`loadAttendanceMonthly(projectId, month)`、`loadAttendanceProjectSettings(projectId)`、`saveAttendanceProjectSettings(event)`、`loadAttendanceCustomerGeofences(customerId)`。

- [ ] **Step 1: 写页面失败测试**

```js
for (const id of ['attendanceCustomerFilter', 'attendanceProjectFilter', 'attendanceDate', 'attendanceMonth', 'attendanceProjectSettingsForm', 'attendanceCalendarForm', 'attendanceGeofenceForm']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(js, /\/api\/attendance\/projects/);
assert.match(js, /projectId=.*date=/);
assert.match(js, /projectId=.*month=/);
assert.match(js, /requestSequence/);
```

- [ ] **Step 2: 运行测试确认正确失败**

Run: `node test/web-project-attendance-ui.test.js && node test/web-attendance-geofence.test.js`

Expected: FAIL，原因是页面尚无项目级联、项目设置和特殊日期控件。

- [ ] **Step 3: 重排考勤页面结构**

顶部提供客户与项目 `<select>`、日期和月份输入；内容使用“按天查看 / 按月汇总 / 项目设置 / 客户围栏库”四个标签。日报展示汇总条和员工明细，月报展示员工聚合；不使用嵌套卡片。无项目时禁用所有业务表单并显示“当前账号暂无授权项目”。

- [ ] **Step 4: 实现项目驱动的数据加载**

`loadAttendance()` 先取 `/api/attendance/projects`，默认选择第一个授权项目。客户筛选只过滤已授权项目。每个异步加载捕获递增请求序号：

```js
const requestId = ++attendanceState.requestSequence;
const data = await api(url);
if (requestId !== attendanceState.requestSequence) return;
render(data);
```

日报、月报和异常请求始终携带当前 `projectId`。

- [ ] **Step 5: 实现项目规则与围栏设置**

星期使用七个复选框；特殊日期使用日期、类型选择和说明；围栏先选择当前项目所属客户，再编辑名称、坐标、半径和精度。项目设置中的围栏使用复选框多选。`attendance:view` 只呈现可见信息，`attendance:manage` 才显示坐标和保存操作。

- [ ] **Step 6: 实现错误和提交状态**

保存期间禁用对应提交按钮；成功后重新读取服务端设置；403 显示“项目不存在或无权访问”；空日报/月报分别显示空状态；失败提供明确重试按钮。

- [ ] **Step 7: 运行前端回归**

Run: `node test/web-project-attendance-ui.test.js && node test/web-attendance-geofence.test.js && npm run lint && git diff --check`

Expected: 全部退出码 0。

- [ ] **Step 8: 提交网页任务**

```bash
git add public/index.html public/js/views/attendance.js public/styles.css test/web-project-attendance-ui.test.js test/web-attendance-geofence.test.js
git commit -m "feat: add web project attendance workspace"
```

### Task 6: 完整权限、迁移与发布前验证

**Files:**
- Modify: `package.json`
- Modify: `docs/attendance-geofence-verification.md`
- Test: `test/web-project-attendance-isolation.test.js`
- Test: all attendance and repository checks

**Interfaces:**
- Consumes: Tasks 1-5 的数据库、API 和网页交付。
- Produces: 可重复执行的本地验收流程；不产生生产发布。

- [ ] **Step 1: 补齐角色交叉验证**

在 `test/web-project-attendance-isolation.test.js` 固定覆盖：企业管理员跨项目可见；驻厂 A 只能访问项目 A；驻厂 B 只能访问项目 B；驻厂 A 即使和项目 B 同客户也不能读取项目 B 员工考勤；跨客户围栏关联失败；薪资专员只读且不能保存设置。

- [ ] **Step 2: 运行项目考勤专项测试**

Run: `npm run test:web-project-attendance`

Expected: 所有项目考勤结构、服务、API、UI 和隔离测试通过。

- [ ] **Step 3: 运行既有考勤回归**

Run: `npm run test:attendance && npm run test:attendance-geofence`

Expected: 原有员工打卡、工时计算、围栏异常和小程序考勤测试全部通过。

- [ ] **Step 4: 运行全项目检查**

Run: `npm run lint && npm run check`

Expected: 退出码 0，无语法或回归失败。

- [ ] **Step 5: 运行安全和变更检查**

Run: `npm audit --audit-level=high && git diff --check`

Expected: high/critical 漏洞数为 0，变更格式检查通过。

- [ ] **Step 6: 更新本地验收文档**

在 `docs/attendance-geofence-verification.md` 加入：使用两个驻厂账号验证项目隔离；建立同客户两个围栏并关联一个项目；验证任一围栏内正常；验证工作日、特殊休息日、日报、月报和调项目历史归属。不写生产账号、密码、Token 或员工真实定位。

- [ ] **Step 7: 最终提交**

```bash
git add package.json docs/attendance-geofence-verification.md test/web-project-attendance-isolation.test.js
git commit -m "test: verify web project attendance flow"
```

## Self-Review Checklist

- [ ] 数据库任务覆盖客户围栏、项目多围栏、规则版本、特殊日期和三个项目快照列。
- [ ] 服务任务覆盖星期规则、特殊日期、员工单日排班优先级和调项目历史归属。
- [ ] 接口任务对所有项目读写执行服务端范围校验，日报、月报和异常必须带 `projectId`。
- [ ] 网页任务覆盖客户项目级联、按天、按月、项目设置、特殊日期和客户围栏库。
- [ ] 隔离测试覆盖同客户不同项目，证明驻厂权限保持项目独立。
- [ ] 计划不包含复杂轮班、跨夜班、多段班、自动薪资结算、Excel 导出和生产部署。
