# 腾讯云短信验证码登录与工资条通知设计

## 1. 需求概述

在现有“优益数字化管理系统”中接入腾讯云 SMS，完成两个业务闭环：

1. 员工可使用“手机号 + 6 位短信验证码”登录小程序，作为微信快捷登录和一次性绑定码之外的备用入口。
2. 工资条发布、催签和失败补发可发送短信。短信包含微信官方 URL Link，点击后打开小程序登录页。

核心原则：

- 短信中不包含工资金额、完整姓名、身份证号、银行卡号或工资条 ID。
- URL Link 固定打开 `/pages/login/index`，不携带员工或薪资业务参数。
- 打开小程序后仍必须登录；登录后工资条只能由 Token 中的 `employeeId` 查询本人数据。
- 工资发布不等待腾讯云发送结果，短信故障不得回滚工资业务。
- 密钥、验证码明文、完整手机号和 Token 不进入日志或数据库明文字段。

## 2. 用户角色

| 角色 | 能力 |
| --- | --- |
| 员工 | 获取登录验证码、验证码登录、从短信链接打开本人工资条、查询与签收 |
| 薪资专员 | 发布工资条、查看短信发送统计、对未签收员工催签、对失败记录补发 |
| HR 主管 | 在其项目数据范围内查看通知结果与异常 |
| 企业管理员 | 查看全企业发送结果，启停短信功能，不能查看验证码明文 |
| 驻厂专员 | 无工资短信发送权限，仅可维护其负责员工的手机号 |

## 3. 方案与系统边界

### 3.1 推荐方案

采用“腾讯云 SMS + MySQL 验证码与发送队列 + 现有定时任务 + 微信 URL Link”：

- 验证码发送是即时请求，仅在服务商接受后返回通用成功提示。
- 工资通知先在工资发布事务内创建发送任务，再由定时工作器异步发送。
- 任务表同时承担幂等、重试和发送留痕，MVP 不增加 Redis 或独立消息队列。
- 使用一个预先在微信生成的长期 URL Link，目标页为现有工资根页 `pages/payroll/index`，不为每个员工生成个性化链接。

### 3.2 暂不实现

- 营销短信、群发广告和非 HR 业务通知。
- 在短信 URL 中携带工资条 ID 或一次性免登录 Token。
- 通过手机号查询并向未知用户披露员工是否存在。
- 同时引入 Redis、RabbitMQ 或 Kafka。
- 短信中发送工资条 PDF 或文件下载链接。

## 4. 功能模块

### 4.1 腾讯云短信网关

新增独立 `sms-provider` 服务，只负责：

- 把国内手机号转换为 `+86` E.164 格式。
- 按模板 key 选择已审核模板 ID。
- 调用 `tencentcloud-sdk-nodejs` 的 SMS `v20210111.SendSms`。
- 把腾讯云响应转换成统一结果：`accepted/providerCode/providerMessage/requestId/serialNo`。
- 对外不暴露 SecretId、SecretKey 或腾讯云原始异常堆栈。

### 4.2 验证码登录

- 员工输入手机号后请求验证码。
- 只有当手机号精确匹配唯一未删除的在职员工时才实际发送。
- 无匹配、重复手机号和正常发送的 HTTP 返回统一使用“如果该手机号已登记，验证码将发送到您的手机”，防止枚举员工。
- 验证码为 6 位数字，5 分钟过期，仅保存 HMAC-SHA256 结果。
- 同一手机号 60 秒内不得重复发送，24 小时最多 10 次。
- 同一 IP 1 小时最多请求 20 次。
- 单个验证码最多失败 5 次，成功后在同一事务中置为已使用。
- 登录成功后复用现有员工账号创建和 Token 签发逻辑，固定 `accountType=EMPLOYEE`。
- 离职、停用或删除员工不得通过验证码获得会话。

### 4.3 工资条发布通知

- 工资批次从待发放发布为已发放时，为批次中每个待签收员工创建一条 `PAYSLIP_PUBLISHED` 任务。
- 幂等键：`PAYSLIP_PUBLISHED:{companyId}:{batchId}:{employeeId}`。
- 没有有效手机号的员工记为 `SKIPPED_NO_PHONE`，不影响其他员工。
- 短信参数仅包含工资月份和固定 URL Link。
- 发布接口返回已创建任务数和无手机号数，不返回完整手机号。

### 4.4 催签与失败补发

- 催签仅选择已发布且 `receipt_status=1` 的工资条。
- 同一员工、同一批次 12 小时内最多成功发送一次催签短信。
- 一次操作最多创建 500 条催签任务，超出时要求按项目或批次分批。
- 自动重试仅处理网络超时、频率限制和腾讯云暂时错误，最多 3 次，间隔为 1、5、30 分钟。
- 手机号不合法、模板未审核、签名错误等永久错误不自动重试。
- 补发只能针对 `FAILED` 或 `SKIPPED_NO_PHONE` 记录；补发前重新读取员工当前手机号和工资条签收状态。

