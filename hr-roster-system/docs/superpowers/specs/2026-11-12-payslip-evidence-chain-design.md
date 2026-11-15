# 工资条自有证据链设计

> 日期：2026-11-12
> 状态：已确认，分阶段实施中
> 范围：Web/API、MySQL、微信小程序；不接第三方电子签，不自动部署或上传小程序

## 1. 目标

在现有“查看工资条、手写签名、确认签收、提交异议”流程上补齐低成本证据链，使系统能够证明：

1. 哪个已绑定员工账号完成了签收；
2. 员工签收的是哪一份、哪一版本工资条；
3. 签署前使用与工资条、员工和登录账号绑定的一次性挑战确认本次签收请求；
4. 工资条内容、签名图片、签收声明和操作日志在签收后是否发生变化；
5. 员工和有权限的管理人员能够下载同一份电子签收回执；
6. 员工签收不等于放弃工资异议权。

该方案形成可验证的电子数据证据链，不宣传为第三方 CA 认证电子签名，也不承诺在所有争议中当然等同纸质签名。

## 2. 非目标

- 不接入 e 签宝、法大大、腾讯电子签或其他收费电子签平台；
- 不自建 CA、区块链或人脸识别；
- 不通过 AI 判断笔迹是否与身份证姓名一致；
- 不改变工资条上传、复核发放和工资计算规则；
- 不改变银行代发记录作为实际支付凭证的独立地位；
- 不允许管理员代员工签名或提供通用跳过入口；
- 本设计确认不代表授权生产迁移、部署、小程序上传、提交审核或正式发布。

## 3. 现有基础

现有系统继续复用以下能力：

- 员工账号、企业和员工档案绑定；
- 工资条本人访问校验和企业数据隔离；
- 手写签名质量检查、PNG 安全校验和 SHA-256；
- 签名姓名必须与员工档案姓名一致；
- 签名时间、IP、设备信息；
- VIEW、ACCEPT、REJECT 证据日志；
- 已签收状态不可重复变更；
- 工资异议提交和处理入口；
- 附件私有存储、数据库及附件备份；
- `pdf-lib`、`@pdf-lib/fontkit` 和已有思源中文字体。

## 4. 总体方案

采用“内容快照 + 一次性签收挑战 + 手写签名 + 链式日志 + PDF 回执”的组合证据：

```text
复核发放
  → 生成不可变工资条展示快照
  → 计算 content_sha256
  → 员工查看并产生 VIEW 日志
  → 手写姓名并主动勾选签收声明
  → 自动申请当前工资条的一次性签收挑战
  → 提交签名和挑战凭证
  → 校验本人、挑战凭证、内容摘要和签名质量
  → 保存签名 SHA-256
  → 确认签收并生成链式 ACCEPT 日志
  → 生成固定内容 PDF 回执及 receipt_sha256
  → 员工和有权限管理员下载、验真
```

工资条修正必须撤回原版本并重新生成新的工资条明细。已签收记录、原快照、原签名、原日志和原回执只允许标记业务状态，不允许覆盖或删除。

## 5. 工资条快照与摘要

### 5.1 快照内容

在工资条复核发放时，按员工可见内容生成确定性 JSON：

```json
{
  "schemaVersion": "1.0",
  "companyId": 1,
  "salaryDetailId": 901,
  "salaryMonth": "2026-10",
  "employeeId": 88,
  "employeeName": "张三",
  "customerName": "某制造公司",
  "projectName": "某项目",
  "items": [
    { "name": "基本工资", "value": "5000.00" },
    { "name": "实发工资", "value": "4800.00" }
  ]
}
```

规则：

- 对象键按固定顺序序列化；
- 金额统一为两位小数字符串；
- `items` 保持工资条展示顺序；
- 不写入身份证号、银行卡号、手机号或 Token；
- `content_sha256 = SHA256(UTF8(canonical_json))`；
- 员工查看、签名、签收和回执均使用该快照，不临时重新拼装业务数据。

