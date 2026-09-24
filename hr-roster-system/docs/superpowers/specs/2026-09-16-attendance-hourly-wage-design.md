# 考勤小时制与自动工资设计

## 1. 背景与目标

现有项目考勤以分钟保存和计算，一个项目只有一套上下班时间；工资模块可以读取核准正常分钟和加班分钟，但没有项目班次时薪、补贴规则、员工结算方式和自动工资台账。电子围栏已有经纬度和半径字段，网页端仍需手工输入坐标。

本次在不破坏现有考勤、工资导入和工资条发放流程的前提下实现：

1. 页面和接口使用“标准小时、正常小时、加班小时”等业务口径。
2. 每个项目分别设置白班、夜班时间、标准小时和时薪。
3. 项目补贴可按班次或按小时计算，并可限制适用班次。
4. 员工设置默认班次，每日排班可以覆盖默认班次。
5. 按实际考勤自动生成工资预览，人工确认后进入现有待复核工资批次。
6. 同时支持月结、日结后月度发放、日结已支付三种员工结算方式。
7. 电子围栏使用腾讯地图搜索和选点；地图 Key 未配置时保留手工坐标录入。

## 2. 已确认业务规则

### 2.1 工时与班次

- 数据库内部继续以整数分钟保存原始工时和核准工时，避免丢失精度并兼容历史数据。
- Web 和小程序展示统一转换为小时；项目设置以小时输入，允许 `0.5` 小时步进。
- 每日计薪工时按半小时四舍五入：`payableMinutes = floor((approvedMinutes + 15) / 30) * 30`。
- 示例：7 小时 14 分为 7 小时；7 小时 15 分为 7.5 小时；7 小时 44 分为 7.5 小时；7 小时 45 分为 8 小时。
- 四舍五入在每名员工、每个出勤日独立执行，不能先汇总整月分钟再取整。
- 夜班跨过零点时，整次班次归属于上班打卡日期。
- 标准内工时和超出标准的工时使用同一个白班或夜班时薪，不设置加班倍率。
- 员工保存默认班次；存在有效的每日排班时，每日排班优先于默认班次。

### 2.2 补贴

- 每项补贴独立选择 `PER_SHIFT`（按班次）或 `PER_HOUR`（按小时）。
- 每项补贴可适用于 `DAY`（白班）、`NIGHT`（夜班）或 `ALL`（全部班次）。
- 按小时补贴使用四舍五入后的计薪小时计算。
- 按班次补贴只在当日计薪工时大于零且考勤满足自动计薪条件时发放一次。
- 当日金额和月度汇总金额均使用 `DECIMAL` 运算，最终四舍五入保留两位小数，禁止使用 JavaScript 浮点数直接累计金额。

### 2.3 结算方式

员工在项目中的计薪方式使用以下固定值：

| 值 | 含义 | 月度待发工资 |
|---|---|---|
| `MONTHLY` | 月结 | 当月全部核准工资进入待发金额 |
| `DAILY_ACCRUAL` | 每日计算、月底发放 | 每日展示应得工资，当月全部进入待发金额 |
| `DAILY_PAID` | 日结并记录支付 | 已标记支付的日工资从月度待发金额中扣除 |

- 日结支付只记录业务状态，不连接银行或第三方支付渠道。
- 日结记录按整日工资标记已支付，不支持本期部分支付。
- 已支付日工资需要变更时，必须先填写原因撤销支付标记，再重新计算；所有操作保留审计记录。
- 月度工资条展示“当月应得工资、已日结金额、月度待发金额”，避免员工误认为已日结部分被少发。

### 2.4 自动计薪条件

- `NORMAL`、`LATE`、`EARLY_LEAVE` 使用核准后的实际工时计薪。
- `ABSENT` 工时和工资均为零。
- `MISSING_PUNCH`、待处理补卡、待处理围栏异常不自动计薪，在预览中显示阻断原因。
- 异常审核或补卡完成后，先重算考勤，再重算工资预览。
- 工资预览允许反复重算；确认后的工资批次保存完整快照，不随后续项目设置变化。

## 3. 总体架构

采用“项目规则版本 + 双班次明细 + 补贴明细 + 员工计薪版本 + 工资计算快照”的结构。

```text
项目考勤规则版本
├── 白班规则（时间、标准分钟、时薪）
├── 夜班规则（时间、标准分钟、时薪）
└── 补贴规则（适用班次、按班次/按小时、单价）

员工项目计薪版本
├── 默认班次
└── 结算方式

每日排班/默认班次 + 核准考勤
→ 每日工资计算行
→ 项目月份工资预览
→ 人工确认
→ 现有 salary_batch / salary_detail 待复核批次
```

