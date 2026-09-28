# 考勤异常工作台与日结薪资设计

## 1. 背景与依据

现有网页端项目考勤已经提供客户/项目筛选、日报、月报、项目规则、特殊日期、电子围栏和异常审核；现有后端还具备按核准工时、班次时薪和补贴生成工资预览，以及记录单人日结支付状态的基础能力。但是当前页面仍以多个独立表格为主，缺少“先处理异常、再确认当日考勤、最后批量日结”的完整闭环，日结服务也没有正式路由、批量操作和网页端入口。

安心云人事的公开产品资料强调灵活考勤规则、定位等打卡风控、移动审核、实时统计报表和日薪日结。本文只借鉴其公开业务思路，不复制未公开页面或实现。参考：

- https://www.yunrenshi.net/
- https://www.yunrenshi.net/product

## 2. 已确认决策

1. 网页端考勤首页升级为“异常优先工作台”。
2. 新增独立“日结薪资”模块，并从考勤工作台提供快捷入口。
3. 采用两段式权限：考勤人员确认考勤，薪资人员确认日结。
4. 日结金额由系统自动计算，薪资人员人工确认后标记已支付；系统不连接银行或第三方支付渠道。
5. 正常工时和核准加班工时全部按对应班次小时工资计算，不设置 `1.5 / 2 / 3` 加班倍率。
6. 白班和夜班使用各自班次时薪，补贴按现有项目补贴规则累加。
7. 默认按项目和日期批量确认，保留单人明细与单人确认能力；阻断员工不参与批量确认。
8. 已支付记录不得直接覆盖。发生补卡或考勤更正时，先填写原因撤销日结，再重新计算和确认。
9. 工资条仍保持“上传—复核发放”的展示型流程；日结模块不自动发布工资条、不自动创建发薪指令，也不恢复金额异常提示。

## 3. 目标与非目标

### 3.1 目标

- 将缺卡、旷工、迟到早退、围栏异常和待审核申请集中到一个可处理工作台。
- 通过项目考勤日确认，形成日结计算所需的明确业务边界。
- 复用现有工资计算器和日结支付表，补齐正式 API、批量确认、撤销历史和网页端操作闭环。
- 保证考勤、工资权限分离，金额只向有薪资权限的账号返回。
- 保证批量确认幂等、并发安全、可审计且不产生部分成功。

### 3.2 非目标

- 不连接银行、支付宝、微信支付或其他代发渠道。
- 不引入考勤机、人脸识别或新的员工端打卡方式。
- 不改变现有工资条上传、复核、展示和签收流程。
- 不实现计件工资、混合计薪或法定加班倍率。
- 不删除或重写原始打卡记录。
- 本设计不包含生产部署和微信小程序发布。

## 4. 角色与权限

| 能力 | 权限 | 说明 |
| --- | --- | --- |
| 查看考勤工作台 | `attendance:view` | 只返回考勤指标和人员状态，不返回时薪及金额 |
| 审核异常、确认/重开考勤日 | `attendance:review` | 必须受企业和项目数据范围限制 |
| 维护班次、时薪和补贴 | `attendance:manage` + `payroll:manage` | 时薪属于敏感薪资配置，保存时同时校验两类权限 |
| 查看日结金额 | `payroll:view` | 只可查看授权项目 |
| 确认支付、撤销日结 | `payroll:manage` | 使用事务、幂等编号和操作日志 |

前端隐藏不是权限依据。所有接口必须先校验 `company_id`，再应用 `projectScope`；服务端不得以客户端传入的 `customerId` 作为授权依据。

## 5. 核心流程

```text
原始打卡/补卡申请
  → 生成或重算考勤每日结果
  → 异常工作台处理待审核事项
  → 考勤人员确认项目考勤日
  → 工资预览读取确认版本
  → 自动计算工时 × 班次时薪 + 补贴
  → 薪资人员批量或单人确认日结
  → 记录当前支付状态 + 追加支付事件 + 操作日志
```

### 5.1 确认考勤日