### 5.2 `salary_detail` 新增字段

| 字段 | 类型 | 约束 | 用途 |
|---|---|---|---|
| `evidence_schema_version` | `VARCHAR(20)` | 可空 | 快照结构版本，首版为 `1.0` |
| `evidence_snapshot` | `JSON` | 可空 | 员工实际签收的工资条展示快照 |
| `evidence_content_sha256` | `CHAR(64)` | 可空，索引 | 工资条快照摘要 |
| `evidence_created_at` | `DATETIME` | 可空 | 快照生成时间 |

已签收、拒签或已撤回的历史工资条保持为空，不自动伪造或回填。新发布工资条在复核发放时生成证据快照。上线当时仍处于“已发布、待签收”的工资条由独立受控命令生成一次快照和处理报告；该生产命令需单独确认，不能在数据库迁移中静默执行。

## 6. 一次性签收挑战

新增表 `salary_sign_challenge`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | `BIGINT` | 主键，自增 |
| `company_id` | `BIGINT` | 非空 |
| `salary_detail_id` | `BIGINT` | 非空 |
| `employee_id` | `BIGINT` | 非空 |
| `user_id` | `BIGINT` | 非空 |
| `challenge_hash` | `CHAR(64)` | 非空，HMAC-SHA256，不保存原始挑战凭证 |
| `status` | `TINYINT` | 非空，默认 1；1有效、0作废 |
| `expires_at` | `DATETIME` | 非空，5 分钟失效 |
| `consumed_at` | `DATETIME` | 可空，签名成功后立即消费 |
| `created_at` | `DATETIME` | 非空，默认当前时间 |
| `updated_at` | `DATETIME` | 非空，自动更新 |

索引：

- 主键 `PRIMARY KEY (id)`；
- `KEY idx_payslip_employee_time (company_id, salary_detail_id, employee_id, created_at)`；
- `KEY idx_expire (expires_at, consumed_at)`。

挑战规则：

- 使用 `crypto.randomBytes(32)` 生成至少 256 位随机凭证，以 Base64URL 返回一次；
- 数据库只保存 `HMAC-SHA256(payslip-sign-challenge|companyId|payslipId|employeeId|userId|challengeToken)`，使用固定域前缀避免与证据日志摘要混用；
- 只能用于当前企业、工资条、员工和登录账号；
- 5 分钟有效，同一账号和工资条同时只保留一个有效挑战；
- 挑战与签名在同一事务中校验并消费；正确挑战仅在签名保存成功时提交消费状态，签名事务失败时消费状态回滚；
- 错误挑战立即在同一事务中作废；调用方必须正常提交该作废事务但不保存签名，事务结束后删除本次上传的 PNG，再向客户端返回统一挑战错误，员工可以重新申请；
- 原始挑战凭证不得进入数据库、日志、错误响应或小程序本地存储；
- 挑战用于防止签收请求重放，不属于短信实名验证、双因素认证或第三方身份认证。

`salary_signature` 新增 `challenge_id BIGINT DEFAULT NULL` 和普通索引。新声明版本 `2.0` 的有效签名必须绑定已消费的一次性挑战；历史 `1.0` 签名保持空值，不回填。

## 7. 链式证据日志

现有 `salary_receipt_log` 新增字段：

| 字段 | 类型 | 约束 | 用途 |
|---|---|---|---|
| `previous_evidence_hash` | `CHAR(64)` | 可空 | 当前工资条上一条日志摘要 |
| `payslip_content_sha256` | `CHAR(64)` | 可空 | 当前日志绑定的工资条内容摘要 |
| `signature_sha256` | `CHAR(64)` | 可空 | ACCEPT 时绑定签名摘要 |
| `challenge_id` | `BIGINT` | 可空 | ACCEPT 时绑定一次性挑战记录 |
| `statement_version` | `VARCHAR(20)` | 可空 | ACCEPT 时绑定声明版本 |
| `evidence_key_version` | `VARCHAR(20)` | 可空 | HMAC 密钥版本，首版 `v1` |

