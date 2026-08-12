# 劳务运营管理系统

面向劳务派遣、岗位外包、灵活用工和 RPO 招聘公司的电脑端 + 手机端 MVP。已包含客户项目、员工档案、人才库、合同社保、保险提示、工资预支、风险闭环和 CSV 导出。

生产后端现已覆盖客户项目、驻厂人员、全公司共享黑名单、工资预支、工资批次概览和账号项目授权。身份证采用 AES 加密存储与 SHA-256 摘要检索，员工录入会自动执行黑名单拦截。

## 运行方式一：生产版 Express + MySQL

```bash
cd hr-roster-system
npm start
```

访问：

```text
http://localhost:3100
```

默认登录账号：

```text
账号：admin
密码：Admin@123456
```

首次上线后必须修改默认密码，并替换 `.env` 里的 `JWT_SECRET`。

生产环境必须启用 HTTPS，并替换 `.env` 中的数据加密密钥。加密密钥上线后不可随意变更，否则历史敏感数据无法解密。

## 云服务器 Docker 部署

推荐云服务器使用 Ubuntu 24.04 LTS，最低 2 核 4GB、80GB SSD。安全组仅开放 `22`、`80`、`443`，不要将 MySQL 的 `3306` 端口开放到公网。

```bash
cp .env.production.example .env.production
# 修改 .env.production 中全部密码和密钥
chmod +x scripts/deploy-cloud.sh
./scripts/deploy-cloud.sh
```

`docker-compose.prod.yml` 会启动 MySQL 8.4 和应用服务，数据库使用持久化卷，应用仅监听云服务器本机 `127.0.0.1:3120`。公网访问应通过 Nginx HTTPS 反向代理，正式启用后立即修改默认管理员密码。

所有 SQL 初始化必须显式使用 `utf8mb4`。若手工执行 SQL，请使用：

```bash
mysql --default-character-set=utf8mb4 -uroot -p < sql/schema.mysql.sql
mysql --default-character-set=utf8mb4 -uroot -p < sql/seed.mysql.sql
```

隔离测试环境完成迁移后，可执行驻厂生命周期 UAT：

```bash
UAT_BASE_URL=http://127.0.0.1:3100/api \
UAT_USERNAME=admin \
UAT_PASSWORD='测试环境管理员密码' \
npm run uat:onsite
```

生产发布完成后，先执行不写业务数据的上线验证：

```bash
BASE_URL=https://www.lczpt.com \
SSH_TARGET=root@生产服务器IP \
ONSITE_SMOKE_USER_ID=驻厂测试用户ID \
bash scripts/post-deploy-verify.sh
```

如果只验证公网健康、首页、新版页面标记和未授权拦截，可省略 `SSH_TARGET` 与 `ONSITE_SMOKE_USER_ID`。完整业务闭环 UAT 会创建员工、转岗和离职记录，只能在测试环境或经批准的试点数据范围内执行。

该命令会创建测试员工、招聘人和测试项目，只能在测试库运行。

生产版目录：

- 后端入口：`src/app.js`
- 数据库连接：`src/db.js`
- 路由：`src/routes/`
- Controller：`src/controllers/`
- Service：`src/services/`
- 前端页面：`public/`
- MySQL：`sql/schema.mysql.sql`
- 初始化数据：`sql/seed.mysql.sql`

首次运行前需要：

```bash
cp .env.example .env
npm install
```

然后创建数据库并初始化：

```bash
mysql -uroot -p < sql/schema.mysql.sql
mysql -uroot -p < sql/seed.mysql.sql
```

修改 `.env` 里的数据库配置：

```bash
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=hr_user
DB_PASSWORD=your_password
DB_NAME=hr_roster
```

## 运行方式二：零依赖原型版（仅演示用）

原型版仅用于本机快速演示，不连接 MySQL。生产环境请使用运行方式一。

```bash
cd hr-roster-system
npm run prototype
```

原型版说明：

- 后端：`server.js`，Node 原生 HTTP 服务。这是一个独立的原型后端，与生产 Express 路由（`src/` 目录）互斥运行，两者使用同一份前端文件（`public/`），但数据存储和接口实现不同。
- 前端：`public/index.html`、`public/styles.css`、`public/app.js`
- 数据：`data/db.json`，首次启动自动生成
- 适合：流程演示、业务确认、开发样板
- **注意**：原型版不支持权限校验、数据脱敏和数据库事务，不能替代生产环境。

## 已实现功能

