# 常州劳务用工风险预警系统开发文档（V1.0）

> 产品名称：常州劳务用工风险预警系统  
> 产品定位：面向常州地区依法认证的人力资源服务机构和用工企业，提供跨机构共享的人员用工风险申报、证据审核、授权查询、异议申诉与到期治理。所有认证通过且状态正常的入驻公司，均可查询平台审核通过的有效风险记录。  
> 重要原则：产品内部不使用“永久黑名单”作为业务结论。所有记录必须有事实分类、证据来源、审核状态、有效期限和申诉渠道，不展示侮辱性标签，不允许仅凭主观评价限制劳动者就业。

## 1. 需求概述

### 1.1 建设目标

1. 降低劳务机构重复招聘、身份冒用、重大违纪、安全事故和合同履约风险。
2. 建立“机构实名认证—风险申报—证据校验—平台审核—授权查询—申诉复核—到期归档”的完整闭环。
3. 同时提供电脑网页端和手机端，数据、账号、权限、审核结果保持一致。
4. 对敏感个人信息进行最小化收集、加密存储、脱敏展示和全量访问审计。
5. 建立“认证企业全平台共享查询”机制，避免员工风险只停留在单一劳务公司内部。

### 1.2 产品边界

- 平台提供风险信息管理与核验线索，不替代公安、法院、仲裁等机关作出法律结论。
- 未审核、证据不足、已撤销或已过期记录，不得作为“命中结果”对外展示。
- 查询必须基于明确的招聘、入职审核或在职管理场景，并取得合法授权或具备其他合法处理依据。
- 首期不开放个人信息公网搜索，不允许按姓名进行模糊批量检索，不提供名单下载和数据交易。
- 所有认证通过且状态正常的公司共享查询范围一致；公司规模、付费等级和申报数量不得影响基础查询结果。
- “共享查询”是指查询审核通过的风险摘要，不代表共享申报公司的原始证据、内部备注、员工联系方式或身份证明文。

## 2. 用户角色

| 角色 | 主要职责 | 数据范围 |
|---|---|---|
| 游客 | 查看平台说明、注册、认证指引 | 公共信息 |
| 机构超级管理员 | 注册机构、提交认证、管理成员与查询额度 | 本机构全部数据 |
| 机构申报员 | 新增风险申报、上传证据、回复补正 | 本机构申报数据 |
| 机构查询员 | 查询全平台审核通过的有效风险记录、查看本机构查询历史 | 全平台有效风险摘要 |
| 机构审核员 | 机构内部初审、撤回错误申报 | 本机构待提交记录 |
| 平台审核员 | 认证审核、风险审核、要求补证、复核申诉 | 被分配审核任务 |
| 平台合规管理员 | 规则配置、敏感访问审计、投诉处置 | 平台合规范围 |
| 员工/劳动者 | 身份核验、查看本人记录、发起异议、提交证据 | 本人数据 |

## 3. 功能模块拆解

### 3.1 机构注册与认证

- 手机号验证码注册、密码登录、双因素认证可选。
- 填写机构名称、统一社会信用代码、法定代表人、联系人、办公地址。
- 上传营业执照；劳务派遣业务需上传劳务派遣经营许可证及有效期。
- 对公打款、法人核验或人工审核三选一作为增强认证方式。
- 认证状态：`DRAFT` 草稿、`PENDING` 待审核、`SUPPLEMENT` 待补正、`APPROVED` 已认证、`REJECTED` 已驳回、`SUSPENDED` 已停用、`EXPIRED` 已过期。
- 认证通过后才能查询和提交风险记录；证照到期前 30 天提醒。

### 3.2 成员、角色和机构隔离

- 超级管理员邀请成员，分配申报、查询、审核、财务等角色。
- 所有业务表必须包含 `tenant_id`，接口按机构强制隔离。
- 高敏操作需要二次验证：查看完整证件号、下载证据、导出审计记录。
- 离职成员立即禁用 Token 并回收权限。

### 3.3 员工风险申报

申报分四步：