新增独立环境变量 `PAYSLIP_EVIDENCE_HMAC_SECRET`，至少 32 字节，不继续复用 JWT 密钥。链式摘要：

```text
HMAC-SHA256(
  companyId | payslipId | employeeId | userId |
  actionType | resultStatus | eventAt |
  contentSha256 | signatureSha256 | challengeId |
  statementVersion | previousEvidenceHash | keyVersion
)
```

每次写日志时使用 `SELECT ... FOR UPDATE` 锁定当前工资条最后一条日志，避免并发产生两个链头。系统不提供修改或删除证据日志的业务接口。验证脚本从第一条日志重新计算到链头，缺失、改写或乱序均报告失败。

锁定查询使用 `(company_id, salary_detail_id, employee_id, id)` 复合索引。旧版日志的 HMAC 曾包含 JavaScript 毫秒，但 `created_at DATETIME` 只保留到秒；只读验证器对旧版日志在该秒内尝试 `000` 至 `999` 毫秒恢复原哈希，不修改数据库。空日志集报告“无证据”，不能作为有效证据链通过。

## 8. 电子签收回执

新增表 `salary_evidence_receipt`：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | `BIGINT` | 主键，自增 |
| `company_id` | `BIGINT` | 非空 |
| `salary_detail_id` | `BIGINT` | 非空 |
| `employee_id` | `BIGINT` | 非空 |
| `signature_id` | `BIGINT` | 非空 |
| `challenge_id` | `BIGINT` | 非空 |
| `receipt_no` | `VARCHAR(50)` | 非空，唯一 |
| `statement_version` | `VARCHAR(20)` | 非空 |
| `payslip_content_sha256` | `CHAR(64)` | 非空 |
| `signature_sha256` | `CHAR(64)` | 非空 |
| `evidence_chain_head` | `CHAR(64)` | 非空 |
| `receipt_payload` | `JSON` | 非空，固定回执数据 |
| `storage_path` | `VARCHAR(500)` | 非空，相对私有路径 |
| `receipt_sha256` | `CHAR(64)` | 非空 |
| `generated_at` | `DATETIME` | 非空 |
| `status` | `TINYINT` | 非空，默认 1；1有效、0作废 |
| `created_by` | `BIGINT` | 非空，签收员工账号 ID |
| `created_at` | `DATETIME` | 非空，默认当前时间 |
| `updated_at` | `DATETIME` | 非空，自动更新 |

索引：

- 主键 `PRIMARY KEY (id)`；
- `UNIQUE KEY uk_salary_evidence_receipt_detail (company_id, salary_detail_id)`；
- `UNIQUE KEY uk_salary_evidence_receipt_no (receipt_no)`；
- `KEY idx_employee_time (company_id, employee_id, generated_at)`。

PDF 回执包含：

- 企业名称、工资月份、项目、员工姓名；
- 工资条完整展示项目；
- 手写签名图片；
- 签收声明和声明版本；
- 签收时间、回执编号；
- 签收账号标识和挑战记录 ID；
- 工资条内容摘要、签名摘要和证据链头；
- “本回执证明工资条送达和签收，不单独证明银行款项已实际到账”的提示。

PDF 使用现有 Noto Sans SC 字体，不从网络加载字体。文件保存到企业隔离的私有附件目录，权限 `0600`，只能通过鉴权接口下载。PDF 生成后计算 `receipt_sha256` 并写入数据库；下载接口通过响应头 `X-Receipt-SHA256` 返回该值，避免在 PDF 正文中形成“文件包含自身摘要”的循环依赖。

## 9. 签收声明

声明版本升级为 `2.0`，页面不再使用“金额无误”或“全部正确”表述：