## 5. 数据结构

### 5.1 `employee_sms_verification` 验证码表

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | BIGINT | 主键，自增 |
| `company_id` | BIGINT | 企业 ID，必填 |
| `employee_id` | BIGINT | 匹配的员工 ID，可空 |
| `purpose` | VARCHAR(30) | 固定 `EMPLOYEE_LOGIN` |
| `phone_hash` | CHAR(64) | 企业维度 HMAC 手机号摘要 |
| `phone_tail` | CHAR(4) | 仅保存后四位 |
| `code_hash` | CHAR(64) | 验证码 HMAC，不保存明文 |
| `expires_at` | DATETIME | 5 分钟过期 |
| `failed_attempts` | TINYINT | 默认 0，最多 5 |
| `send_status` | VARCHAR(20) | `PENDING/SENT/FAILED/SUPPRESSED` |
| `provider_request_id` | VARCHAR(100) | 腾讯云请求 ID，可空 |
| `consumed_at` | DATETIME | 验成功时写入 |
| `request_ip_hash` | CHAR(64) | IP 摘要，避免长期明文保存 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

索引：

- `idx_company_phone_time(company_id, phone_hash, created_at)`
- `idx_company_ip_time(company_id, request_ip_hash, created_at)`
- `idx_expiry_status(expires_at, consumed_at)`

### 5.2 `sms_delivery_job` 发送任务与留痕表

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | BIGINT | 主键，自增 |
| `company_id` | BIGINT | 企业 ID，必填 |
| `employee_id` | BIGINT | 收件员工 ID，必填 |
| `batch_id` | BIGINT | 工资批次 ID，可空 |
| `payslip_id` | BIGINT | 工资条 ID，可空 |
| `business_type` | VARCHAR(30) | `PAYSLIP_PUBLISHED/PAYSLIP_REMINDER` |
| `template_key` | VARCHAR(40) | 系统模板 key，不直接由前端传腾讯云模板 ID |
| `salary_month` | CHAR(7) | `YYYY-MM` |
| `phone_hash` | CHAR(64) | 实际尝试发送号码的 HMAC |
| `phone_tail` | CHAR(4) | 手机号后四位 |
| `delivery_status` | VARCHAR(25) | `PENDING/SENDING/SENT/FAILED/SKIPPED_NO_PHONE/CANCELLED` |
| `attempt_count` | TINYINT | 已尝试次数 |
| `next_attempt_at` | DATETIME | 下次可执行时间 |
| `provider_code` | VARCHAR(80) | 腾讯云结果码 |
| `provider_request_id` | VARCHAR(100) | 腾讯云请求 ID |
| `provider_serial_no` | VARCHAR(100) | 腾云短信流水号 |
| `error_summary` | VARCHAR(255) | 经过清理的错误摘要 |
| `dedupe_key` | VARCHAR(180) | 企业内幂等键 |
| `created_by` | BIGINT | 创建人，系统任务可空 |
| `sent_at` | DATETIME | 发送成功时间 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

索引：

- `UNIQUE KEY uk_company_dedupe(company_id, dedupe_key)`
- `idx_pending(delivery_status, next_attempt_at)`
- `idx_batch_status(company_id, batch_id, delivery_status)`
- `idx_employee_time(company_id, employee_id, created_at)`

## 6. 页面结构

### 6.1 小程序员工登录页

员工登录保留现有三种方式：

1. 微信快捷登录。
2. 手机号验证码登录。
3. 一次性绑定码。

验证码区域字段：

- 手机号：11 位国内号码。
- 验证码：6 位数字。
- 获取验证码：60 秒倒计时，请求中不可重复点击。
- 登录按钮：验证成功后进入员工首页。

页面不显示“该手机号不存在”或匹配到的员工姓名。

### 6.2 小程序短信链接落地

- URL Link 目标页：`pages/payroll/index`。
- 已登录员工：直接加载本人工资条。
- 未登录或会话失效：跳转统一登录页，登录后回到工资条列表。
- 管理账号误打开：不加载员工工资数据，引导切换员工登录。

### 6.3 网页端工资批次详情

新增“短信通知”区块：

- 任务总数、已发送、待发送、失败、无手机号。
- “催签未签收员工”按钮。
- “补发失败短信”按钮。
- 员工明细仅显示姓名、手机号后四位、签收状态、短信状态、最后尝试时间和失败原因摘要。
- 催签和批量补发前显示二次确认，内容包含预计人数，不显示手机号清单。

## 7. 核心业务流程

### 7.1 验证码登录

