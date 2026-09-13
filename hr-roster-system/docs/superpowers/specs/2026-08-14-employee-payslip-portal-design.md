# 员工端登录与工资条签收系统设计

日期：2026-08-14

项目：优益数字化管理系统

适用端：微信小程序、Web 管理后台、Node.js + Express + MySQL 后端

## 1. 需求概述

在现有工资批次、工资条发布和签收接口基础上，增加员工微信登录、员工档案绑定、工资条查询、手写签名、确认签收和工资异议处理能力。

系统继续使用同一个微信小程序，通过双入口区分员工端和管理端：

- 员工端：微信手机号授权或一次性绑定码登录，只能查看本人工资条。
- 管理端：企业管理员、HR 主管、驻厂专员、薪资专员继续使用账号密码登录。

本阶段不开发短信发送，只预留工资发布通知接口和发送状态字段。

### 1.1 建设目标

1. 员工无需记忆系统账号密码，通过微信完成本人身份绑定。
2. 工资条发布后，员工可以查询、手写签名、签收或提交异议。
3. 员工只能访问本人的工资条，企业数据严格隔离。
4. 工资条查看、签名、签收、拒签和异议处理形成完整证据链。
5. 保留现有工资批次、复核、发布逻辑，不改变既有薪资业务功能。

### 1.2 本阶段不实现

- 腾讯云短信实际发送。
- 第三方电子合同或电子签章平台。
- 银行代发接口。
- 员工之间互相查询或代签工资条。
- 离职员工访问管理功能或其他员工数据；离职后仅保留本人已发布工资条的查看、签名、签收和异议权限。

## 2. 用户角色

| 身份 | 登录方式 | 数据范围 | 主要能力 |
| --- | --- | --- | --- |
| 员工 | 微信手机号授权 / 一次性绑定码 | 本人 | 查询工资条、手写签名、签收、提交异议 |
| 薪资专员 | 管理账号密码 | 授权企业或部门 | 导入工资、查看批次、提交复核、发布、催签、处理异议 |
| HR 主管 | 管理账号密码 | 授权企业或部门 | 查看工资批次和签收进度、生成员工绑定码 |
| 驻厂专员 | 管理账号密码 | 授权项目 | 生成本人负责员工的绑定码、查看绑定状态，不查看工资金额 |
| 企业管理员 | 管理账号密码 | 全公司 | 管理权限、查看审计记录、解绑员工微信 |

员工账号不加入现有角色配置页面，不增加第五个可配置管理角色。员工账号固定使用 `account_type=EMPLOYEE` 和本人数据范围。

## 3. 功能模块

### 3.1 双入口登录

- 登录页显示“员工登录”和“管理端登录”。
- 员工登录优先使用微信手机号授权。
- 管理端继续使用账号和密码。
- 登录成功后根据 `accountType` 自动跳转对应工作台。
- 员工 Token 不具备管理端权限。

### 3.2 员工微信绑定

正常路径：

1. 调用 `wx.login` 获取临时登录凭证。
2. 员工授权微信手机号。
3. 后端调用微信接口换取手机号、`openid` 和会话信息。
4. 按 `company_id + phone + employee_status IN (2,3)` 匹配在职或已离职员工档案。
5. 员工输入身份证后六位。
6. 后端解密员工身份证并在服务端完成比对。
7. 创建员工账号和微信绑定关系。

异常路径：

- 手机号未录入、已更换或无法唯一匹配时，使用一次性绑定码。
- 绑定码由企业管理员、HR 主管或负责该员工的驻厂专员生成。
- 绑定码有效期10分钟，最多尝试5次，只能使用一次。
- 使用绑定码时仍需校验员工姓名和身份证后六位。
- 绑定成功后将微信手机号回填员工档案，并写入敏感操作日志。

### 3.3 员工首页

- 显示姓名、客户单位、岗位和在职状态。
- 显示最新工资条月份及签收状态。
- 首页不直接展示工资金额。
- 显示未读消息数量。
- 核心按钮为“查看工资条”。