> 本人确认已查看并收到本期工资条。本次签收仅证明工资条已送达本人，不代表本人放弃对工资计算、考勤、扣款及实际支付情况提出异议的权利。本人同意使用当前登录账号和本次手写签名完成电子签收。

员工必须主动勾选，不默认勾选。签收后仍保留“工资有异议”入口。

## 10. API

### 10.1 申请一次性签收挑战

`POST /api/me/payslips/:id/sign-challenge`

权限：员工账号本人；使用登录限流和敏感操作限流。

请求：

```json
{}
```

成功响应：

```json
{
  "code": 0,
  "data": {
    "challengeId": 1201,
    "challengeToken": "一次性Base64URL随机凭证",
    "expiresIn": 300
  }
}
```

失败响应示例：

```json
{ "code": 409, "message": "工资条当前状态不能签收，请刷新后重试" }
```

业务校验：工资条属于本人、已发布、待签收、无开放异议并存在有效证据快照。成功响应中的 `challengeToken` 只返回一次，不进入日志或持久化客户端存储。

### 10.2 上传签名并消费挑战

`POST /api/me/payslips/:id/signature`

请求类型：`multipart/form-data`

字段：

```text
signature=<PNG文件>
signedName=张三
statementVersion=2.0
challengeId=1201
challengeToken=<一次性随机凭证>
```

成功响应：

```json
{
  "code": 0,
  "data": {
    "signatureId": 801,
    "signedName": "张三",
    "signedAt": "2026-11-12T10:00:00.000Z"
  }
}
```

`consumeChallenge(...)` 返回联合结果：成功为 `{ consumed: true, id, consumedAt }`，错误凭证为 `{ consumed: false, reason: 'INVALID_CHALLENGE' }`。错误凭证不直接抛错，以便调用方提交挑战作废状态；调用方不得插入签名，事务外删除本次 PNG 后再返回统一挑战错误。过期、已消费、归属不符等不存在可作废目标的情形仍直接返回统一挑战错误。挑战、身份、工资条摘要或签名校验失败时均不保存签名，也不回显原始挑战凭证。

### 10.3 确认签收

沿用 `POST /api/me/payslips/:id/receipt`。

请求：

```json
{
  "action": "accept",
  "confirmed": true,
  "signatureId": 801
}
```

成功响应增加回执信息：

```json
{
  "code": 0,
  "data": {
    "payslipId": 901,
    "receiptStatus": 2,
    "receiptStatusName": "已签收",
    "receiptNo": "PSR-20261112-0000000901",
    "receiptUrl": "/api/me/payslips/901/evidence-receipt"
  }
}
```

签收事务必须核对：签名属于本人和当前工资条、挑战已消费且与签名绑定、内容摘要未变化、声明版本为 `2.0`、工资条仍为待签收。

### 10.4 下载回执

- 员工：`GET /api/me/payslips/:id/evidence-receipt`
- 管理端：`GET /api/payroll/payslips/:id/evidence-receipt`

员工只能下载本人回执；管理端要求 `payroll:view` 并继续应用员工、项目和客户数据范围。响应为 `application/pdf`，文件名不包含完整身份证号、手机号或银行卡号。

## 11. 微信小程序流程

签名页改为：

1. 完整展示本次工资条摘要和签收声明；
2. 员工规范手写姓名；
3. 主动勾选签收声明；
4. 小程序自动申请一次性签收挑战；
5. 上传签名并验证、消费挑战；
6. 确认签收；
7. 展示“签收成功”，提供“查看电子回执”和“工资有异议”。

挑战过期、挑战失效、网络失败和回执生成失败分别显示准确提示。挑战失效时自动重新申请；签名已经安全保存但最终签收失败时，页面允许在有效证据状态下重试，不重复生成新签名。

## 12. 安全与隐私

