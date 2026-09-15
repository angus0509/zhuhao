# 网页端项目考勤与客户围栏设计

## 1. 目标

在现有优益数字化管理系统考勤模块中增加项目化管理能力：网页端驻厂人员只能查看和维护自己被授权客户项目的考勤；项目可设置上下班时间、每周工作日和特殊日期；电子围栏由客户统一维护并可被该客户的多个项目复用；日报、月报和异常审核始终按客户项目独立展示。

## 2. 范围

本期包含：

- 网页端客户、项目级联选择和项目考勤工作台。
- 项目默认班次、每周工作日、生效日期和特殊日期设置。
- 客户围栏库，以及项目与多个围栏的关联。
- 按项目查询每日明细、每日汇总、月度员工汇总。
- 围栏异常按项目查询和审核。
- 驻厂账号的项目数据范围隔离。
- 员工调项目后的历史项目归属保护。

本期不包含：复杂轮班、跨夜班、多段班、自动薪资结算、Excel 导出。

## 3. 核心规则

### 3.1 项目与权限

- 所有读写接口先校验 `company_id`，再使用 `projectScope` 校验项目权限。
- `attendance:view` 可查看授权项目的日报、月报和设置。
- `attendance:manage` 可维护授权项目的规则、特殊日期和围栏关联，也可维护授权项目对应客户的围栏。
- `attendance:review` 可查看并审核授权项目员工的异常。
- 驻厂账号不提供跨项目合并查询。日报和月报必须传入 `projectId`。
- 前端隐藏不是授权依据；服务端不使用前端传入的 `customerId` 判定权限。

### 3.2 班次与工作日

- 一个项目在同一日期只能命中一个生效规则版本。
- 规则包含上班、下班、午休起止、标准工时、迟到宽限、早退宽限、最低加班分钟和每周工作日。
- 新规则必须指定 `effectiveFrom`，仅影响该日期及以后未生成或待重新计算的排班。
- 特殊日期优先于星期规则，类型为 `WORKDAY` 或 `REST_DAY`。
- 项目员工默认继承项目规则；现有员工单日排班用于特殊覆盖，并保持最高优先级。

规则优先级：员工单日排班 > 项目特殊日期 > 项目星期规则。

### 3.3 客户围栏库

- 围栏直接归属客户，一个客户可维护多个有效围栏。
- 项目只能关联自身客户名下的围栏，一个项目可同时启用多个围栏。
- 员工位于任一关联的有效围栏内即为 `INSIDE`。
- 所有关联围栏均未命中时为 `OUTSIDE`；定位精度不足为 `LOW_ACCURACY`；定位失败为 `LOCATION_FAILED`；项目未关联围栏为 `NO_FENCE`。
- `OUTSIDE`、`LOW_ACCURACY`、`LOCATION_FAILED` 允许打卡，但自动生成待审核异常。
- 打卡记录保存实际命中或用于判定的围栏、距离和半径快照，围栏后续修改不改写历史。

### 3.4 项目归属与历史

- 生成排班时，根据 `hr_employee_job` 在目标日期有效的任职记录确定 `project_id`。
- 排班、打卡和每日结果保存 `project_id` 快照。
- 员工调入新项目后，新生效日期归新项目，历史日报和月报仍归原项目。
- 项目或规则停用不删除历史记录。

### 3.5 统计

- 应出勤：目标日期归属项目、有效在职且按规则为工作日的员工数。
- 正常工时：首次有效上班卡至最后一次有效下班卡，扣除有效休息区间，最多计项目标准工时。
- 加班候选：超过标准工时并达到最低加班分钟；核准加班继续走现有审核口径。
- 迟到、早退按班次时间和宽限分钟计算。
- 工作日只有一类卡为 `MISSING_PUNCH`；工作日无有效打卡为 `ABSENT`；休息日无打卡不异常。
- 日报返回项目汇总和员工明细；月报按员工汇总出勤、工时、迟到、早退、缺卡、旷工和围栏异常次数。