1. 员工身份：姓名、证件类型、证件号码、手机号；系统先查重，不展示他人原始档案。
2. 风险事实：发生时间、项目、风险分类、事实经过、损失或影响、已采取措施。
3. 证据链：劳动合同、考勤、通知送达、签收、报警回执、调解/仲裁/法院文书等。
4. 合规确认：申报人承诺真实性，确认已履行告知义务或填写无法告知的合法理由。

风险分类建议：

| 一级分类 | 二级分类示例 | 默认等级 | 审核要求 |
|---|---|---:|---|
| 身份与资料风险 | 冒用身份、证件疑似伪造、重复身份 | 高 | 身份核验材料或权威凭证 |
| 安全生产风险 | 严重违反安全规程、造成重大事故 | 高 | 制度、培训、现场记录、调查材料 |
| 履约风险 | 无故失联、恶意旷工、拒不办理交接 | 中 | 合同、考勤、联系及送达记录 |
| 财产风险 | 经有权机关确认的侵占、盗窃或故意损坏 | 高 | 报警/裁判文书等，不得仅凭内部指控 |
| 欺诈风险 | 虚假入职材料、骗取费用或待遇 | 高 | 可验证的原件、系统记录或机关文书 |
| 争议观察 | 劳动争议处理中、事实尚未认定 | 观察 | 仅本机构可见，不对外形成命中 |

禁止作为风险原因：依法维权、申请仲裁、投诉欠薪、拒绝违法指令、怀孕生育、疾病残障、民族宗教、工会活动等受保护事项。

### 3.4 证据链管理

- 支持 PDF、JPG、PNG、MP4、音频；单文件大小、格式和病毒扫描可配置。
- 每份证据保存 SHA-256、上传人、上传时间、来源、形成时间、证明事项、版本号。
- 文件存对象存储私有桶，通过短时签名 URL 查看，严禁直接公网访问。
- 原证据不可覆盖；补充材料生成新版本。下载、预览、删除申请均记录审计日志。
- 证据类型：合同协议、规章制度及培训签收、考勤门禁、沟通送达、现场影像、财务损失、行政司法文书、本人陈述、其他。

### 3.5 平台审核

- 机器预检：身份证格式、重复申报、证照有效性、必填证据、敏感词和文件安全。
- 人工审核：事实是否具体、规则是否有效且已告知、证据是否闭环、风险等级是否合理。
- 状态：`DRAFT` → `ORG_REVIEW` → `PLATFORM_REVIEW` → `SUPPLEMENT` / `APPROVED` / `REJECTED` → `APPEALED` → `REVOKED` / `EXPIRED` / `ARCHIVED`。
- 高风险记录建议双人复核；审核员不得审核自己所属机构提交的数据。
- 审核通过时设置生效日和失效日。建议中风险 6 个月、高风险 12 个月；司法文书类根据有效状态单独配置。

### 3.6 风险查询入口

- 网页首页和手机首页均设置“用工风险核验”入口。
- 所有注册并认证通过、未被暂停或过期的公司，均可查询全平台共享库；无需得到原申报公司的再次批准。
- 查询条件必须精确匹配：姓名 + 身份证号；可增加本人短信验证码或授权凭证。
- 查询前填写用途、项目/岗位、授权依据并勾选合规承诺。
- 返回结果只展示：是否存在有效风险、风险类别、等级、发生区间、审核日期、有效期限、发布机构认证标识和申诉状态。
- 默认不展示身份证明文、联系方式、原始证据和无关详细描述。
- 命中多家公司的有效申报时，按风险事件分别展示并标记“多机构独立申报”，不得简单累加为更高风险等级；平台应检查重复事件和串联恶意申报。
- 若无命中，显示“截至查询时间，未发现平台内有效风险记录”，不得表述为“该人员绝对无风险”。
- 防爬控制：验证码、IP/账号限流、设备指纹、异常批量查询拦截、查询额度和审计告警。

#### 3.6.1 全平台共享规则