- 确认维度为 `company_id + project_id + shift_date`。
- 夜班归属班次开始日；只有跨夜下班卡完成并生成每日结果后才可确认。
- 存在待审核补卡、围栏异常或仍在有效打卡时间窗内的班次时，禁止确认。
- 迟到、早退、旷工可以作为最终考勤结果确认，不要求改成正常状态。
- 确认后记录当前版本号，后续工资快照必须引用该版本。

### 5.2 重新打开考勤日

- 必须填写原因。
- 当日存在状态为 `PAID` 的日结记录时禁止重开，先由薪资人员撤销日结。
- 重开后，旧工资预览立即标记失效；补卡或异常审核完成后重新计算考勤，再次确认。
- 确认、重开及原因均写入 `hr_operation_log`。

### 5.3 日结计算

- 仅员工计薪方式为 `DAILY_PAID` 时进入日结列表。
- `approved_minutes = approved_normal_minutes + approved_overtime_minutes`。
- 计薪分钟继续使用现有半小时四舍五入口径：不足半小时按最接近的 30 分钟取整，15 分钟进位。
- `base_amount = 班次小时工资 × 计薪分钟 ÷ 60`。
- 补贴沿用 `PER_SHIFT` 和 `PER_HOUR`，并按白班、夜班或全部班次匹配。
- `earned_amount = base_amount + allowance_amount`。
- 金额统一以分参与运算，最终保存两位小数，避免浮点累计误差。

### 5.4 阻断规则

以下任一条件成立时状态为 `BLOCKED`，不得被选入批量确认：

- 项目考勤日未确认或已重新打开。
- 补卡或围栏异常仍为待审核。
- 员工未设置 `DAILY_PAID`、默认班次或生效日期。
- 班次时薪缺失。
- 考勤结果缺失、版本过期或工资预览不是最新版本。
- 已支付金额与最新应得金额不一致且未先撤销。

旷工且核准工时为零时显示 `NO_PAYMENT`，不创建零金额支付记录。

### 5.5 批量确认

- 页面默认勾选当前项目、日期下全部 `READY` 员工。
- 请求必须携带工资预览 `runId`、考勤确认版本、员工 ID 列表和 8–64 位 `clientRequestId`。
- 服务端在一个事务中锁定预览、考勤确认、每日工资行和已有支付记录。
- 任一所选员工在提交时变为阻断、已支付或版本过期，整批回滚并返回冲突，不允许部分成功。
- 同一 `clientRequestId` 重试返回首次结果，不重复写支付记录或日志。
- 单人确认复用同一个批量接口，只传一个员工 ID。

### 5.6 撤销与重新结算

- 撤销必须填写 1–255 字原因。
- 撤销更新当前支付状态，同时向事件表追加 `REVOKE` 事件，不删除原支付金额和首次支付信息。
- 考勤日重新确认并生成新预览后，可再次支付；事件表追加 `REPAID`，保留前后金额和计算版本。

## 6. 页面设计

### 6.1 考勤异常工作台

顶部固定客户、项目和日期上下文，显示：

- 应出勤、已出勤、正常。
- 迟到、早退、缺卡、旷工、围栏异常。
- 待审核数量和考勤日状态。

默认打开“待处理”视图，另设“全部员工”和“日报明细”。支持按异常类型、员工姓名筛选。待处理行提供查看打卡、查看定位状态、审核补卡等现有操作。页面底部提供“确认当日考勤”；已确认状态下提供“重新打开”，并要求原因。

无 `payroll:view` 权限时，只显示“未确认 / 可结算 / 已完成”等非金额状态。具备薪资权限时可点击“进入日结薪资”。

### 6.2 独立日结薪资模块

顶部筛选：客户、项目、结算日期、员工关键字和状态。汇总卡片显示：

- 日结员工数。
- 可结算人数及金额。
- 阻断人数。
- 已支付人数及金额。

列表列项：勾选、员工、班次、实际工时、核准工时、时薪、基础工资、补贴、应结金额、状态、操作。员工明细展开后展示打卡时间、考勤状态、计算公式、补贴项目和历史日结事件。

主要操作：刷新计算、批量确认已支付、单人确认、查看阻断原因、撤销日结。所有提交按钮使用提交锁和二次确认。