## 4. 数据结构

现有表采用幂等迁移补列，新表均包含主键、状态、创建时间、更新时间和操作人。

### 4.1 `attendance_geofences`

将现有项目围栏升级为客户围栏库：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 围栏主键 |
| `company_id` | `BIGINT NOT NULL` | 企业 |
| `customer_id` | `BIGINT NOT NULL` | 客户 |
| `fence_name` | `VARCHAR(100) NOT NULL` | 围栏名称 |
| `latitude` | `DECIMAL(10,7) NOT NULL` | 中心纬度 |
| `longitude` | `DECIMAL(10,7) NOT NULL` | 中心经度 |
| `radius_meters` | `INT UNSIGNED NOT NULL` | 半径 |
| `max_accuracy_meters` | `INT UNSIGNED NOT NULL` | 最大定位误差 |
| `status` | `TINYINT UNSIGNED NOT NULL` | 1 启用，0 停用 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL` | 创建时间 |
| `updated_by` | `BIGINT DEFAULT NULL` | 最后操作人 |
| `updated_at` | `DATETIME NOT NULL` | 更新时间 |

唯一索引：`(company_id, customer_id, fence_name)`；查询索引：`(company_id, customer_id, status)`。迁移时用现有 `project_id` 回填项目所属 `customer_id`，验证无空值后再切换业务读取。

### 4.2 `attendance_project_geofence`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 关联主键 |
| `company_id` | `BIGINT NOT NULL` | 企业 |
| `project_id` | `BIGINT NOT NULL` | 项目 |
| `geofence_id` | `BIGINT NOT NULL` | 客户围栏 |
| `status` | `TINYINT UNSIGNED NOT NULL` | 1 启用，0 停用 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL` | 创建时间 |
| `updated_by` | `BIGINT DEFAULT NULL` | 最后操作人 |
| `updated_at` | `DATETIME NOT NULL` | 更新时间 |

唯一索引：`(company_id, project_id, geofence_id)`；查询索引：`(company_id, project_id, status)`。