| 模块 | 功能 |
|---|---|
| 员工花名册 | 列表、查询、筛选、详情 |
| 客户项目 | 客户单位、结算周期、用工项目、厂区、驻场负责人 |
| 人才库 | 招聘来源、意向岗位、人才标签、跟进状态 |
| 保险提示 | 在职应保、已参保、待增员和高风险提示 |
| 工资预支 | 申请、额度校验、审批、放款和未结余额 |
| 办公中心 | 手机九宫格、常用功能、待办中心、消息中心、移动底部导航 |
| 动态业务通知 | 入职、合同、保险、离职、风险、预支审批、工资发布自动生成消息，并按员工/项目权限隔离 |
| 自动风险扫描 | 生产环境每日北京时间02:00自动扫描合同、社保、雇主险、证件和特殊工种证件，并记录执行日志 |
| 合规附件 | 合同、保险、证件、风险整改材料上传与受保护下载，具备权限隔离、SHA-256留痕和每日备份 |
| 工资发放 | 工资批次、预支扣回、实发金额、工资条签收状态 |
| 驻厂人员管理 | 项目厂区、车间班次、住宿安排、驻场负责人、在厂状态 |
| 全公司黑名单 | 独立录入姓名、身份证、原因、来源和风险等级；员工新增自动拦截 |
| 权限管理 | 后台账号、角色权限、数据范围和授权项目 |
| 员工档案 | 新增、编辑、手机号/身份证/银行卡脱敏展示 |
| 任职记录 | 当前任职、调岗生成历史记录 |
| 离职管理 | 驻厂单页填写离职信息、确认四项交接并同步雇主险减保，办结后保留在已离职花名册并回流人才库 |
| 合同社保 | 合同状态、社保状态展示 |
| 证件资料 | 身份证、健康证、特种作业证状态展示 |
| 合同维护 | 员工详情内登记劳动合同 |
| 社保维护 | 员工详情内维护社保、公积金基数和起止月份 |
| 证件维护 | 员工详情内添加健康证、上岗证、特种作业证 |
| 风险预警 | 未签合同、合同到期、社保异常、证件过期、特殊工种无证 |
| 风险处理 | 处理、忽略 |
| 用工风险管理 | 风险建档、责任人、整改期限、整改措施、证据提交、复核关闭、逾期识别 |
| HR数字驾驶舱 | 人员指标、部门分布、用工结构、合规覆盖率、风险处置、入离职趋势 |
| 数据导出 | 按当前筛选条件导出 CSV |
| 登录鉴权 | 账号密码登录、Bearer Token |
| 账号安全 | 管理员修改密码、密码强度校验、安全哈希存储 |
| 操作审计 | 员工、合同、社保、证件、风险及账号操作日志 |
| 权限控制 | 员工、风险、导出、调岗、离职接口权限 |
| 数据权限 | 全部、本部门及下级、本部门、本人、自定义部门 |

## API 清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bootstrap` | 获取企业、部门、岗位、字典 |
| GET/POST | `/api/clients` | 客户列表/新增客户 |
| GET/POST | `/api/projects` | 项目列表/新建项目 |
| GET/POST | `/api/talents` | 人才库列表/快速录入 |
| GET/POST | `/api/advances` | 预支列表/提交申请 |
| PUT | `/api/advances/:id/approve` | 审批预支 |
| PUT | `/api/advances/:id/pay` | 登记放款 |
| GET | `/api/insurance/overview` | 保险提示汇总 |
| GET | `/api/operations/home` | 办公首页、待办与通知汇总 |
| GET | `/api/notices` | 获取当前账号数据范围内的动态业务通知 |
| POST/GET | `/api/attachments` | 上传或查询合同、保险、证件、整改附件 |
| GET | `/api/attachments/:id/download` | 按账号权限下载合规附件 |
| GET | `/api/payroll/overview` | 工资批次与签收汇总 |
| GET | `/api/employment-records` | 员工用工记录 |
| GET/POST | `/api/factory-staff` | 驻厂人员台账/登记驻厂人员 |
| GET/POST | `/api/blacklist` | 全公司共享黑名单查询/录入 |
| GET | `/api/permissions/overview` | 角色与账号权限概览 |
| POST | `/api/system/users` | 新增后台账号 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 当前用户信息 |
| PUT | `/api/auth/password` | 修改当前用户密码 |
| GET | `/api/audit-logs` | 获取最近200条操作日志 |
| GET | `/api/summary` | 获取首页指标 |
| GET | `/api/analytics/dashboard` | 获取HR数字化驾驶舱指标与图表数据 |
| GET | `/api/employees` | 员工列表 |
| POST | `/api/employees` | 新增员工 |
| POST | `/api/employees/precheck` | 身份证、重复、黑名单和招聘来源预检查 |
| GET | `/api/employees/:id` | 员工详情，默认脱敏 |
| GET | `/api/employees/:id?showSensitive=1` | 员工详情，编辑用明文字段 |
| PUT | `/api/employees/:id` | 编辑员工 |
| POST | `/api/employees/:id/job-transfer` | 员工调岗 |
| PUT | `/api/employee-transfers/:changeId/handle` | 跨项目接收/拒绝或跨客户 HR 复核 |
| POST | `/api/employees/:id/resign` | 员工离职 |
| PUT | `/api/resignations/:resignationId/progress` | 兼容历史离职记录，一次确认交接和雇主险减保后归档 |
| POST | `/api/employees/:id/contracts` | 登记员工合同 |
| PUT | `/api/employees/:id/social-security` | 维护社保公积金 |
| POST | `/api/employees/:id/certificates` | 添加员工证件 |
| GET | `/api/risk-alerts` | 风险列表 |
| POST | `/api/risk-alerts/scan` | 手动扫描风险 |
| PUT | `/api/risk-alerts/:id/handle` | 处理或忽略风险 |
| GET | `/api/risk-cases` | 查询用工风险整改任务 |
| POST | `/api/risk-cases` | 从风险预警创建整改任务 |
| PUT | `/api/risk-cases/:id` | 更新整改进度、提交证据或复核关闭 |
| GET | `/api/export/employees.csv` | 导出员工 CSV |