不把工资配置塞入 JSON；班次、补贴和员工计薪均使用结构化表，便于校验、查询和审计。现有工资表上传入口继续保留，自动计算是并列的工资批次来源。

## 4. 数据库设计

所有迁移必须幂等，执行 `ALTER` 前检查 `information_schema`，禁止删除或覆盖历史数据。

### 4.1 `attendance_project_shift_rules`

项目规则版本下的白班、夜班配置。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 班次规则 ID |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `project_rule_id` | `BIGINT NOT NULL` | `attendance_project_rules.id` |
| `shift_type` | `VARCHAR(10) NOT NULL` | `DAY` / `NIGHT` |
| `work_start_time` | `TIME NOT NULL` | 上班时间 |
| `work_end_time` | `TIME NOT NULL` | 下班时间，可小于上班时间表示跨夜 |
| `rest_start_time` | `TIME DEFAULT NULL` | 休息开始 |
| `rest_end_time` | `TIME DEFAULT NULL` | 休息结束 |
| `standard_minutes` | `SMALLINT UNSIGNED NOT NULL` | 标准小时换算后的分钟 |
| `hourly_rate` | `DECIMAL(10,2) DEFAULT NULL` | 每小时时薪；兼容迁移允许空，新规则必须配置 |
| `status` | `TINYINT UNSIGNED NOT NULL DEFAULT 1` | 1 启用，0 停用 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_by` | `BIGINT DEFAULT NULL` | 更新人 |
| `updated_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

唯一索引：`(company_id, project_rule_id, shift_type)`；查询索引：`(company_id, project_id, status)`。

### 4.2 `attendance_allowance_rules`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 补贴规则 ID |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `project_rule_id` | `BIGINT NOT NULL` | 项目规则版本 ID |
| `allowance_name` | `VARCHAR(80) NOT NULL` | 补贴名称 |
| `shift_scope` | `VARCHAR(10) NOT NULL` | `DAY` / `NIGHT` / `ALL` |
| `calculation_type` | `VARCHAR(20) NOT NULL` | `PER_SHIFT` / `PER_HOUR` |
| `unit_amount` | `DECIMAL(10,2) NOT NULL` | 每班次或每小时金额 |
| `sort_order` | `SMALLINT UNSIGNED NOT NULL DEFAULT 0` | 展示顺序 |
| `status` | `TINYINT UNSIGNED NOT NULL DEFAULT 1` | 状态 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_by` | `BIGINT DEFAULT NULL` | 更新人 |
| `updated_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

唯一索引：`(company_id, project_rule_id, allowance_name, shift_scope)`。

### 4.3 `employee_pay_profiles`

员工在项目中的默认班次和结算方式采用生效日期版本，避免覆盖历史工资依据。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 配置 ID |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `employee_id` | `BIGINT NOT NULL` | 员工 ID |
| `default_shift_type` | `VARCHAR(10) NOT NULL` | `DAY` / `NIGHT` |
| `settlement_mode` | `VARCHAR(20) NOT NULL` | `MONTHLY` / `DAILY_ACCRUAL` / `DAILY_PAID` |
| `effective_from` | `DATE NOT NULL` | 生效日期 |
| `status` | `TINYINT UNSIGNED NOT NULL DEFAULT 1` | 状态 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_by` | `BIGINT DEFAULT NULL` | 更新人 |
| `updated_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

唯一索引：`(company_id, project_id, employee_id, effective_from)`；查询索引：`(company_id, project_id, status, effective_from)`。

### 4.4 现有排班表扩展

`attendance_schedules` 增加：

| 字段 | 类型 | 说明 |
|---|---|---|
| `shift_type` | `VARCHAR(10) DEFAULT NULL` | `DAY` / `NIGHT`，旧数据允许空 |
| `project_shift_rule_id` | `BIGINT DEFAULT NULL` | 实际采用的项目班次规则 |

新排班必须同时保存 `project_rule_id`、`project_shift_rule_id` 和 `shift_type`。旧数据保持原值，读取时兼容现有单班次规则，不猜测历史员工班次。