| 数据内容 | 认证公司是否可查询 | 展示规则 |
|---|---:|---|
| 审核通过且有效的风险记录 | 是 | 展示风险分类、等级、时间区间、有效期、申报机构认证标识 |
| 多机构独立申报数量 | 是 | 显示经平台去重后的机构数量，不展示无关机构内部信息 |
| 申诉/复核状态 | 是 | 显示无申诉、复核中、已修正或已撤销 |
| 员工完整身份证、手机号、住址 | 否 | 只用于精确匹配，页面脱敏 |
| 原始证据文件 | 否 | 仅申报机构和平台审核人员可见；特殊核验需单独申请 |
| 未审核、补证中、被驳回记录 | 否 | 不进入共享查询结果 |
| 已撤销、已过期记录 | 否 | 不再对认证公司展示，依法保留后台审计归档 |
| 观察类或事实未认定记录 | 否 | 仅申报机构和平台合规审核使用 |

共享库统一命中条件：

```text
机构认证状态 = APPROVED
AND 机构账号状态 = ACTIVE
AND 查询用途已填写
AND 查询身份精确匹配
AND 风险记录状态 = APPROVED
AND effective_at <= 当前时间
AND expires_at > 当前时间
AND 记录未撤销
```

### 3.7 员工本人中心与申诉

- 本人通过实名核验进入“我的风险记录”。
- 可以查看记录摘要、处理依据、有效期和证据目录，不默认暴露第三方隐私。
- 申诉类型：身份错误、事实错误、证据失实、已经履行/和解、期限届满、违法歧视、其他。
- 平台受理后暂停新增查询展示或标记“争议复核中”，由独立审核员复核。
- 申报机构在规定期限内答辩；逾期未答辩可暂停记录。
- 复核结果：维持、降级、修正、撤销；结果通知双方并保留处理轨迹。

### 3.8 运营与合规后台

- 机构认证审核、风险工单、申诉工单、举报投诉、规则配置。
- 数据看板：认证机构数、申报数、通过率、补证率、查询量、命中率、申诉率、撤销率、超时任务。
- 审计中心：谁在何时、以何用途查询了谁；敏感文件访问和异常账号告警。
- 生命周期任务：证照到期、记录到期、申诉超时、证据保留期到期提醒与归档。

## 4. 核心数据结构（MySQL 8）

### 4.1 关键表清单

| 表名 | 用途 |
|---|---|
| `tenants` | 人力资源机构/用工企业租户 |
| `tenant_certifications` | 企业认证及证照 |
| `users`、`roles`、`user_roles` | 账号与角色权限 |
| `persons` | 员工主体，敏感字段加密存储 |
| `risk_reports` | 风险申报主表 |
| `risk_evidences` | 证据文件及哈希链 |
| `risk_reviews` | 审核与复核记录 |
| `query_authorizations` | 查询用途和授权凭证 |
| `risk_queries`、`risk_query_hits` | 跨机构共享查询及命中快照 |
| `appeals`、`appeal_materials` | 员工异议申诉 |
| `notifications` | 站内信/短信通知 |
| `audit_logs` | 不可篡改审计日志 |

### 4.2 核心表字段

