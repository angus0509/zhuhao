# 优益企服云考勤打卡与工时计算设计

## 1. 目标与范围

在现有优益企服云中新增考勤子系统，复用员工、项目、部门、后台账号、员工账号、权限和数据范围能力，形成“员工打卡—自动计算—异常审核—月度汇总”的最小闭环。

第一期支持：

- 员工通过 Web 员工端或微信小程序执行上班、下班打卡。
- 固定班次、固定休息时段和按员工日期排班。
- 正常工时、迟到、早退、缺卡、旷工和加班候选时长计算。
- 员工查看本人当天记录和月度明细。
- HR 按现有员工数据范围查看日报、月报，处理补卡和异常。
- 审核通过后形成核准工时，供薪酬模块读取，但第一期不自动计算工资金额。
- 原始打卡、计算版本、人工处理和重新计算过程完整留痕。

第一期不支持：GPS、人脸识别、考勤机、自动定位、弹性工时、复杂轮班、计件工资和自动生成工资金额。

## 2. 设计原则

1. 原始打卡只追加，不修改、不删除；纠错通过补卡和审核记录表达。
2. 计算结果与原始记录分离，规则或排班变化后可以安全重算。
3. 加班先计算为候选时长，只有审核通过后才成为核准加班工时。
4. 员工只能访问本人数据；后台账号继续使用 `employeeScope` 限定员工范围。
5. 所有写接口校验 `company_id`，SQL 使用参数化查询。
6. 所有人工修正、审核和重算都写入现有审计日志。
7. 以北京时间 `Asia/Shanghai` 解释班次日期和打卡时间，数据库保存明确的日期时间值。

## 3. 用户与权限

新增权限编码：

| 权限 | 用途 | 默认角色 |
|---|---|---|
| `attendance:menu` | 显示考勤菜单 | company_admin、hr_manager、onsite_staff、payroll_staff |
| `attendance:view` | 查看数据范围内的考勤 | company_admin、hr_manager、onsite_staff、payroll_staff |
| `attendance:manage` | 配置班次、排班、发起重算 | company_admin、hr_manager |
| `attendance:review` | 审核补卡和异常 | company_admin、hr_manager、onsite_staff |
| `attendance:export` | 导出月度汇总 | company_admin、hr_manager、payroll_staff |

员工端使用现有员工账号认证，不授予后台权限编码，仅允许查询本人、为本人打卡和提交本人补卡申请。

`onsite_staff` 只能查看和审核其项目或员工数据范围内的记录。`payroll_staff` 默认只读核准结果，不得修改打卡和审核异常。

## 4. 数据模型

### 4.1 `attendance_shift_rules` 班次规则

| 字段 | 类型 | 约束与说明 |
|---|---|---|
| `id` | BIGINT UNSIGNED | 主键，自增 |
| `company_id` | BIGINT UNSIGNED | 非空，企业隔离 |
| `rule_name` | VARCHAR(100) | 非空 |
| `work_start_time` | TIME | 非空 |
| `work_end_time` | TIME | 非空，可小于开始时间表示跨天 |
| `rest_start_time` | TIME | 可空 |
| `rest_end_time` | TIME | 可空 |
| `standard_minutes` | INT UNSIGNED | 非空，核准标准工时 |
| `late_grace_minutes` | INT UNSIGNED | 非空，默认 0 |
| `early_grace_minutes` | INT UNSIGNED | 非空，默认 0 |
| `overtime_min_minutes` | INT UNSIGNED | 非空，低于此值不形成候选加班 |
| `status` | TINYINT UNSIGNED | 1 启用，0 停用 |
| `created_by` | BIGINT UNSIGNED | 非空，后台操作人 |
| `created_at` | DATETIME | 非空 |
| `updated_at` | DATETIME | 非空 |

唯一索引：`(company_id, rule_name)`。

### 4.2 `attendance_schedules` 员工排班

| 字段 | 类型 | 约束与说明 |
|---|---|---|
| `id` | BIGINT UNSIGNED | 主键，自增 |
| `company_id` | BIGINT UNSIGNED | 非空 |
| `employee_id` | BIGINT UNSIGNED | 非空 |
| `shift_date` | DATE | 非空，班次归属日期 |
| `shift_rule_id` | BIGINT UNSIGNED | 非空 |
| `schedule_status` | VARCHAR(20) | `WORK`、`REST` |
| `created_by` | BIGINT UNSIGNED | 非空 |
| `created_at` | DATETIME | 非空 |
| `updated_at` | DATETIME | 非空 |