## 7. 数据结构

迁移文件必须幂等，不使用 `DELETE`、`DROP` 或 `TRUNCATE`；新增列和索引前读取 `information_schema`。

### 7.1 `attendance_daily_closures`

保存项目考勤日的当前状态；每次确认或重开同时写操作日志。

| 字段 | 类型 | 约束与说明 |
| --- | --- | --- |
| `id` | `BIGINT` | 主键，自增 |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `shift_date` | `DATE NOT NULL` | 班次归属日期 |
| `status` | `VARCHAR(20) NOT NULL` | `OPEN` / `CONFIRMED` |
| `version_no` | `INT UNSIGNED NOT NULL DEFAULT 0` | 每次确认或重开递增 |
| `confirmed_by` | `BIGINT DEFAULT NULL` | 最近确认人 |
| `confirmed_at` | `DATETIME DEFAULT NULL` | 最近确认时间 |
| `reopened_by` | `BIGINT DEFAULT NULL` | 最近重开人 |
| `reopened_at` | `DATETIME DEFAULT NULL` | 最近重开时间 |
| `reopen_reason` | `VARCHAR(255) DEFAULT NULL` | 最近重开原因 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 更新时间 |

唯一索引：`(company_id, project_id, shift_date)`；状态查询索引：`(company_id, project_id, status, shift_date)`。

### 7.2 `attendance_daily_closure_events`

以追加方式保存考勤日确认和重开事件，并提供严格幂等依据。

| 字段 | 类型 | 约束与说明 |
| --- | --- | --- |
| `id` | `BIGINT` | 主键，自增 |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `closure_id` | `BIGINT NOT NULL` | 考勤日当前状态记录 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `shift_date` | `DATE NOT NULL` | 班次归属日期 |
| `action_type` | `VARCHAR(20) NOT NULL` | `CONFIRM` / `REOPEN` |
| `version_no` | `INT UNSIGNED NOT NULL` | 本次操作后的版本号 |
| `client_request_id` | `VARCHAR(64) NOT NULL` | 幂等请求编号 |
| `reason` | `VARCHAR(255) DEFAULT NULL` | 重开原因 |
| `operated_by` | `BIGINT NOT NULL` | 操作人 |
| `operated_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 操作时间 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |

唯一索引：`(company_id, client_request_id)`；查询索引：`(company_id, project_id, shift_date, operated_at)`。重复请求先按唯一索引读取首次结果，不重复递增版本或写操作日志。

### 7.3 `wage_daily_payment_events`

支付状态仍由现有 `wage_daily_payments` 保存；本表以追加方式保存完整历史。

| 字段 | 类型 | 约束与说明 |
| --- | --- | --- |
| `id` | `BIGINT` | 主键，自增 |
| `company_id` | `BIGINT NOT NULL` | 企业 ID |
| `payment_id` | `BIGINT NOT NULL` | 当前支付记录 ID |
| `project_id` | `BIGINT NOT NULL` | 项目 ID |
| `employee_id` | `BIGINT NOT NULL` | 员工 ID |
| `shift_date` | `DATE NOT NULL` | 日结日期 |
| `action_type` | `VARCHAR(20) NOT NULL` | `MARK_PAID` / `REVOKE` / `REPAID` |
| `amount` | `DECIMAL(12,2) NOT NULL` | 本次事件金额快照 |
| `run_id` | `BIGINT DEFAULT NULL` | 工资预览版本 |
| `closure_version` | `INT UNSIGNED NOT NULL` | 考勤确认版本 |
| `client_request_id` | `VARCHAR(64) NOT NULL` | 幂等请求编号 |
| `remark` | `VARCHAR(255) DEFAULT NULL` | 备注或撤销原因 |
| `operated_by` | `BIGINT NOT NULL` | 操作人 |
| `operated_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 操作时间 |
| `created_at` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |

唯一索引：`(company_id, client_request_id, employee_id)`；查询索引：`(company_id, project_id, shift_date, employee_id, operated_at)`。

### 7.4 工资快照补列

`wage_calculation_daily_lines` 增加：