1. 员工输入手机号并点击获取验证码。
2. 服务端校验格式、企业、IP 限流和手机号频率。
3. 服务端以统一响应隐藏员工是否存在。
4. 唯一匹配在职员工时，生成 6 位码，保存 HMAC 后调用腾讯云。
5. 员工输入验证码并提交。
6. 服务端锁定最新未使用记录，校验过期、失败次数和 HMAC。
7. 成功后在同一事务内消费验证码、确认员工仍在职、创建或启用员工账号。
8. 签发 `accountType=EMPLOYEE` 会话，写入脱敏登录审计。

### 7.2 工资发布与短信

1. 薪资专员发布已复核工资批次。
2. 事务内更新批次和工资条状态、写入操作日志、创建站内通知和短信任务。
3. 事务提交后立即返回，不在 HTTP 请求中遍历发送所有短信。
4. 定时工作器抢占待发送任务，每批最多 100 条，将状态改为 `SENDING`。
5. 发送前重新校验企业、员工、工资批次和签收状态。
6. 调用腾讯云后写入 `SENT` 或失败信息；暂时错误安排下次重试。
7. 员工点击短信 URL Link，打开小程序登录页。
8. 员工登录后，后端仅按 Token 中的员工 ID 返回其本人工资条。

## 8. REST 接口设计

### 8.1 发送登录验证码

`POST /api/auth/employee/sms-code`

权限：公开接口 + 登录专用限流。

请求：

```json
{
  "companyId": 1,
  "phone": "13800000000"
}
```

成功响应（无论员工是否存在均保持一致）：

```json
{
  "code": 0,
  "message": "如果该手机号已登记，验证码将发送到您的手机",
  "data": { "retryAfterSeconds": 60 }
}
```

### 8.2 验证码登录

`POST /api/auth/employee/sms-login`

权限：公开接口 + 登录专用限流。

请求：

```json
{
  "companyId": 1,
  "phone": "13800000000",
  "code": "123456"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "token": "<JWT>",
    "user": {
      "companyId": 1,
      "employeeId": 88,
      "accountType": "EMPLOYEE",
      "roles": [],
      "permissions": []
    }
  }
}
```

通用失败响应：

```json
{
  "code": 400,
  "businessCode": "EMPLOYEE_SMS_CODE_INVALID",
  "message": "验证码无效或已过期",
  "data": null
}
```

### 8.3 查询批次短信状态

`GET /api/payroll/batches/:id/sms-summary`

权限：`payroll:view` + 现有项目数据范围。

响应：

```json
{
  "code": 0,
  "data": {
    "total": 100,
    "pending": 2,
    "sent": 92,
    "failed": 3,
    "skippedNoPhone": 3,
    "items": [
      {
        "employeeId": 88,
        "employeeName": "张三",
        "phoneTail": "0000",
        "receiptStatus": 1,
        "deliveryStatus": "SENT",
        "lastAttemptAt": "2026-08-14 16:30:00",
        "errorSummary": ""
      }
    ]
  }
}
```

### 8.4 创建催签任务

`POST /api/payroll/batches/:id/sms-reminders`

权限：`payroll:manage` + 现有项目数据范围 + `sensitiveLimiter`。

请求：

```json
{
  "confirmed": true
}
```

响应：

```json
{
  "code": 0,
  "message": "催签任务已创建",
  "data": {
    "created": 80,
    "suppressed": 15,
    "skippedNoPhone": 5
  }
}
```

### 8.5 补发失败短信

`POST /api/payroll/batches/:id/sms-retry`

权限：`payroll:manage` + 现有项目数据范围 + `sensitiveLimiter`。

请求：

```json
{
  "confirmed": true
}
```

响应：

```json
{
  "code": 0,
  "message": "补发任务已重置",
  "data": { "queued": 8, "cancelledAlreadySigned": 2 }
}
```

## 9. 权限、隔离与风控

- 所有验证码和发送任务 SQL 必须同时带 `company_id`。
- 工资通知管理接口复用项目数据范围，不得仅根据批次 ID 查询。
- 员工登录后的工资接口仍使用 `requireEmployeeAccount`，不接收前端传入的 `employeeId`。
- 验证码使用独立 `SMS_CODE_HMAC_SECRET`，不与 JWT、员工绑定票据或数据加密密钥共用。
- 配置、日志、响应和操作日志不保存验证码明文、完整手机号、SecretId、SecretKey 或 URL Link 中的管理凭据。
- 每个催签、补发和配置变更操作写入 `hr_operation_log`。
- 批量发送前必须二次确认；服务端校验 `confirmed === true`，不仅依赖前端弹窗。
- 短信总开关默认为关闭。未完成模板、签名和 URL Link 配置时，生产启动不失败，但发送任务会明确记为“短信未启用”。

## 10. 生产配置