### 3.4 工资条查询

- 按年份和月份倒序展示已发布工资条。
- 状态包括：待查看、待签字、已签收、有异议。
- 详情展示工资组成、扣款组成、应发和实发。
- 工资条详情只能通过 Token 中的 `employeeId` 查询。
- 每次查看详情均写入证据日志。

### 3.5 手写签名与签收

1. 员工查看完整工资条。
2. 勾选“本人已核对工资条内容”。
3. 在小程序 Canvas 签名板手写姓名。
4. 上传签名 PNG 文件。
5. 后端校验签名文件类型、大小、工资条状态和员工本人权限。
6. 后端计算签名文件 SHA-256。
7. 员工点击“确认签收”。
8. 在一个数据库事务内保存签名记录、更新签收状态并写证据日志。

已签收工资条不能由员工修改。企业重新核算时必须生成新版本，不覆盖旧工资条和旧签名。

### 3.6 工资异议

- 员工可以选择“工资有异议”。
- 异议原因必填，长度10至500字。
- 工资条状态转为“有异议”。
- 薪资专员处理后填写处理说明。
- 需要修改金额时，原工资条归档，创建新版本并重新发布。
- 原工资条、签名、异议和处理记录永久保留。

### 3.7 管理端工资条闭环

现有创建、提交复核、复核通过和发布流程保持不变，后续开发补充：

- Excel 导入预览。
- 行级错误提示。
- 工资批次详情。
- 员工签收状态统计。
- 未绑定微信员工列表。
- 单人催签和批量催签入口。
- 异议处理列表。
- 签收证据导出。

## 4. 数据结构

### 4.1 `sys_user` 增加账号类型

```sql
ALTER TABLE sys_user
  ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT 'MANAGER'
    COMMENT 'MANAGER管理账号 EMPLOYEE员工账号',
  ADD INDEX idx_company_account_type (company_id, account_type, status);
```

员工账号必须设置 `employee_id`，不分配管理角色和管理权限。

### 4.2 微信绑定表 `employee_wechat_binding`