## 风控规则

| 风险 | 触发条件 | 等级 |
|---|---|---|
| 在职员工未签合同 | 在职员工无已签合同 | 高 |
| 劳动合同即将到期 | 合同结束日期 30 天内 | 中 |
| 劳动合同已过期 | 合同结束日期早于当前日期 | 高 |
| 全职员工社保异常 | 全职在职员工无有效参保记录 | 高 |
| 员工证件即将过期 | 证件 30 天内到期 | 中 |
| 员工证件已过期 | 证件到期日期早于当前日期 | 高 |
| 特殊工种证件缺失 | 特殊工种岗位无有效特种作业证 | 高 |
| 离职社保停保提醒 | 办理离职后生成 | 中 |

## 生产化进度

已完成：

1. `Express + MySQL` 后端入口。
2. `server.js` 已拆分为路由、Controller、Service、工具层。
3. 身份证号、银行卡号支持 AES 加密入库。
4. 员工 CRUD、调岗、离职、风险扫描已接 MySQL。
5. CSV 导出已接 MySQL。
6. 登录、Token、接口权限校验已接入。
7. 员工和风险查询已接入数据权限过滤。

后续建议：

1. 增加后台角色权限管理页面。
2. 增加修改密码和重置密码。
3. CSV 导出升级为 Excel 导入导出。
4. 风险扫描改为定时任务，并记录扫描日志。
5. 附件上传接入阿里云 OSS 或腾讯云 COS。

## 权限模型

系统保留四类业务角色：

| 角色 | 数据范围 | 说明 |
|---|---|---|
| 企业管理员 | 全部 | 拥有全部菜单和按钮权限，可配置其他角色权限 |
| HR主管 | 授权项目 | 员工管理、风险预警、保险查看、操作日志、合同社保证件管理 |
| 驻厂专员 | 授权项目 | 新增员工、批量录入、新增客户与项目、查看授权范围数据 |
| 薪资专员 | 授权项目 | 工资预支查看/申请/审批/放款、工资批次管理与复核 |

接口权限示例：

| 权限编码 | 说明 |
|---|---|
| `employee:view` | 查看员工 |
| `employee:create` | 新增员工 |
| `employee:update` | 编辑员工 |
| `employee:transfer` | 员工调岗 |
| `employee:resign` | 员工离职 |
| `employee:export` | 导出员工 |
| `contract:manage` | 管理合同 |
| `social:manage` | 管理社保公积金 |
| `cert:manage` | 管理证件资料 |
| `risk:view` | 查看风险 |
| `risk:scan` | 扫描风险 |
| `risk:handle` | 处理风险 |
| `insurance:view` | 查看保险概览 |
| `audit:view` | 查看操作日志 |

## 质量检查

```bash
npm run check
```

当前检查内容：

- `server.js` 语法检查（仅原型模式入口，生产不使用）
- `public/app.js` 语法检查
- `src/**/*.js` 语法检查
- 数据范围隔离测试
- 用工模式/费用模式测试
- 花名册与预支联动测试
- 角色目录测试（四角色权限矩阵）
- 客户项目统一管理测试
- Express 路由装载验证