```dotenv
TENCENT_SMS_ENABLED=false
TENCENT_SMS_REGION=ap-guangzhou
TENCENT_SMS_SDK_APP_ID=
TENCENT_SMS_SIGN_NAME=
TENCENT_SMS_TEMPLATE_LOGIN_CODE=
TENCENT_SMS_TEMPLATE_PAYSLIP_PUBLISHED=
TENCENT_SMS_TEMPLATE_PAYSLIP_REMINDER=
TENCENT_SMS_PAYSLIP_URL_LINK=
SMS_CODE_HMAC_SECRET=
```

凭证顺序：

1. 优先使用腾讯云 CVM 实例角色与最小 SMS 权限。
2. 无实例角色时，复用服务器已安全配置的 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY`。
3. 不得把密钥写入 `.env.production.example`、Git、前端、小程序或短信模板。

URL Link 要求：

- 由已发布的正式版小程序生成。
- 目标路径固定为 `pages/payroll/index`。
- 链接必须先在腾讯云短信模板审核和微信真机环境中验证。
- 如模板平台不允许 URL 作为变量，则把已审核的固定 URL Link 直接写入模板正文，系统仅传工资月份。

## 11. 错误处理

| 场景 | 处理 |
| --- | --- |
| 短信未配置 | 验证码页提示“短信服务暂不可用”；工资发布仍成功 |
| 腾讯云超时 | 验证码返回通用失败；通知任务按退避策略重试 |
| 验证码错误 | 原子增加失败次数，不泄露员工信息 |
| 验证码已过期 | 返回稳定业务错误码 `EMPLOYEE_SMS_CODE_INVALID` |
| 员工已离职 | 消费前再校验，拒绝登录并写入脱敏审计 |
| 工资条已签收 | 催签任务发送前取消，不再发送 |
| 手机号已修改 | 每次尝试发送前读取最新员工档案，留存实际号码摘要 |
| URL Link 无效 | 短信任务不携带备用敏感链接；用户可手动打开小程序查看 |

## 12. 测试与验收

### 12.1 自动化测试

- 数据库迁移幂等，且不包含 `DROP/TRUNCATE/DELETE FROM`。
- 验证码不以明文进入数据库、返回体和日志。
- 员工不存在、手机号重复与正常发送返回同样的公开响应。
- 60 秒重发、24 小时次数、IP 次数和 5 次输错限制有回归测试。
- 验证码成功后不能重放。
- 离职员工无法使用未过期验证码登录。
- 工资发布与短信任务创建在同一数据库事务内。
- 腾讯云失败不影响工资批次发布。
- 任务幂等、三次退避重试、已签收取消、无手机号跳过有回归测试。
- 催签和补发接口校验权限、项目范围和二次确认。
- 短信状态页不显示完整手机号或腾讯云密钥。
- 短信链接不包含 `employeeId`、`payslipId`、工资金额或免登录 Token。

### 12.2 上线验收

1. 使用腾讯云测试号码发送验证码，确认模板参数顺序正确。
2. 真机验证验证码登录，登录后只能查看本人工资条。
3. 使用一个最小测试工资批次验证发布通知。
4. 分别用苹果和安卓手机点击短信 URL Link，确认打开正式小程序登录页。
5. 退出登录后再点击链接，确认仍先进入登录页，不能绕过登录直接查看工资条。
6. 故意使用无效模板测试发送失败、后台状态和人工补发。
7. 检查应用日志、操作日志和数据库，确认无验证码明文、完整手机号和工资金额泄露。

## 13. 开发文件边界

预计新增：

- `sql/migrate-tencent-sms-20260814.mysql.sql`
- `src/services/tencent-sms.service.js`
- `src/services/employee-sms-auth.service.js`
- `src/services/sms-delivery.service.js`
- `src/controllers/sms.controller.js`
- `src/routes/sms.routes.js`
- 验证码、发送队列、隔离、页面和安全测试。

预计修改：

- `.env.production.example`
- `src/config/env.js`
- `sql/schema.mysql.sql`
- `scripts/deploy-production.sh`
- `scripts/verify-release-package.sh`
- `src/services/employee-auth.service.js`
- `src/services/operations.service.js`
- `src/controllers/operations.controller.js`
- `src/routes/operations.routes.js`
- `src/scheduler.js`
- `public/index.html`
- `public/app.js`
- `wechat-miniprogram/miniprogram/pages/login/*`
- `wechat-miniprogram/miniprogram/pages/payroll/*`
- `package.json`

## 14. 可扩展建议

- 第二阶段可接入微信订阅消息，与短信形成双通道并避免重复提醒。
- 发送量明显增长后，可把 MySQL 队列替换为云队列，但保留现有幂等键和发送日志接口。
- 可增加企业级短信额度、月度用量预警和成本统计。
- 可增加员工通知偏好，但验证码不允许关闭。