唯一索引：`(company_id, employee_id, shift_date)`；查询索引：`(company_id, shift_date)`。

### 4.3 `attendance_punches` 原始打卡

| 字段 | 类型 | 约束与说明 |
|---|---|---|
| `id` | BIGINT UNSIGNED | 主键，自增 |
| `company_id` | BIGINT UNSIGNED | 非空 |
| `employee_id` | BIGINT UNSIGNED | 非空 |
| `shift_date` | DATE | 非空，由服务端根据排班判定 |
| `punch_type` | VARCHAR(10) | `IN`、`OUT` |
| `punch_time` | DATETIME(3) | 非空，服务端时间 |
| `source` | VARCHAR(20) | `WEB`、`WECHAT`、`MANUAL_APPROVED` |
| `client_request_id` | VARCHAR(64) | 非空，防重复提交 |
| `created_at` | DATETIME(3) | 非空 |

唯一索引：`(company_id, employee_id, client_request_id)`；查询索引：`(company_id, employee_id, punch_time)`。

客户端传来的时间只用于辅助诊断，正式打卡时间取服务器时间，避免修改手机时间作弊。

### 4.4 `attendance_daily_results` 每日计算结果

| 字段 | 类型 | 约束与说明 |
|---|---|---|
| `id` | BIGINT UNSIGNED | 主键，自增 |
| `company_id` | BIGINT UNSIGNED | 非空 |
| `employee_id` | BIGINT UNSIGNED | 非空 |
| `shift_date` | DATE | 非空 |
| `schedule_id` | BIGINT UNSIGNED | 可空，未排班时用于标记异常 |
| `first_in_at` | DATETIME(3) | 可空 |
| `last_out_at` | DATETIME(3) | 可空 |
| `worked_minutes` | INT UNSIGNED | 非空，实际净工时 |
| `approved_normal_minutes` | INT UNSIGNED | 非空，核准正常工时 |
| `overtime_candidate_minutes` | INT UNSIGNED | 非空，候选加班 |
| `approved_overtime_minutes` | INT UNSIGNED | 非空，审核后的加班 |
| `late_minutes` | INT UNSIGNED | 非空 |
| `early_leave_minutes` | INT UNSIGNED | 非空 |
| `result_status` | VARCHAR(30) | `NORMAL`、`LATE`、`EARLY_LEAVE`、`MISSING_PUNCH`、`ABSENT`、`REST`、`PENDING_REVIEW` |
| `review_status` | VARCHAR(20) | `NONE`、`PENDING`、`APPROVED`、`REJECTED` |
| `calculation_version` | VARCHAR(30) | 非空 |
| `calculated_at` | DATETIME | 非空 |
| `reviewed_by` | BIGINT UNSIGNED | 可空 |
| `reviewed_at` | DATETIME | 可空 |
| `updated_at` | DATETIME | 非空 |

唯一索引：`(company_id, employee_id, shift_date)`；月报索引：`(company_id, shift_date, result_status)`。

### 4.5 `attendance_correction_requests` 补卡与异常申请

| 字段 | 类型 | 约束与说明 |
|---|---|---|
| `id` | BIGINT UNSIGNED | 主键，自增 |
| `company_id` | BIGINT UNSIGNED | 非空 |
| `employee_id` | BIGINT UNSIGNED | 非空 |
| `shift_date` | DATE | 非空 |
| `request_type` | VARCHAR(20) | `MISSING_IN`、`MISSING_OUT`、`TIME_CORRECTION`、`OVERTIME` |
| `requested_time` | DATETIME(3) | 可空 |
| `reason` | VARCHAR(500) | 非空 |
| `status` | VARCHAR(20) | `PENDING`、`APPROVED`、`REJECTED`、`CANCELLED` |
| `submitted_by_employee_id` | BIGINT UNSIGNED | 非空 |
| `reviewed_by` | BIGINT UNSIGNED | 可空 |
| `review_comment` | VARCHAR(500) | 可空 |
| `reviewed_at` | DATETIME | 可空 |
| `created_at` | DATETIME | 非空 |
| `updated_at` | DATETIME | 非空 |

补卡审批通过后，新增一条 `source=MANUAL_APPROVED` 的原始记录，不修改已有打卡。

## 5. 工时计算

### 5.1 归属日期