### 4.5 `wage_calculation_runs`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 计算批次 ID |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `salary_month` | `CHAR(7) NOT NULL` | 工资月份 |
| `revision_no` | `INT UNSIGNED NOT NULL` | 同项目月份计算版本 |
| `status` | `VARCHAR(20) NOT NULL` | `PREVIEW` / `CONFIRMED` / `CANCELLED` |
| `salary_batch_id` | `BIGINT DEFAULT NULL` | 确认后生成的工资批次 |
| `total_earned` | `DECIMAL(14,2) NOT NULL DEFAULT 0` | 当月应得合计 |
| `total_daily_paid` | `DECIMAL(14,2) NOT NULL DEFAULT 0` | 已日结合计 |
| `total_payable` | `DECIMAL(14,2) NOT NULL DEFAULT 0` | 月度待发合计 |
| `blocked_count` | `INT UNSIGNED NOT NULL DEFAULT 0` | 被异常阻断的员工日数量 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `confirmed_by` | `BIGINT DEFAULT NULL` | 确认人 |
| `confirmed_at` | `DATETIME DEFAULT NULL` | 确认时间 |

唯一索引：`(company_id, project_id, salary_month, revision_no)`。

### 4.6 `wage_calculation_daily_lines`

每日计算快照保存考勤、班次、单价和金额，不依赖后续规则回查。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 明细 ID |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `run_id` | `BIGINT NOT NULL` | 工资计算批次 |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `employee_id` | `BIGINT NOT NULL` | 员工 ID |
| `shift_date` | `DATE NOT NULL` | 班次归属日期 |
| `attendance_result_id` | `BIGINT DEFAULT NULL` | 考勤每日结果 |
| `project_rule_id` | `BIGINT DEFAULT NULL` | 项目规则版本 |
| `project_shift_rule_id` | `BIGINT DEFAULT NULL` | 班次规则版本 |
| `shift_type` | `VARCHAR(10) DEFAULT NULL` | 白班或夜班 |
| `settlement_mode` | `VARCHAR(20) NOT NULL` | 当日员工结算方式快照 |
| `worked_minutes` | `INT UNSIGNED NOT NULL DEFAULT 0` | 打卡计算得到的实际工作分钟 |
| `approved_minutes` | `INT UNSIGNED NOT NULL DEFAULT 0` | 核准正常分钟与核准加班分钟之和，作为计薪输入 |
| `payable_minutes` | `INT UNSIGNED NOT NULL DEFAULT 0` | 半小时取整后的计薪分钟 |
| `hourly_rate` | `DECIMAL(10,2) NOT NULL DEFAULT 0` | 时薪快照 |
| `base_amount` | `DECIMAL(12,2) NOT NULL DEFAULT 0` | 工时工资 |
| `allowance_amount` | `DECIMAL(12,2) NOT NULL DEFAULT 0` | 补贴合计 |
| `earned_amount` | `DECIMAL(12,2) NOT NULL DEFAULT 0` | 当日应得 |
| `daily_paid_amount` | `DECIMAL(12,2) NOT NULL DEFAULT 0` | 已日结金额 |
| `payable_amount` | `DECIMAL(12,2) NOT NULL DEFAULT 0` | 月度待发金额 |
| `allowance_snapshot` | `JSON DEFAULT NULL` | 补贴逐项快照 |
| `calculation_status` | `VARCHAR(20) NOT NULL` | `READY` / `BLOCKED` / `ZERO` |
| `blocked_reason` | `VARCHAR(255) DEFAULT NULL` | 不自动计薪原因 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |

唯一索引：`(run_id, employee_id, shift_date)`；查询索引：`(company_id, project_id, employee_id, shift_date)`。

### 4.7 `wage_daily_payments`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 日结记录 ID |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `employee_id` | `BIGINT NOT NULL` | 员工 ID |
| `shift_date` | `DATE NOT NULL` | 日结日期 |
| `amount` | `DECIMAL(12,2) NOT NULL` | 已支付整日金额 |
| `status` | `VARCHAR(20) NOT NULL` | `PAID` / `REVOKED` |
| `remark` | `VARCHAR(255) DEFAULT NULL` | 支付备注或撤销原因 |
| `paid_by` | `BIGINT NOT NULL` | 标记支付人 |
| `paid_at` | `DATETIME NOT NULL` | 标记支付时间 |
| `revoked_by` | `BIGINT DEFAULT NULL` | 撤销人 |
| `revoked_at` | `DATETIME DEFAULT NULL` | 撤销时间 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

唯一索引：`(company_id, project_id, employee_id, shift_date)`。撤销只改状态并保留原金额和操作记录，不删除行。

## 5. 计算服务

### 5.1 纯函数接口

新增 `src/services/hourly-wage-calculator.service.js`：