- `attendance_closure_id BIGINT DEFAULT NULL`
- `attendance_closure_version INT UNSIGNED DEFAULT NULL`

新工资预览只有在考勤日为 `CONFIRMED` 时写入确认 ID 和版本；旧历史行允许为空，不猜测回填。

## 8. API 设计

统一成功响应：`{"success":true,"message":"操作成功","data":{...}}`。失败响应：`{"success":false,"message":"...","code":"..."}`。

### 8.1 考勤异常工作台

`GET /api/attendance/workbench?projectId=12&date=2026-09-28&status=PENDING&keyword=`

权限：`attendance:view`。

成功响应示例：

```json
{
  "success": true,
  "data": {
    "closure": {"status": "OPEN", "versionNo": 2},
    "summary": {"scheduled": 28, "present": 25, "late": 2, "missingPunch": 1, "absent": 2, "pendingReview": 1},
    "list": [{"employeeId": 101, "name": "张某", "resultStatus": "MISSING_PUNCH", "pendingReason": "补卡申请待审核"}]
  }
}
```

该接口不得返回 `hourlyRate`、补贴金额或工资金额。

### 8.2 确认考勤日

`POST /api/attendance/daily-close`

权限：`attendance:review`。

```json
{"projectId":12,"shiftDate":"2026-09-28","clientRequestId":"attendance-close-12-20260928-v1"}
```

响应：

```json
{"success":true,"data":{"projectId":12,"shiftDate":"2026-09-28","status":"CONFIRMED","versionNo":3}}
```

### 8.3 重新打开考勤日

`POST /api/attendance/daily-reopen`

权限：`attendance:review`。

```json
{"projectId":12,"shiftDate":"2026-09-28","reason":"员工补交下班卡","clientRequestId":"attendance-reopen-12-20260928-v1"}
```

当日仍有已支付日结记录时返回 `409 DAILY_PAYMENT_ACTIVE`。

### 8.4 生成日结预览

`POST /api/wage-daily-settlements/preview`

权限：`payroll:manage`，并应用项目范围。

```json
{"projectId":12,"shiftDate":"2026-09-28","clientRequestId":"wage-preview-12-20260928-v1"}
```

内部复用现有月份工资预览和日工资计算器，只返回所选日期的结果；不创建工资批次、不发布工资条。

### 8.5 查询日结列表

`GET /api/wage-daily-settlements?projectId=12&shiftDate=2026-09-28&status=READY&keyword=`

权限：`payroll:view`。

响应示例：

```json
{
  "success": true,
  "data": {
    "runId": 81,
    "closureVersion": 3,
    "summary": {"employeeCount": 28, "readyCount": 24, "blockedCount": 2, "paidCount": 2, "readyAmount": "4680.00"},
    "list": [{"employeeId":101,"name":"张某","shiftType":"DAY","approvedHours":"8.50","hourlyRate":"20.00","allowanceAmount":"10.00","earnedAmount":"180.00","status":"READY"}]
  }
}
```

### 8.6 批量确认支付

`POST /api/wage-daily-settlements/batch-confirm`

权限：`payroll:manage`，建议使用敏感接口限流。

```json
{
  "projectId": 12,
  "shiftDate": "2026-09-28",
  "runId": 81,
  "closureVersion": 3,
  "employeeIds": [101, 102],
  "remark": "现金日结已核对",
  "clientRequestId": "daily-pay-12-20260928-batch-1"
}
```

成功响应：

```json
{"success":true,"data":{"status":"PAID","paidCount":2,"totalAmount":"360.00"}}
```

单人确认使用相同接口并只传一个员工 ID。

### 8.7 撤销日结

`POST /api/wage-daily-settlements/:paymentId/revoke`

权限：`payroll:manage`，建议使用敏感接口限流。

```json
{"reason":"员工补卡后需重新计算","clientRequestId":"daily-revoke-9001-v1"}
```

### 8.8 日结历史

`GET /api/wage-daily-settlements/:paymentId/events`

权限：`payroll:view`。按时间返回支付、撤销和重新支付事件，不返回身份证号、银行卡号等敏感信息。