- 普通班次：打卡归属于打卡当天的排班。
- 跨天班次：从班次开始前允许窗口到次日班次结束后允许窗口内的打卡，归属于班次开始日期。
- 第一版允许窗口固定为班前 4 小时、班后 6 小时，后续可配置。
- 无法匹配排班时拒绝打卡并提示联系 HR 排班，避免记录归属不明。

### 5.2 配对规则

- `IN` 取该班次窗口内最早一次有效记录。
- `OUT` 取该班次窗口内最晚一次有效记录。
- 同类型重复打卡保留，但不改变配对选择。
- 只有 `IN` 或只有 `OUT` 时标记 `MISSING_PUNCH`。
- 有工作排班但没有任何记录时标记 `ABSENT`。
- 休息日没有打卡时标记 `REST`；休息日有打卡时生成候选加班并进入审核。

### 5.3 时间计算

- 实际净工时：`OUT - IN - 与实际打卡区间重叠的休息时间`。
- 正常工时：不超过班次 `standard_minutes`，且不自动把迟到或早退时间补足。
- 迟到：`IN - 计划上班时间 - 宽限时间`，小于 0 时取 0。
- 早退：`计划下班时间 - OUT - 宽限时间`，小于 0 时取 0。
- 候选加班：实际净工时超过标准工时的部分；低于最低加班分钟数时取 0。
- 核准加班：候选加班审核通过后写入，第一期不使用 1.5、2、3 倍系数计算金额。
- 所有计算以分钟为最小单位，秒数向下取整，避免累计放大。

每次新增打卡、补卡审批或排班变化后，仅重算受影响员工和日期。后台批量重算按员工和日期范围分批执行，并记录计算版本。

## 6. API

### 6.1 员工端

#### `POST /api/employee/attendance/punch`

权限：已登录并绑定员工的员工账号。

请求：

```json
{
  "punchType": "IN",
  "clientRequestId": "20260909-employee-101-in-001",
  "source": "WECHAT"
}
```

成功：

```json
{
  "success": true,
  "data": {
    "punchId": 1001,
    "punchType": "IN",
    "punchTime": "2026-09-09T08:58:12.123+08:00",
    "shiftDate": "2026-09-09",
    "dailyStatus": "NORMAL"
  }
}
```

失败：未排班、重复请求、账号未绑定员工、员工非在职、班次窗口外。

#### `GET /api/employee/attendance/today`

返回本人今日或当前跨天班次、已打卡记录、计算结果和下一步可执行动作。

#### `GET /api/employee/attendance/month?month=2026-09`

只返回本人指定月份的每日结果和汇总。

#### `POST /api/employee/attendance/corrections`

提交本人补卡或加班核准申请。同一员工、日期、类型只允许存在一个待审核申请。

### 6.2 后台端

#### `GET /api/attendance/daily?date=2026-09-09&projectId=1&status=MISSING_PUNCH`

权限：`attendance:view`。服务层应用 `employeeScope`。

#### `GET /api/attendance/monthly?month=2026-09&projectId=1`

返回员工维度的应出勤、实际工时、迟到、早退、缺卡、旷工、候选加班和核准加班汇总。

#### `POST /api/attendance/shift-rules`

权限：`attendance:manage`。创建班次规则。

#### `PUT /api/attendance/shift-rules/:id`

权限：`attendance:manage`。修改规则后只影响尚未锁定的日期；历史核准结果不自动覆盖。

#### `PUT /api/attendance/schedules`

权限：`attendance:manage`。按员工和日期写入排班，采用幂等覆盖并记录审计。

#### `PUT /api/attendance/corrections/:id/review`

权限：`attendance:review`。校验审核人对目标员工的数据范围。通过后新增人工补卡记录并重算当天。

请求：

```json
{
  "action": "APPROVE",
  "reviewComment": "已核对现场签到记录"
}
```

#### `POST /api/attendance/recalculate`

权限：`attendance:manage`。仅允许重算调用者数据范围内、未锁定的员工日期。

#### `GET /api/attendance/export.xlsx?month=2026-09&projectId=1`

权限：`attendance:export`。导出字段默认不包含身份证号、手机号和银行卡号。

#### `GET /api/payroll/attendance-summary?month=2026-09&projectId=1`

权限：`payroll:view`。只提供核准正常工时和核准加班工时，作为工资导入或核对依据。

## 7. 页面设计

### 7.1 员工 Web/微信小程序