### 4.3 `attendance_project_rules`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 规则版本主键 |
| `company_id` | `BIGINT NOT NULL` | 企业 |
| `project_id` | `BIGINT NOT NULL` | 项目 |
| `rule_name` | `VARCHAR(100) NOT NULL` | 规则名称 |
| `work_start_time` | `TIME NOT NULL` | 上班时间 |
| `work_end_time` | `TIME NOT NULL` | 下班时间 |
| `rest_start_time` | `TIME DEFAULT NULL` | 午休开始 |
| `rest_end_time` | `TIME DEFAULT NULL` | 午休结束 |
| `standard_minutes` | `SMALLINT UNSIGNED NOT NULL` | 标准分钟 |
| `late_grace_minutes` | `SMALLINT UNSIGNED NOT NULL` | 迟到宽限 |
| `early_grace_minutes` | `SMALLINT UNSIGNED NOT NULL` | 早退宽限 |
| `overtime_min_minutes` | `SMALLINT UNSIGNED NOT NULL` | 最低加班分钟 |
| `work_weekdays` | `VARCHAR(20) NOT NULL` | ISO 星期数字，例如 `1,2,3,4,5,6` |
| `effective_from` | `DATE NOT NULL` | 生效日期 |
| `status` | `TINYINT UNSIGNED NOT NULL` | 1 生效，0 停用 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL` | 创建时间 |
| `updated_by` | `BIGINT DEFAULT NULL` | 最后操作人 |
| `updated_at` | `DATETIME NOT NULL` | 更新时间 |

唯一索引：`(company_id, project_id, effective_from)`；查询索引：`(company_id, project_id, status, effective_from)`。

### 4.4 `attendance_project_calendar`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `BIGINT PRIMARY KEY AUTO_INCREMENT` | 特殊日期主键 |
| `company_id` | `BIGINT NOT NULL` | 企业 |
| `project_id` | `BIGINT NOT NULL` | 项目 |
| `calendar_date` | `DATE NOT NULL` | 日期 |
| `day_type` | `VARCHAR(20) NOT NULL` | `WORKDAY` 或 `REST_DAY` |
| `remark` | `VARCHAR(255) DEFAULT NULL` | 说明 |
| `status` | `TINYINT UNSIGNED NOT NULL` | 1 生效，0 停用 |
| `created_by` | `BIGINT NOT NULL` | 创建人 |
| `created_at` | `DATETIME NOT NULL` | 创建时间 |
| `updated_by` | `BIGINT DEFAULT NULL` | 最后操作人 |
| `updated_at` | `DATETIME NOT NULL` | 更新时间 |

唯一索引：`(company_id, project_id, calendar_date)`。

### 4.5 历史快照补列

- `attendance_schedules.project_id BIGINT DEFAULT NULL`
- `attendance_punches.project_id BIGINT DEFAULT NULL`
- `attendance_daily_results.project_id BIGINT DEFAULT NULL`

索引分别覆盖 `(company_id, project_id, shift_date)`。历史数据优先从对应排班或打卡时间点的任职记录回填；无法可靠判断的记录保留空值并列入迁移核查，不猜测项目。

## 5. API

统一成功响应：`{"success":true,"message":"操作成功","data":{...}}`。失败响应：`{"success":false,"message":"项目不存在或无权访问","code":"PROJECT_FORBIDDEN"}`。

### 5.1 可访问项目

`GET /api/attendance/projects`，权限 `attendance:view`。

响应示例：

```json
{"success":true,"data":{"list":[{"projectId":12,"projectName":"甲客户一厂项目","customerId":7,"customerName":"甲客户"}]}}
```

### 5.2 项目设置

`GET /api/attendance/projects/:projectId/settings`，权限 `attendance:view`。

`PUT /api/attendance/projects/:projectId/settings`，权限 `attendance:manage`。

请求示例：

```json
{
  "ruleName":"白班",
  "workStartTime":"08:00",
  "workEndTime":"17:00",
  "restStartTime":"12:00",
  "restEndTime":"13:00",
  "standardMinutes":480,
  "lateGraceMinutes":5,
  "earlyGraceMinutes":5,
  "overtimeMinMinutes":30,
  "workWeekdays":[1,2,3,4,5,6],
  "effectiveFrom":"2026-09-16",
  "geofenceIds":[31,32]
}
```

响应示例：

```json
{"success":true,"data":{"projectId":12,"ruleId":25,"effectiveFrom":"2026-09-16","geofenceIds":[31,32]}}
```

服务端校验项目属于当前企业且在用户范围内；所有围栏与项目属于同一客户；时间、星期、分钟和生效日期合法。

### 5.3 特殊日期

`GET /api/attendance/projects/:projectId/exceptions?month=2026-10`，权限 `attendance:view`。

`PUT /api/attendance/projects/:projectId/exceptions`，权限 `attendance:manage`。

请求示例：

```json
{"calendarDate":"2026-10-10","dayType":"WORKDAY","remark":"国庆调班"}
```

### 5.4 客户围栏库

`GET /api/attendance/geofences?customerId=7`，权限 `attendance:view`；结果只包含用户授权项目对应客户。

`POST /api/attendance/geofences`，权限 `attendance:manage`。

```json
{"customerId":7,"fenceName":"一厂东门","latitude":31.8123456,"longitude":119.9123456,"radiusMeters":300,"maxAccuracyMeters":100}
```

`PUT /api/attendance/geofences/:id`，权限 `attendance:manage`。停用已关联围栏时保留关联历史，项目不再用于新打卡判定。

### 5.5 日报

`GET /api/attendance/daily?projectId=12&date=2026-09-16`，权限 `attendance:view`。

```json
{
  "success":true,
  "data":{
    "project":{"projectId":12,"projectName":"甲客户一厂项目"},
    "summary":{"scheduled":28,"normal":22,"late":2,"earlyLeave":1,"missingPunch":1,"absent":2,"geofenceException":1},
    "list":[{"employeeId":101,"name":"张某","firstInAt":"2026-09-16 07:58:00","lastOutAt":"2026-09-16 17:10:00","workedMinutes":480,"resultStatus":"NORMAL","geofenceStatus":"INSIDE"}]
  }
}
```

### 5.6 月报

`GET /api/attendance/monthly?projectId=12&month=2026-09`，权限 `attendance:view`。

```json
{"success":true,"data":{"project":{"projectId":12,"projectName":"甲客户一厂项目"},"summary":{"employeeCount":28,"approvedNormalMinutes":268800,"approvedOvertimeMinutes":3600},"list":[{"employeeId":101,"name":"张某","scheduledDays":26,"attendanceDays":25,"approvedNormalMinutes":12000,"approvedOvertimeMinutes":120,"lateMinutes":5,"earlyLeaveMinutes":0,"missingPunchDays":1,"absentDays":0,"geofenceExceptionCount":1}]}}
```

### 5.7 围栏异常审核

现有接口增加必填 `projectId`：

- `GET /api/attendance/corrections?projectId=12&status=PENDING`
- `PUT /api/attendance/corrections/:id/review`

审核写入前根据异常记录的项目快照再次执行项目范围校验。

## 6. 网页交互

考勤页面保持现有原生 SPA 结构，分为四个不嵌套的工作区：

1. 顶部客户、项目级联选择；驻厂仅显示授权项目，默认首个项目。
2. “按天查看”和“按月汇总”标签页；日期或月份变化后只刷新当前项目。
3. “项目设置”区域维护班次、星期、特殊日期和已选围栏。
4. “客户围栏库”区域维护当前项目所属客户的围栏。

加载失败、无权限、无项目、无规则、无围栏和空统计分别显示明确状态。切换项目时取消旧请求或校验请求序号，避免慢响应覆盖新项目数据。保存按钮提交期间锁定，成功后重新读取服务端数据。

## 7. 安全与审计

- SQL 使用命名参数，不拼接用户输入。
- `projectId`、`customerId`、围栏 ID、日期和月份统一校验。
- 新增和更新项目规则、特殊日期、围栏及关联关系写入 `sys_operation_log`，记录对象 ID 和变更摘要，不记录员工定位原始值。
- 日报只返回业务所需定位状态、距离和围栏名称，不返回员工完整经纬度。
- 客户围栏坐标仅向具备 `attendance:manage` 且有对应客户范围的账号返回；只读账号获得围栏名称和状态。

## 8. 迁移与兼容

- 新迁移仅使用 `CREATE TABLE IF NOT EXISTS`、经 `information_schema` 判断的 `ALTER TABLE` 和幂等回填。
- 现有项目围栏先回填 `customer_id` 并建立项目关联，确认关联完整后业务切换为客户围栏库。
- 保留旧 `project_id` 一次发布周期用于回滚读取，不在本期删除列。
- 现有员工打卡接口地址不变；服务端改为从当日项目快照加载多个围栏。
- 无可靠项目归属的历史结果不进入项目报表，并在管理页面显示待核查数量。

## 9. 测试与验收

- 数据库：表、字段、主键、唯一索引、幂等迁移和旧围栏回填。
- 服务：项目规则优先级、工作日、特殊日期、多围栏判定和历史项目快照。
- 权限：两个驻厂账号、两个客户、多个项目交叉验证读写隔离；直接请求未授权 ID 返回 403 或空列表。
- 报表：日报人数与状态合计一致；月报从同一项目日报聚合；调项目前后分别归属正确项目。
- 前端：项目切换、日期月份筛选、保存锁定、空状态、错误重试和权限隐藏。
- 回归：`npm run test:attendance`、`npm run test:attendance-geofence`、项目新增专项测试、`npm run check`、`npm audit --audit-level=high` 和 `git diff --check`。