```sql
CREATE TABLE persons (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name_ciphertext VARBINARY(512) NOT NULL COMMENT '姓名密文',
  name_hash CHAR(64) NOT NULL COMMENT '姓名标准化摘要',
  id_type VARCHAR(20) NOT NULL DEFAULT 'CN_ID',
  id_no_ciphertext VARBINARY(512) NOT NULL COMMENT '证件号密文',
  id_no_hash CHAR(64) NOT NULL COMMENT '证件号HMAC摘要，用于精确匹配',
  mobile_ciphertext VARBINARY(512) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uk_person_identity (id_type, id_no_hash),
  KEY idx_person_name_hash (name_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE risk_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  report_no VARCHAR(32) NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  person_id BIGINT UNSIGNED NOT NULL,
  category_code VARCHAR(50) NOT NULL,
  reason_code VARCHAR(50) NOT NULL,
  risk_level ENUM('OBSERVE','LOW','MEDIUM','HIGH') NOT NULL,
  occurred_at DATETIME NOT NULL,
  project_name VARCHAR(100) NULL,
  fact_summary VARCHAR(1000) NOT NULL,
  impact_description VARCHAR(1000) NULL,
  handling_action VARCHAR(1000) NULL,
  notification_status ENUM('NOTIFIED','UNABLE_WITH_REASON','NOT_REQUIRED') NOT NULL,
  notification_note VARCHAR(500) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  effective_at DATETIME NULL,
  expires_at DATETIME NULL,
  current_review_version INT NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_report_no (report_no),
  KEY idx_report_tenant_status (tenant_id, status),
  KEY idx_report_person_status (person_id, status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE risk_evidences (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  risk_report_id BIGINT UNSIGNED NOT NULL,
  evidence_type VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  proof_purpose VARCHAR(500) NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  occurred_at DATETIME NULL,
  storage_key VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  version_no INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_evidence_report (risk_report_id, status),
  KEY idx_evidence_hash (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE risk_queries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  query_no VARCHAR(32) NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  person_id BIGINT UNSIGNED NOT NULL,
  purpose_code VARCHAR(40) NOT NULL,
  project_name VARCHAR(100) NULL,
  authorization_id BIGINT UNSIGNED NOT NULL,
  result ENUM('NO_ACTIVE_RECORD','ACTIVE_RECORD_FOUND','UNDER_REVIEW') NOT NULL,
  hit_count INT UNSIGNED NOT NULL DEFAULT 0,
  client_ip VARCHAR(64) NULL,
  device_id VARCHAR(128) NULL,
  queried_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_query_no (query_no),
  KEY idx_query_tenant_time (tenant_id, queried_at),
  KEY idx_query_person_time (person_id, queried_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE risk_query_hits (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  risk_query_id BIGINT UNSIGNED NOT NULL,
  risk_report_id BIGINT UNSIGNED NOT NULL,
  source_tenant_id BIGINT UNSIGNED NOT NULL COMMENT '原申报机构',
  query_tenant_id BIGINT UNSIGNED NOT NULL COMMENT '执行查询的认证机构',
  risk_level VARCHAR(20) NOT NULL,
  appeal_status VARCHAR(30) NOT NULL DEFAULT 'NONE',
  snapshot_json JSON NOT NULL COMMENT '查询时的最小化结果快照',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_query_hit_query (risk_query_id),
  KEY idx_query_hit_report (risk_report_id),
  KEY idx_query_hit_tenants (query_tenant_id, source_tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE appeals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  appeal_no VARCHAR(32) NOT NULL,
  risk_report_id BIGINT UNSIGNED NOT NULL,
  person_id BIGINT UNSIGNED NOT NULL,
  appeal_type VARCHAR(40) NOT NULL,
  statement VARCHAR(2000) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  assignee_id BIGINT UNSIGNED NULL,
  resolution ENUM('UPHOLD','DOWNGRADE','CORRECT','REVOKE') NULL,
  resolution_note VARCHAR(2000) NULL,
  resolved_at DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_appeal_no (appeal_no),
  KEY idx_appeal_report_status (risk_report_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

实现时所有外键关系由迁移脚本补齐；高并发日志表按月分区。身份证摘要建议使用服务端密钥参与的 HMAC-SHA-256，不能使用裸 SHA-256，避免撞库反查。

## 5. 页面结构

### 5.1 网页端（Vue 管理后台）

| 一级页面 | 二级页面/功能 |
|---|---|
| 登录注册 | 机构注册、登录、找回密码、二次验证 |
| 机构认证 | 基本信息、证照上传、认证进度、补正记录 |
| 工作台 | 待审核、待补证、即将到期、查询量、申诉提醒 |
| 风险申报 | 新建四步表单、草稿、机构初审、已提交、已生效、已归档 |
| 风险详情 | 员工脱敏信息、事实时间线、证据目录、审核轨迹、撤回/补证 |
| 风险查询 | 精确查询、授权上传/验证码、结果页、历史查询 |
| 申诉中心 | 待答辩、复核中、处理结果 |
| 成员权限 | 成员、角色、数据范围、登录设备 |
| 合规审计 | 查询日志、证据访问日志、异常告警 |
| 平台后台 | 机构审核、风险审核、申诉复核、规则和期限配置、运营看板 |

### 5.2 手机端（优先微信小程序，可兼容 H5）

底部导航：`首页`、`查询`、`申报`、`待办`、`我的`。

- 首页：认证状态、快捷查询、快捷申报、待办卡片、合规提醒。
- 查询：扫码授权/短信授权、姓名身份证输入、用途确认、结果展示。
- 申报：步骤式表单；调用相机拍照、相册/文件上传；支持草稿续填。
- 待办：认证补正、风险补证、申诉答辩、到期记录。
- 我的：机构资料、成员切换、查询记录、安全设置、客服投诉。
- 劳动者入口：本人实名核验、我的记录、提交申诉、处理进度。

手机端只展示完成任务所需字段；证据批量整理、复杂审核和统计导出放在网页端。

## 6. 核心业务流程

### 6.1 机构入驻

`注册账号 → 创建机构 → 上传执照/许可证 → 法人或对公核验 → 平台审核 → 认证通过 → 邀请成员 → 分配角色`

### 6.2 风险申报与生效

`精确录入员工 → 查重提示 → 填写事实 → 上传证据 → 机构初审 → 告知员工 → 平台预检 → 人工审核 → 补证/驳回/通过 → 设置有效期 → 可授权查询`

### 6.3 查询闭环

`认证公司登录 → 选择招聘/入职用途 → 填写合法处理依据/获取授权 → 姓名+证件号精确匹配 → 检索全平台共享库 → 返回所有有效命中的最小化结果 → 记录查询快照 → 必要时申请平台进一步核验`

### 6.4 申诉闭环

`本人实名 → 选择记录 → 提交异议及材料 → 平台受理 → 记录标记复核中 → 申报机构答辩 → 独立复核 → 维持/降级/修正/撤销 → 双方通知 → 留痕归档`

## 7. REST API 设计

### 7.1 核心接口

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | `/api/v1/auth/register` | 注册机构管理员 | 公开+验证码 |
| POST | `/api/v1/tenant-certifications` | 提交企业认证 | 机构管理员 |
| GET | `/api/v1/tenant-certifications/current` | 查询认证进度 | 本机构成员 |
| POST | `/api/v1/risk-reports` | 创建风险草稿 | 申报员 |
| PUT | `/api/v1/risk-reports/:id` | 编辑未提交/补正记录 | 申报员 |
| POST | `/api/v1/risk-reports/:id/evidences` | 上传证据 | 申报员 |
| POST | `/api/v1/risk-reports/:id/submit` | 提交机构/平台审核 | 机构审核员 |
| POST | `/api/v1/platform/risk-reviews/:id/decision` | 审核决定 | 平台审核员 |
| POST | `/api/v1/query-authorizations` | 创建查询授权 | 查询员 |
| POST | `/api/v1/risk-queries` | 执行精确查询 | 已认证查询员 |
| GET | `/api/v1/risk-queries/:id` | 查看查询结果快照 | 查询发起人/管理员 |
| POST | `/api/v1/me/identity-verifications` | 劳动者实名核验 | 本人 |
| GET | `/api/v1/me/risk-reports` | 查看本人风险记录 | 已实名本人 |
| POST | `/api/v1/me/risk-reports/:id/appeals` | 提交申诉 | 已实名本人 |
| POST | `/api/v1/platform/appeals/:id/decision` | 申诉复核决定 | 独立复核员 |
| GET | `/api/v1/audit-logs` | 查询审计日志 | 合规管理员 |

### 7.2 创建风险申报示例

请求：

```http
POST /api/v1/risk-reports
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: 8d2f...ef1
```

```json
{
  "person": {
    "name": "张某某",
    "idType": "CN_ID",
    "idNo": "3204**********1234",
    "mobile": "138********"
  },
  "categoryCode": "CONTRACT_PERFORMANCE",
  "reasonCode": "UNEXPLAINED_ABSENCE",
  "occurredAt": "2026-08-01T08:00:00+08:00",
  "projectName": "常州某制造项目",
  "factSummary": "连续缺勤并经三种已登记方式联系，尚未完成离职交接。",
  "impactDescription": "造成排班缺口，未填写未经确认的违法或犯罪结论。",
  "notificationStatus": "NOTIFIED"
}
```

成功响应：

```json
{
  "code": "OK",
  "data": {
    "id": "98231",
    "reportNo": "CZRW202608120001",
    "status": "DRAFT",
    "requiredEvidenceTypes": ["ATTENDANCE", "CONTACT_DELIVERY", "RULE_ACKNOWLEDGEMENT"]
  }
}
```

失败响应：

```json
{
  "code": "CERTIFICATION_REQUIRED",
  "message": "机构认证通过后才能提交风险记录",
  "requestId": "req_01J..."
}
```

### 7.3 执行风险查询示例

```json
{
  "name": "张某某",
  "idType": "CN_ID",
  "idNo": "3204**********1234",
  "purposeCode": "PRE_EMPLOYMENT_CHECK",
  "projectName": "常州某制造项目",
  "authorizationId": "A202608120009"
}
```

命中响应：

```json
{
  "code": "OK",
  "data": {
    "queryNo": "Q202608120103",
    "result": "ACTIVE_RECORD_FOUND",
    "sharingScope": "ALL_VERIFIED_TENANTS",
    "matchedTenantCount": 2,
    "records": [
      {
        "categoryName": "履约风险",
        "riskLevel": "MEDIUM",
        "occurredMonth": "2026-08",
        "reviewedAt": "2026-08-10T15:30:00+08:00",
        "expiresAt": "2027-02-10T23:59:59+08:00",
        "appealStatus": "NONE",
        "sourceTenant": {
          "displayName": "常州某认证人力资源公司",
          "verified": true
        },
        "detailAccess": "APPLY_REQUIRED"
      }
    ],
    "notice": "结果仅用于本次授权的招聘或用工管理场景，不得转发或另作他用。"
  }
}
```

## 8. 权限与风控逻辑

### 8.1 核心权限

- `tenant.certification.manage`
- `member.manage`
- `risk_report.create/edit/submit/withdraw`
- `risk_evidence.upload/view/download`
- `risk_query.execute/view_history`
- `appeal.reply`
- `platform.certification.review`
- `platform.risk.review`
- `platform.appeal.review`
- `audit.view/export`

### 8.2 强制业务校验

1. 机构未认证、被暂停或证照过期时，禁止新查询和新申报。
2. 风险申报必须至少包含事实时间、原因代码和相应证据；自由文本不能代替分类。
3. 只有 `APPROVED` 且未过期、未撤销的记录参与对外命中。
4. `OBSERVE`、争议处理中和证据不足记录仅限有权审核人员查看。
5. 同一人员、同一事件的重复申报进行合并提示，不自动叠加风险等级。
6. 查询授权一事一用，设有效期；到期后不可复用。
7. 任何查询、详情查看、证据预览与下载写入审计日志，审计日志禁止普通管理员删除。
8. 平台审核员与申诉复核员职责分离；存在利益冲突时必须回避。
9. 任一认证公司提交并经平台审核生效的记录，自动进入全平台共享查询库，不需要逐家公司授权。
10. 查询公司只能看到共享摘要；原始证据下载权限不随共享查询权限自动开放。
11. 公司认证到期、停用或存在违规查询行为时，立即停止其全平台查询权限，但不删除其历史审计记录。

### 8.3 安全设计

- HTTPS、JWT 短 Token + Refresh Token、强密码、可选 MFA。
- 姓名、身份证、手机号字段级加密；精确查询使用 HMAC 摘要。
- 对象存储私有化、短时下载地址、文件病毒扫描、水印和防盗链。
- API 限流、验证码、异常设备识别、SQL 注入/XSS/CSRF 防护。
- 数据库每日备份，备份加密；恢复演练和密钥轮换有独立流程。
- 生产、测试环境隔离；测试数据不得使用真实身份证和真实争议材料。

## 9. 验收标准（MVP）

1. 新机构可以完成注册、认证提交、补正和审核通过。
2. 已认证机构可以创建员工风险草稿，上传至少 3 类证据并提交审核。
3. 平台可以完成补证、驳回、通过和设定有效期。
4. 网页端与手机端均能通过姓名+身份证号+合法授权精确查询。
5. 任意两家认证通过的测试公司均可查询到另一家公司申报且平台审核生效的风险摘要。
6. 查询结果严格过滤未审核、已过期、已撤销和观察记录。
7. 员工可实名查看本人记录并完成一次申诉闭环。
8. 租户之间不能读取对方原始申报和证据，越权接口返回 `403`。
9. 身份证、手机号在列表和日志中脱敏，数据库不存明文。
10. 所有查询、审核、证据访问、申诉决定均能追溯到账号、时间、IP 和用途。
11. 网页端适配 1366px 以上屏幕；手机端适配常见微信屏幕并支持拍照上传。

## 10. 开发阶段与文件规划

### 10.1 推荐技术栈

- 网页端：Vue 3 + Vite + Pinia + Vue Router。
- 手机端：原生微信小程序；后续可用同一 API 扩展 H5。
- 后端：Node.js 20 + Express，按 Controller / Service / Repository 分层。
- 数据库：MySQL 8；Redis 用于验证码、限流和短期会话。
- 文件：腾讯云 COS 或阿里云 OSS 私有桶。

### 10.2 基于现有项目的建议目录

```text
hr-roster-system/
├── docs/changzhou-labor-risk-warning-system-prd.md
├── src/routes/risk-platform.routes.js
├── src/controllers/risk-platform.controller.js
├── src/services/risk-platform.service.js
├── src/services/risk-review.service.js
├── src/services/risk-query.service.js
├── src/services/appeal.service.js
├── src/middleware/tenant-scope.js
├── sql/migrations/xxx_risk_platform.sql
├── public/risk-platform/                 # 网页端构建产物或独立 Vue 工程
└── wechat-miniprogram/miniprogram/pages/
    ├── risk-home/
    ├── risk-query/
    ├── risk-report-form/
    ├── risk-tasks/
    └── risk-appeal/