## 9. 错误处理

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `INVALID_ATTENDANCE_CLOSURE` | 项目、日期、原因或幂等编号格式错误 |
| 403 | `PROJECT_FORBIDDEN` | 项目不存在或无权访问 |
| 409 | `ATTENDANCE_PENDING` | 仍有待审核异常或班次尚未结束 |
| 409 | `ATTENDANCE_ALREADY_CONFIRMED` | 重复确认且请求编号不同 |
| 409 | `DAILY_PAYMENT_ACTIVE` | 已支付日结尚未撤销，不能重开考勤 |
| 409 | `DAILY_WAGE_BLOCKED` | 所选员工存在阻断项 |
| 409 | `WAGE_PREVIEW_STALE` | 工资预览或考勤确认版本已变化 |
| 409 | `DAILY_PAYMENT_ALREADY_PAID` | 当前员工已由其他请求确认支付 |
| 404 | `DAILY_PAYMENT_NOT_FOUND` | 日结记录不存在或不在权限范围 |

页面保留筛选条件和已加载数据，错误显示在当前工作区；版本冲突时提示“数据已更新，请刷新后重新确认”，不得静默重试写操作。

## 10. 并发、审计与隐私

- 确认考勤、重新打开、批量支付和撤销均在数据库事务中执行。
- 锁定顺序固定为项目/考勤确认 → 工资预览 → 每日工资行 → 支付记录，降低死锁风险。
- 操作日志只保存业务 ID、状态、版本、金额汇总和原因，不保存身份证号、银行卡号、Token 或定位原始坐标。
- 考勤工作台中的围栏信息只展示状态和必要距离；无 `attendance:manage` 权限不返回围栏中心坐标。
- 批量接口限制员工数量，初始上限 500 人；超限返回 400，避免长事务。
- 导出不在本期范围，防止日结金额通过未授权文件扩散。

## 11. 测试与验收

### 11.1 服务测试

- 白班、夜班、跨夜班的考勤确认时点。
- 半小时四舍五入边界：14、15、16、44、45、46 分钟。
- 正常工时与核准加班统一按班次时薪计算。
- `PER_SHIFT`、`PER_HOUR` 及白班/夜班补贴。
- 未确认考勤、待审核异常、班次/时薪缺失的阻断。
- 旷工零工时为 `NO_PAYMENT`，不创建零金额支付记录。
- 批量确认原子性、重复请求幂等和并发确认冲突。
- 已支付阻止重开；撤销后允许重开、重算和重新支付。
- 支付事件完整保留前后金额、版本、人员和原因。

### 11.2 权限与隔离测试

- `attendance:view` 响应中不存在时薪、补贴和工资金额字段。
- 无 `attendance:review` 不可确认或重开考勤日。
- 无 `payroll:view` 不可查看日结金额。
- 无 `payroll:manage` 不可确认或撤销支付。
- 不同企业、客户、项目及驻厂账号之间数据隔离。

### 11.3 页面测试

- 异常卡片数字与列表筛选一致。
- 项目/日期快速切换时旧请求不得覆盖新页面。
- 批量选择只包含 `READY`，阻断项不可选。
- 提交锁、二次确认、版本冲突、空状态和失败重试。
- 1440×900、1024×768 和 390×844 无关键内容遮挡或不可达操作。

### 11.4 完整验证

- 新增定向测试先红后绿。
- `npm run check`。
- `npm audit --audit-level=high`。
- `git diff --check`。
- 数据库迁移一致性、发布包检查和只读本地页面验收。

## 12. 实施边界与协作

- 实施必须在独立 `codex/` 分支或工作树进行，不覆盖 Claude 或主工作区的未提交修改。
- 本设计分支创建时 GitHub 网络不可用，基线为本地最后一次已验证的 `origin/main` 合并提交 `abc9db3`。开始实施前必须重新联网刷新远端，并将设计及后续实现重放到最新 `origin/main`；未完成此步骤不得合并或部署。
- 先实现考勤日确认和异常工作台，再接入日结 API，最后实现日结页面；每一阶段均保留可独立回归的测试。
- 提交、推送、PR、生产部署和微信小程序上传分别确认，不互相视为已授权。