- 所有 SQL 使用命名参数；
- 原始挑战凭证和 HMAC 密钥不落库、不进入日志；
- 工资条快照和回执属于敏感薪酬数据，沿用企业和员工数据隔离；
- 文件下载不暴露真实存储路径；
- 回执、签名和日志不进入通用审计详情正文；
- HMAC 密钥与 JWT 密钥分离，支持 `evidence_key_version` 轮换；
- 已签证据不允许通过普通删除接口清理；
- 数据库、签名、回执和证据密钥备份分别验证；
- 工资支付记录至少保存两年，实际保留期限由企业档案和隐私制度确定；
- 历史数据不伪造挑战、摘要或回执。

## 13. 错误与恢复

- 挑战申请失败：不创建可使用的挑战状态，允许重新请求；
- 挑战错误或过期：当前挑战作废，员工重新申请；
- 签名文件写入成功但数据库失败：删除本次新文件；
- 数据库成功但 PDF 文件写入失败：整个签收事务失败，保留待签收状态并清理临时文件；
- 重复提交：已成功签收时返回同一回执，不重复生成挑战、签名或回执；
- 摘要不一致：阻止签收并记录安全告警，不自动覆盖摘要；
- 验证脚本发现断链：报告工资条、日志区间和错误类型，不输出工资金额或个人敏感信息。

## 14. 迁移与兼容

新增迁移：`sql/migrate-payslip-evidence-chain-20261112.mysql.sql`。

迁移要求：

- 只新增字段、表和索引；
- `ALTER TABLE` 前查询 `information_schema`；
- 禁止 `DELETE`、`DROP`、`TRUNCATE`；
- 可重复执行；
- 已完成的历史工资条、签名和签收日志保持原样；
- 新功能只对具备 `evidence_content_sha256` 的新发布工资条启用；
- 上线时仍待签收的工资条使用独立命令生成一次快照，不由迁移自动改写；
- 旧小程序访问新工资条时，后端明确返回“请更新小程序后签收”，不能绕过一次性挑战。

生产部署脚本和发布包验证脚本必须纳入新迁移及安全检查，但生产迁移仍需单独确认。

## 15. 测试与验收

### 15.1 单元与契约测试

- 确定性快照相同输入始终产生相同 SHA-256；
- 展示项目顺序、金额格式变化能被摘要检测；
- 挑战绑定企业、工资条、员工、账号，不能跨工资条复用；
- 挑战过期、错误、重复使用均失败；
- 日志链可从第一条重新计算到链头；
- 修改、删除或乱序任一日志后验证失败；
- 签名摘要、工资条摘要、挑战记录和声明版本全部进入 ACCEPT 证据；
- PDF 回执摘要可复算，内容包括工资条、签名、声明和回执编号；
- 员工不能下载他人回执；
- 管理端继续执行工资权限和数据范围；
- 签收后仍能提交工资异议；
- 日志和错误响应不泄露原始挑战凭证、完整手机号、身份证号或工资内容。

### 15.2 TDD 与完整验证

每个阶段先写失败测试并确认按预期失败，再实现最小代码使其通过。最终执行：

```bash
npm run check
npm audit --audit-level=high
git diff --check
node scripts/check-miniprogram-contracts.js
bash -n scripts/build-release-package.sh scripts/verify-release-package.sh scripts/deploy-production.sh
```

### 15.3 完成标准

- 新工资条没有证据快照时不能发起签收；
- 未通过当前工资条一次性挑战不能保存有效签名；
- 已签收工资条能够下载并验证同一份 PDF 回执；
- 修改工资条、签名、回执或日志任一层均能被验证工具发现；
- 员工签收声明明确保留异议权；
- 历史数据、工资计算和现有异议流程不受破坏；
- 本地修改、测试、提交、推送、生产迁移、Web/API 部署和小程序上传分别汇报。

## 16. 生产配置事项

正式上线前生成独立的证据 HMAC 密钥：

```text
PAYSLIP_EVIDENCE_HMAC_SECRET=
```

生产值至少 32 字节，不与 `JWT_SECRET` 或其他业务密钥复用，不进入源码、发布包或日志。该方案不需要新增短信模板或短信费用。