```sql
CREATE TABLE employee_wechat_binding (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  openid VARCHAR(128) NOT NULL,
  unionid VARCHAR(128) DEFAULT NULL,
  phone VARCHAR(20) NOT NULL,
  binding_status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0解绑 2冻结',
  active_employee_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN binding_status=1 THEN employee_id ELSE NULL END
  ) STORED,
  active_openid VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN binding_status=1 THEN openid ELSE NULL END
  ) STORED,
  token_version INT NOT NULL DEFAULT 0,
  bound_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME DEFAULT NULL,
  unbound_at DATETIME DEFAULT NULL,
  unbound_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_employee_active (company_id, active_employee_id),
  UNIQUE KEY uk_company_openid_active (company_id, active_openid),
  INDEX idx_user (company_id, user_id),
  INDEX idx_phone (company_id, phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

生成列唯一索引确保一个员工和一个微信只能存在一条有效绑定，同时允许保留多条已解绑历史。解绑时递增 `sys_user.token_version` 和本表 `token_version`，立即使旧 Token 失效。

### 4.3 一次性绑定码 `employee_bind_code`

```sql
CREATE TABLE employee_bind_code (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  code_salt CHAR(32) NOT NULL,
  expire_at DATETIME NOT NULL,
  failed_attempts TINYINT NOT NULL DEFAULT 0,
  used_at DATETIME DEFAULT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee_active (company_id, employee_id, expire_at, used_at),
  INDEX idx_expire (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

绑定码只返回一次明文，数据库保存随机盐和服务端 HMAC-SHA256 摘要。HMAC 密钥独立配置，不使用数据库内可读取的数据作为密钥。

### 4.4 工资签名表 `salary_signature`

```sql
CREATE TABLE salary_signature (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  salary_detail_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  attachment_id BIGINT NOT NULL,
  signature_sha256 CHAR(64) NOT NULL,
  signed_name VARCHAR(50) NOT NULL,
  statement_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  ip_address VARCHAR(50) DEFAULT NULL,
  device_info VARCHAR(255) DEFAULT NULL,
  signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0作废',
  active_salary_detail_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN status=1 THEN salary_detail_id ELSE NULL END
  ) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_salary_signature_active (company_id, active_salary_detail_id),
  INDEX idx_employee_time (company_id, employee_id, signed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

签名图片复用 `hr_attachment`，`biz_type` 使用 `payslip_signature`。允许格式仅为 PNG，最大1MB，服务器重新解析图片后再保存。

### 4.5 工资异议表 `salary_dispute`

```sql
CREATE TABLE salary_dispute (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  salary_detail_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  dispute_reason VARCHAR(500) NOT NULL,
  handle_status TINYINT NOT NULL DEFAULT 0 COMMENT '0待处理 1处理中 2已解决 3驳回',
  open_salary_detail_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN handle_status IN (0,1) THEN salary_detail_id ELSE NULL END
  ) STORED,
  handler_id BIGINT DEFAULT NULL,
  handle_remark VARCHAR(500) DEFAULT NULL,
  handled_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_open_dispute (company_id, open_salary_detail_id),
  INDEX idx_company_status (company_id, handle_status, created_at),
  INDEX idx_employee (company_id, employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 5. 小程序页面结构

### 5.1 公共登录页

```text
优益数字化管理系统
├── 员工登录
│   ├── 微信手机号快捷登录
│   └── 使用一次性绑定码
└── 管理端登录
    ├── 登录账号
    └── 登录密码
```

### 5.2 员工端底部菜单

```text
首页 | 工资条 | 消息 | 我的
```

### 5.3 员工端页面

- `/pages/employee-login/index`：员工登录和首次绑定。
- `/pages/employee-bind/index`：身份证后六位、绑定码验证。
- `/pages/employee-home/index`：员工首页。
- `/pages/my-payslips/index`：本人工资条列表。
- `/pages/my-payslips/detail/index`：工资条详情。
- `/pages/my-payslips/sign/index`：手写签名。
- `/pages/my-messages/index`：员工消息。
- `/pages/employee-profile/index`：员工个人资料和微信绑定。

管理端原有页面路径保持不变。自定义 TabBar 根据 `accountType` 加载不同菜单配置。

## 6. 核心业务流程

### 6.1 正常手机号绑定

```text
员工选择员工登录
→ wx.login
→ 微信手机号授权
→ 后端匹配在职或已离职员工
→ 输入身份证后六位
→ 服务端比对身份证
→ 创建员工账号
→ 创建微信绑定
→ 签发 EMPLOYEE Token
→ 进入员工首页
```

### 6.2 一次性绑定码

```text
HR/驻厂打开员工档案
→ 生成10分钟绑定码
→ 线下交给员工
→ 员工输入姓名、身份证后六位和绑定码
→ 后端校验绑定码、项目权限和员工状态
→ 绑定微信并回填手机号
→ 绑定码立即失效
```

### 6.3 工资条签收

```text
薪资专员导入工资
→ 提交复核
→ 复核通过
→ 发布工资条
→ 员工收到小程序消息
→ 查看工资条并记录 VIEW
→ 勾选确认声明
→ 手写签名
→ 上传签名并校验哈希
→ 确认签收
→ 更新 receipt_status=2
→ 写 ACCEPT 证据日志
```

### 6.4 工资异议

```text
员工查看工资条
→ 选择工资有异议
→ 填写原因
→ 状态转为有异议
→ 薪资专员处理
→ 无需改金额：记录处理结果
→ 需要改金额：归档原工资条并创建新版本
→ 重新发布和签收
```

## 7. REST API 设计

### 7.1 微信员工登录

```http
POST /api/auth/employee/wechat-login
Content-Type: application/json

{
  "companyId": 1,
  "loginCode": "wx.login返回值",
  "phoneCode": "getPhoneNumber返回值"
}
```

成功匹配但未完成身份证校验：

```json
{
  "code": 0,
  "data": {
    "bindTicket": "一次性短期票据",
    "maskedName": "张*",
    "needIdentityVerify": true
  }
}
```

手机号无法匹配时返回业务错误，不返回候选员工名单。

### 7.2 身份证后六位绑定

```http
POST /api/auth/employee/bind-phone

{
  "bindTicket": "短期票据",
  "idCardLast6": "12345X"
}
```

成功响应：

```json
{
  "code": 0,
  "data": {
    "token": "JWT",
    "user": {
      "accountType": "EMPLOYEE",
      "employeeId": 1001,
      "realName": "张三"
    }
  }
}
```

### 7.3 生成一次性绑定码

```http
POST /api/employees/:id/bind-code

{}
```

权限：企业管理员、HR 主管，或对该员工项目有权限的驻厂专员。

```json
{
  "code": 0,
  "data": {
    "bindCode": "483921",
    "expireAt": "2026-08-14 15:30:00"
  }
}
```

### 7.4 使用绑定码登录

```http
POST /api/auth/employee/bind-code

{
  "companyId": 1,
  "loginCode": "微信登录凭证",
  "phoneCode": "微信手机号凭证",
  "name": "张三",
  "idCardLast6": "12345X",
  "bindCode": "483921"
}
```

### 7.5 员工资料

```http
GET /api/me/profile
Authorization: Bearer <employee-token>
```

仅返回脱敏身份证和员工本人基础信息。

### 7.6 工资条列表和详情

```http
GET /api/me/payslips?year=2026&page=1&pageSize=20
GET /api/me/payslips/:id
```

服务端必须追加：

```sql
WHERE company_id = :tokenCompanyId
  AND employee_id = :tokenEmployeeId
```

### 7.7 上传签名

```http
POST /api/me/payslips/:id/signature
Content-Type: multipart/form-data

signature=<PNG文件>
signedName=张三
statementVersion=1.0
```

### 7.8 确认签收

```http
POST /api/me/payslips/:id/receipt

{
  "action": "accept",
  "signatureId": 9001,
  "confirmed": true
}
```

### 7.9 提交异议

```http
POST /api/me/payslips/:id/dispute

{
  "reason": "本月加班工时与实际记录不一致，请核对。"
}
```

## 8. 权限与风控

### 8.1 身份与数据隔离

- 员工接口必须校验 `accountType=EMPLOYEE`。
- 管理端接口拒绝员工 Token。
- 员工工资接口只读取 Token 中的 `employeeId`。
- 禁止使用请求体或查询参数指定其他员工ID。
- 所有工资查询限定 `company_id`。
- 员工必须为在职且档案未删除。
- 员工离职、微信解绑或账号停用时递增 `token_version`。

### 8.2 敏感数据保护

- 身份证和签名文件不写普通日志。
- 手机号、身份证、银行卡只脱敏展示。
- 绑定票据有效期5分钟，只能使用一次。
- 身份证后六位校验连续失败5次后冻结30分钟。
- 绑定码使用随机数生成器，不使用时间戳或自增ID。
- 微信 `session_key` 不返回前端、不持久化到日志。

### 8.3 签收证据

证据日志至少包含：

- 企业ID、员工ID、工资条ID、员工账号ID。
- VIEW、SIGN、ACCEPT、REJECT、DISPUTE 操作类型。
- 操作结果、时间、IP、设备信息。
- 工资条数据摘要、签名文件摘要和证据 HMAC。
- 签收声明版本。

### 8.4 管理操作

- 生成绑定码、解绑微信、重发工资条、撤回工资条必须二次确认。
- 工资条发布继续执行“制单与复核分离”。
- 已发布工资条不得直接覆盖金额。
- 工资导出和签收证据导出必须记录审计日志。

## 9. 错误处理

| 场景 | 用户提示 | 系统处理 |
| --- | --- | --- |
| 手机号未匹配 | 未找到可绑定的在职或已离职员工，请联系驻厂人员 | 不返回候选名单 |
| 手机号匹配多人 | 员工档案存在重复手机号，请联系HR处理 | 禁止自动绑定 |
| 身份证后六位错误 | 身份信息校验失败 | 累计失败次数并限流 |
| 微信已绑定他人 | 当前微信已绑定其他员工 | 禁止覆盖，需管理员解绑 |
| 员工已离职 | 仅允许访问本人已发布工资条 | 保留员工端受限会话，拒绝管理权限 |
| 工资条未发布 | 工资条暂不可查看 | 返回404，避免泄露状态 |
| 签名文件异常 | 签名文件无效，请重新签写 | 删除临时文件 |
| 重复签收 | 工资条已经完成签收 | 返回现有签收结果，不重复写入 |

## 10. 测试与验收

### 10.1 登录绑定测试

- 正确手机号和身份证后六位可以绑定。
- 错误身份证后六位不能绑定。
- 无手机号员工可以使用有效绑定码。
- 过期、已使用和超过尝试次数的绑定码不能使用。
- 同一微信不能绑定两个员工。
- 同一员工不能同时绑定两个微信。
- 驻厂只能为自己项目员工生成绑定码。
- 离职员工不能登录。

### 10.2 工资条权限测试

- 员工A不能查询员工B工资条。
- 修改 URL 中工资条ID不能越权。
- 修改前端 employeeId 参数不能越权。
- 企业A不能访问企业B工资数据。
- 未发布工资条不能在员工端查询。
- 管理 Token 不能冒充员工本人签收。

### 10.3 签名签收测试

- 未勾选确认声明不能签收。
- 未上传有效签名不能确认签收。
- 非 PNG、超1MB、伪造图片不能保存。
- 签名哈希与实际文件一致。
- 签收后状态、时间和证据日志一致。
- 重复请求不会重复生成签收记录。
- 异议必须填写原因。

### 10.4 页面验收

- 员工和管理端登录入口清晰分离。
- 员工登录后只显示四个员工菜单。
- 管理人员登录后保持现有管理菜单。
- 首页不直接展示工资金额。
- 工资详情在常见苹果和安卓机型上无需横向滚动。
- 签名板支持清除、重签和提交。

## 11. 开发阶段

### 第一阶段：员工登录闭环

- 数据库迁移。
- 微信登录服务。
- 手机号匹配和身份证后六位校验。
- 一次性绑定码。
- 员工账号与管理账号隔离。
- 双入口登录页面。

### 第二阶段：员工端工资条

- 员工首页。
- 工资条列表、详情和查看留痕。
- 员工端独立 TabBar。
- 员工个人中心。

### 第三阶段：签名与异议

- Canvas 手写签名。
- 签名附件安全存储。
- 原子签收事务。
- 工资异议提交和管理端处理。
- 签收证据查看及导出。

### 第四阶段：工资管理端增强

- Excel 导入预览和行级错误。
- 批次详情、员工签收进度和催签。
- 员工微信绑定状态。
- 工资条重新发布与版本保留。

### 第五阶段：短信通知

- 接入腾讯云 SMS。
- 工资发布通知、催签和补发。
- 频率限制、失败重试和发送日志。
- 短信内容不包含工资金额和完整身份信息。

## 12. 可扩展建议

- 后续可接入腾讯电子签或法大大，提高争议场景证据能力。
- 可增加工资条 PDF 归档，但下载链接必须短时有效并校验本人身份。
- 可增加微信订阅消息，与短信形成双通道提醒。
- 可增加员工申诉工单和处理时效统计。
- 可增加工资条签收率、平均签收时长和异常率分析。