员工首页新增“考勤打卡”入口，页面包含：

- 当前日期、班次和状态。
- 上班/下班主按钮，按钮状态由服务端返回，不由客户端自行判断。
- 上下班时间、正常工时、候选加班和异常提示。
- 本月汇总与每日明细。
- 缺卡时显示“申请补卡”，正常状态不显示多余操作。

提交后按钮立即锁定，使用 `clientRequestId` 防止重复点击。网络超时后先查询今日状态，不直接再次写入。

### 7.2 HR 后台

新增一级菜单“考勤管理”，包含四个视图：

1. 今日考勤：指标卡、员工明细、异常筛选。
2. 月度汇总：员工维度统计和 Excel 导出。
3. 异常审核：补卡、缺卡、休息日加班待办。
4. 班次排班：班次规则和按员工日期排班。

第一期沿用现有现代企业办公系统视觉规范，不修改全局主题和其他业务页面。

## 8. 数据流与事务

打卡事务：

1. 验证员工账号、在职状态和企业归属。
2. 根据服务器时间匹配排班与班次窗口。
3. 以唯一 `client_request_id` 插入原始打卡。
4. 在同一事务内重新计算该员工班次日期的结果。
5. 写审计日志并提交。

审核事务：

1. 锁定待审核申请并验证状态。
2. 验证审核人数据范围。
3. 更新申请状态。
4. 若通过，追加人工补卡记录。
5. 重算每日结果并写审计日志。

任一步骤失败均回滚，不允许出现申请已通过但工时未重算的状态。

## 9. 异常与安全处理

- 打卡接口使用现有敏感操作限流机制，并增加员工维度的短时间频率限制。
- 客户端不得提交 `employeeId`、`companyId` 或正式打卡时间。
- 后台查询、审核、排班和导出全部应用企业隔离与员工数据范围。
- 非在职员工不能产生新打卡，但历史记录仍可按权限查询。
- 已审核月份可在后续版本增加锁定；第一期以每日审核状态保护人工结果，重算不得覆盖核准加班。
- API 不返回身份证、银行卡等无关敏感字段。
- 所有错误返回稳定业务编码，前端显示可操作提示，不回显 SQL 和内部异常。

## 10. 代码边界

预计新增：

- `src/routes/attendance.routes.js`
- `src/controllers/attendance.controller.js`
- `src/services/attendance.service.js`
- `src/services/attendance-calculator.service.js`
- `public/js/views/attendance.js`
- `wechat-miniprogram/miniprogram/pages/attendance/*`
- `sql/migrate-attendance-timekeeping-20260909.mysql.sql`
- 考勤计算、权限、数据隔离、接口和页面契约测试

预计最小修改：

- `src/routes/index.js`：注册路由。
- 现有员工端路由：注册员工考勤接口。
- `public/index.html`、导航配置：增加后台入口。
- 微信小程序页面配置及员工首页：增加入口。
- `sql/seed.mysql.sql`：增加权限和默认角色授权。
- `sql/schema.mysql.sql`：同步全量初始化结构。
- `package.json`：将新增测试加入检查流程。

不重构 `src/app.js`、员工模块或薪酬模块，不清理现有无关代码。

## 11. 测试与验收

### 11.1 计算单元测试

- 正常班、迟到、早退、迟到且早退。
- 午休部分重叠和完全重叠。
- 缺上班卡、缺下班卡、全天无卡。
- 重复打卡和幂等请求。
- 休息日打卡与候选加班。
- 跨天班次归属。
- 补卡通过后的重新计算。
- 重算不覆盖已核准加班。

### 11.2 权限与隔离测试

- 员工只能查看和操作本人。
- HR、驻场和薪资角色符合权限矩阵。
- 驻场人员不能读取其他项目员工。
- 跨企业访问返回无权限或不存在。
- 导出不包含敏感字段。

### 11.3 页面与接口验收

- Web 和微信小程序均可完成一次上班、下班打卡。
- 重复点击不会生成重复记录。
- 缺卡后员工可申请，HR 可审核，结果自动更新。
- HR 可查看日报、月报和导出。
- 薪酬端可读取核准工时汇总，但不会自动修改工资数据。
- 执行项目现有 `npm run check` 和小程序契约检查。

## 12. 上线边界

本功能先在本地和测试数据库实现与验证。数据库迁移、生产打包、上传、部署和正式启用均不属于本次自动执行范围，需要用户另行明确授权。