```js
calculateDailyWage({
  approvedMinutes,
  shiftType,
  hourlyRate,
  allowances,
  settlementMode,
  dailyPaidAmount,
  attendanceStatus
})
```

返回：

```json
{
  "payableMinutes": 450,
  "payableHours": "7.50",
  "baseAmount": "150.00",
  "allowanceAmount": "25.00",
  "earnedAmount": "175.00",
  "dailyPaidAmount": "0.00",
  "payableAmount": "175.00",
  "allowanceItems": [],
  "calculationStatus": "READY",
  "blockedReason": null
}
```

`approvedMinutes` 由核准正常分钟与核准加班分钟相加得到，候选加班不得直接进入工资。接口金额统一返回两位小数字符串。计算服务内部使用“分”或十进制定点库实现，禁止用二进制浮点直接累计。

### 5.2 预览生成

1. 校验用户具有项目范围和 `payroll:manage` 权限。
2. 读取项目月份内的员工任职、员工计薪版本、每日排班、项目规则和核准考勤。
3. 按员工、日期解析生效版本；每日排班优先，未排班时使用员工默认班次。
4. 使用 `approved_normal_minutes + approved_overtime_minutes` 作为计薪输入，对每个员工日调用纯函数并保存快照。
5. 汇总员工和项目金额，返回阻断项；存在阻断项时允许查看预览，但不允许确认生成工资批次。
6. 重算创建新的 `revision_no`，旧预览改为 `CANCELLED`，不得覆盖已确认版本。

### 5.3 确认生成工资批次

- 确认操作使用数据库事务，并锁定计算批次。
- 只允许确认最新且无阻断项的 `PREVIEW`。
- 幂等创建一条 `salary_batch`，批次来源标记为自动考勤计算。
- 每名员工汇总：`gross_amount = 当月应得工资`；`other_deduction` 增加已日结金额展示项；`net_amount = 月度待发金额`。
- `salary_detail.item_snapshot` 保存每日工时、时薪、补贴、已日结金额和计算版本。
- 生成后状态进入现有“待复核”，后续继续使用现有复核、发放、工资条查看和签收流程。

## 6. API 设计

### 6.1 保存项目考勤和计薪规则

`PUT /api/attendance/projects/:projectId/settings`

权限：`attendance:manage`；服务端同时校验 `projectScope`。

请求：

```json
{
  "ruleName": "2026年10月班次工资",
  "effectiveFrom": "2026-10-01",
  "workWeekdays": [1, 2, 3, 4, 5, 6],
  "lateGraceMinutes": 5,
  "earlyGraceMinutes": 5,
  "overtimeMinMinutes": 30,
  "shifts": [
    {"shiftType":"DAY","workStartTime":"08:00","workEndTime":"17:00","restStartTime":"12:00","restEndTime":"13:00","standardHours":8,"hourlyRate":"20.00"},
    {"shiftType":"NIGHT","workStartTime":"20:00","workEndTime":"05:00","restStartTime":"00:00","restEndTime":"01:00","standardHours":8,"hourlyRate":"23.00"}
  ],
  "allowances": [
    {"allowanceName":"夜班补贴","shiftScope":"NIGHT","calculationType":"PER_SHIFT","unitAmount":"30.00"},
    {"allowanceName":"高温补贴","shiftScope":"ALL","calculationType":"PER_HOUR","unitAmount":"1.50"}
  ],
  "geofenceIds": [31, 32]
}
```

成功响应：

```json
{"success":true,"data":{"projectId":12,"ruleId":26,"effectiveFrom":"2026-10-01"}}
```

失败响应示例：

```json
{"success":false,"code":"INVALID_SHIFT_RULE","message":"白班和夜班规则必须各配置一条"}
```

### 6.2 保存员工计薪设置

`PUT /api/attendance/projects/:projectId/employees/:employeeId/pay-profile`

权限：`payroll:manage`；校验员工在该项目有效任职及项目数据范围。

请求：

```json
{"defaultShiftType":"DAY","settlementMode":"DAILY_PAID","effectiveFrom":"2026-10-01"}
```

成功响应：

```json
{"success":true,"data":{"employeeId":101,"projectId":12,"defaultShiftType":"DAY","settlementMode":"DAILY_PAID","effectiveFrom":"2026-10-01"}}
```

### 6.3 批量每日排班

`PUT /api/attendance/projects/:projectId/schedules`

权限：`attendance:manage`。

请求：