```

### 10.3 实施顺序

- 第 1 阶段：账号、租户、机构认证、成员权限。
- 第 2 阶段：员工主体、风险申报、证据链、平台审核。
- 第 3 阶段：授权查询、命中最小化展示、审计和限流。
- 第 4 阶段：员工本人中心、申诉复核、到期归档。
- 第 5 阶段：运营看板、异常告警、规则配置和安全测试。

## 11. 上线前必须完成的合规事项

- 由专业法律顾问审核个人信息处理规则、用户协议、隐私政策、申报规则和申诉机制。
- 明确平台运营主体、个人信息处理者责任、数据保存期限、联系电话和投诉渠道。
- 对处理敏感个人信息、跨机构共享和自动化决策开展个人信息保护影响评估并留档。
- 与入驻机构签署数据处理及真实性责任协议，建立恶意申报处罚和机构退出机制。
- 完成等保、渗透测试、数据分类分级和安全事件应急预案等适用工作。
- 未完成合法性评估前，只能使用虚构数据进行原型演示，不得录入真实员工风险材料。

## 12. V1.1 可扩展建议

- 对接企业工商信息与许可证有效性核验。
- 接入可信时间戳或电子存证服务，强化证据形成时间证明。
- 引入风险规则引擎，但算法只做辅助，不自动作出永久限制就业决定。
- 建立跨机构线索关联：仅提示“存在待核验线索”，必须由人工审核后才能生效。
- 提供 API 给通过认证的企业 HR 系统进行单人核验，禁止批量拉取名单。
- 增加数据质量评分、恶意申报识别、申诉撤销率和机构可信度分级。