```json
{"shiftDate":"2026-10-08","assignments":[{"employeeId":101,"shiftType":"NIGHT"},{"employeeId":102,"shiftType":"DAY"}]}
```

成功响应：

```json
{"success":true,"data":{"shiftDate":"2026-10-08","updatedCount":2}}
```

### 6.4 工资计算预览

`POST /api/payroll/calculations/preview`

权限：`payroll:manage`。

请求：

```json
{"projectId":12,"salaryMonth":"2026-10"}
```

成功响应：

```json
{"success":true,"data":{"runId":81,"revisionNo":2,"totalEarned":"128600.00","totalDailyPaid":"18600.00","totalPayable":"110000.00","blockedCount":2}}
```

### 6.5 确认工资预览

`POST /api/payroll/calculations/:runId/confirm`

权限：`payroll:manage`。

请求：

```json
{"confirm":true}
```

成功响应：

```json
{"success":true,"data":{"runId":81,"salaryBatchId":206,"batchStatus":3}}
```

存在阻断项时返回：

```json
{"success":false,"code":"WAGE_PREVIEW_BLOCKED","message":"仍有2条考勤异常未处理，不能生成工资批次"}
```

### 6.6 工资预览详情

`GET /api/payroll/calculations/:runId`

权限：`payroll:view`，同时校验计算批次所属项目的数据范围。返回项目月份汇总、员工汇总和逐日计算快照；不返回内部审计数据或其他项目记录。

成功响应：

```json
{"success":true,"data":{"runId":81,"projectId":12,"salaryMonth":"2026-10","status":"PREVIEW","summary":{"totalEarned":"128600.00","totalDailyPaid":"18600.00","totalPayable":"110000.00","blockedCount":2},"employees":[]}}
```

### 6.7 日结列表

`GET /api/payroll/daily-payments?projectId=12&date=2026-10-08&status=PAID&keyword=`

权限：`payroll:view`，同时校验项目数据范围。返回员工姓名、班次日期、当日应得、支付状态、支付时间和脱敏后的操作人展示信息。

### 6.8 日结支付状态

`PUT /api/payroll/daily-payments`

权限：`payroll:manage`。

请求：

```json
{"projectId":12,"employeeId":101,"shiftDate":"2026-10-08","action":"MARK_PAID","remark":"现金日结已确认"}
```

撤销时 `action` 为 `REVOKE`，且 `remark` 必填。

成功响应：

```json
{"success":true,"data":{"employeeId":101,"shiftDate":"2026-10-08","status":"PAID","amount":"175.00"}}
```

### 6.9 腾讯地图配置

`GET /api/attendance/map-config`

权限：`attendance:manage`。

已配置响应：

```json
{"success":true,"data":{"provider":"TENCENT","enabled":true,"jsKey":"受域名白名单限制的浏览器Key"}}
```

未配置响应：

```json
{"success":true,"data":{"provider":"TENCENT","enabled":false,"jsKey":null}}
```

浏览器 Key 从部署环境读取，仅对有围栏管理权限的页面返回，并在腾讯位置服务控制台限制生产域名和本地域名。若后续启用服务端地址解析，服务端 Key 必须独立配置且不得返回客户端。

## 7. 页面设计

### 7.1 项目设置

- 班次规则区改为白班、夜班两个紧凑分区。
- 每个分区显示上下班、休息时间、标准小时和时薪。
- 补贴区使用可增删表格，每行设置名称、适用班次、计费方式和金额。
- 员工计薪设置支持按项目批量选择员工，设置默认班次、结算方式和生效日期。
- 每日排班支持按日期批量调整白班、夜班；未调整员工继续使用默认班次。

### 7.2 工资计算预览

- 顶部显示应得工资、已日结、待发工资和阻断项数量。
- 员工汇总可展开查看逐日班次、实际小时、计薪小时、时薪、补贴和金额。
- 阻断项使用明确原因和考勤处理入口，不允许带阻断项确认。
- “确认生成工资批次”是唯一进入现有工资条复核流程的入口。

### 7.3 日结统计

- 按项目、日期、员工和支付状态筛选。
- 显示当日应得、已支付状态、支付时间和操作人。
- 只允许 `DAILY_PAID` 员工标记日结；撤销必须填写原因。

### 7.4 地图选点

- 围栏表单增加地图区域、地址搜索框、定位到当前视野和点击选点。
- 选点后同步经纬度输入框，并以圆形覆盖物展示围栏半径。
- 修改半径时地图覆盖物同步变化。
- Key 未配置或 SDK 加载失败时，不阻断页面；显示错误提示并切回手工坐标输入。

## 8. 权限、安全和审计

- 项目规则、排班和围栏继续使用 `attendance:manage`；工资配置、预览、确认和日结状态使用 `payroll:manage`。
- 所有查询同时带 `company_id` 和 `projectScope`，员工计薪设置还要校验员工在项目的有效任职。
- SQL 全部使用命名参数；动态 `IN` 参数逐项生成占位符，不拼接用户输入。
- 时薪、工资和日结金额仅向工资权限用户及员工本人对应工资条返回。
- 项目规则变更、员工计薪变更、工资预览确认、日结标记和撤销写入操作日志。
- 原始打卡记录保持只追加；工资预览通过新版本重算，不覆盖已确认快照。

## 9. 迁移与兼容

1. 新建班次、补贴、员工计薪、工资计算和日结记录表。
2. 为 `attendance_schedules` 幂等增加班次类型和班次规则 ID。
3. 为现有每个项目规则创建一条兼容 `DAY` 班次，沿用原时间和标准分钟；时薪保持未配置状态，不生成自动工资。
   现有 `attendance_project_rules` 的必填时间字段继续保存白班兼容值；新计算只读取子表中的白班、夜班配置。
4. 旧排班和历史考勤不推测白班或夜班；仍按原规则显示，只有新规则生效后参与自动计薪。
5. `salary_batch` 增加可空的 `source_type` 和 `calculation_run_id`，旧批次默认视为 `IMPORT`。
6. 自动工资和工资表上传并存；同项目同月份允许多个工资批次，沿用现有批次编号和复核发放约束。
7. 发布脚本加入迁移文件和结构核验，数据库迁移失败时停止应用发布。

## 10. 错误处理

- 白班或夜班缺失、标准小时不是 `0.5` 倍数、时薪为负数、补贴重复时返回明确的 `400` 错误码。
- 已生效或已用于排班/工资计算的规则不可修改，返回 `409 PROJECT_RULE_IMMUTABLE`。
- 员工不属于当前项目返回 `403 EMPLOYEE_PROJECT_FORBIDDEN`。
- 预览存在考勤异常、缺少时薪或缺少员工计薪设置时保存阻断明细，不生成工资批次。
- 重复确认同一计算批次返回已有 `salaryBatchId`，不得重复创建工资批次。
- 地图 SDK 故障只影响地图选点，不影响手工坐标保存。

## 11. 测试与验收

### 11.1 单元测试

- 7 小时 14/15/44/45 分的半小时四舍五入边界。
- 白班、跨夜班、休息时间重叠和班次归属日期。
- 同时计算按小时和按班次补贴。
- 标准内和超出标准工时使用同一时薪。
- 金额定点计算和两位小数舍入。
- `MONTHLY`、`DAILY_ACCRUAL`、`DAILY_PAID` 三种待发金额。
- 缺卡、旷工和待审核异常的阻断规则。

### 11.2 服务与权限测试

- 项目规则版本不可变、员工生效版本解析、每日排班覆盖默认班次。
- 企业、项目和员工数据范围隔离。
- 日结标记、撤销原因、重复请求幂等和审计记录。
- 预览重算版本、阻断确认、重复确认和事务回滚。
- 自动工资批次快照与后续规则修改隔离。
- 普通考勤查看接口不泄露时薪、工资或围栏中心坐标。

### 11.3 页面与地图测试

- 项目设置可同时保存白班和夜班、动态补贴及员工计薪设置。
- 考勤日报和月报由分钟文案改为小时，数值转换正确。
- 工资预览逐日明细、阻断提示、日结统计和生成待复核批次流程。
- 腾讯地图正常加载、搜索、点击选点、半径同步；无 Key 和 SDK 失败时可手工输入。
- 桌面和移动宽度下无文本覆盖、表格操作可用。

### 11.4 回归命令

```bash
npm run test:attendance
npm run test:attendance-geofence
npm run check
npm audit --audit-level=high
git diff --check
```

上线前另执行发布包验证、数据库备份验证和只读生产验收；小程序上传与 Web/API 部署分别确认，不因本次开发自动执行。

## 12. 不在本期范围

- 银行、微信支付或其他真实工资付款接口。
- 加班 1.5、2、3 倍等倍率规则。
- 计件工资自动计算。
- 根据打卡时间自动猜测白班或夜班。
- 对历史考勤和工资数据批量推测、补写班次或时薪。
- 腾讯地图 Key 的申请和生产控制台配置。
