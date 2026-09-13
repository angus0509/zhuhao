# 优益数字化管理系统交接文档

> 更新时间：2026-08-15（Asia/Shanghai）  
> 项目目录：`/Users/zhuhao/Documents/moluo/hr-roster-system`  
> 当前分支：`main`  
> 当前基准提交：`a60b72e`  
> 注意：本文不记录私钥、AppSecret、Token、完整手机号、身份证号或真实工资敏感数据。

## 1. 项目概况

本项目是供人力资源服务公司内部使用的“优益数字化管理系统”，包含：

- Web 管理后台
- 手机 Web 适配页面
- 微信小程序
- Node.js + Express API
- MySQL 生产数据库
- 腾讯云服务器及短信、OCR 等云服务接入

主要角色：

- 企业管理员
- HR 主管
- 驻厂专员
- 薪资专员
- 员工账号

核心业务模块：

- 客户、项目和驻厂专员关联
- 员工录入、待到岗、在职、离职和人才库流转
- 员工花名册、客户分类和数据隔离
- 招聘渠道和来源管理
- 工资预支月度台账
- 工资条导入、发布、查询、签名、签收和异议
- 员工短信验证码登录及工资条通知
- 合同、雇主险、黑名单、权限及审计日志

## 2. 技术与环境

### 2.1 技术栈

- 后端：Node.js、Express
- 数据库：MySQL
- Web：原生 HTML/CSS/JavaScript
- 小程序：微信原生小程序
- 部署：腾讯云服务器、Docker Compose、Nginx、HTTPS
- 短信：腾讯云短信
- OCR：腾讯云文字识别

### 2.2 生产环境

- 生产域名：`https://lczpt.com`
- API 根地址：`https://lczpt.com/api`
- 健康检查：`https://lczpt.com/api/health`
- 生产目录：`/opt/moluo-hr`
- Compose 文件：`docker-compose.prod.yml`

2026-08-15 最新只读检查结果：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "service": "hr-roster-system",
    "mode": "express-mysql",
    "database": "connected"
  }
}
```

### 2.3 小程序状态

- AppID：记录在 `wechat-miniprogram/release.json`，不要在外部文档重复传播
- 线上正式版本：`1.1.10`
- 当前开发/体验版本：`1.1.12`
- `1.1.12` 状态：已上传微信公众平台，尚未提交审核
- `1.1.12` 内容：修复员工工资条跳转、角色菜单同步和月份列表显示
- API 地址：`https://lczpt.com/api`

版本来源：

- `wechat-miniprogram/release.json`
- `wechat-miniprogram/miniprogram/app.js`
- `release-candidate.json`

## 3. 当前已经完成的内容

### 3.1 员工工资条基础闭环

已经实现：

- 管理端工资表灵活 Excel 导入
- 工资批次预览、确认、发布和明细查看
- 员工短信通知任务
- 员工本人查询年度、月份工资条
- 工资条详情查看
- 手写签名图片上传
- 本人确认签收
- 工资异议提交与管理端处理
- 查看、签名、签收和异议操作留痕
- 员工账号与管理账号权限隔离

主要文件：

- `src/controllers/payslip.controller.js`
- `src/services/payslip.service.js`
- `src/services/payslip-signature.service.js`
- `src/routes/payslip.routes.js`
- `src/services/sms-delivery.service.js`
- `wechat-miniprogram/miniprogram/pages/my-payslips/`
- `public/js/core/payroll-import.js`

### 3.2 短信发布 SQL 错误已修复并部署

历史报错：

```text
Column 'id' in field list is ambiguous
```

根因：

- `sms_delivery_job` 的 `INSERT ... SELECT ... ON DUPLICATE KEY UPDATE id=id` 在联表场景产生歧义。

修复：

- 改为更新明确的去重字段：`dedupe_key=dedupe_key`。

结果：

- 工资条发布接口已经成功。
- 对应回归测试：`test/payroll-sms-delivery.test.js`。

### 3.3 员工工资条路由 403 已修复并部署

历史现象：

- `/api/me/profile` 返回 200。
- `/api/me/payslips` 返回 403，并提示员工账号不能访问管理功能。

根因：

- `src/routes/attachment.routes.js` 把 `requireManagerAccount` 挂在路由根路径，误拦截排在后面的员工本人接口。

修复：

```js
router.use('/attachments', requireManagerAccount);
```

结果：

- 员工本人访问 `/api/me/payslips` 已恢复 200。
- 员工访问管理附件接口仍为 403，没有放宽权限。
- 回归测试：`test/employee-account-isolation.test.js`。

### 3.4 小程序员工菜单残留已修复并上传 1.1.12

历史现象：

- 员工从短信或工资条链接进入后，底部仍残留管理端菜单。

修复：

- 在同步当前菜单项之前调用 `tabBar.syncAccountTabs()`。
- 修改文件：`wechat-miniprogram/miniprogram/utils/tab-bar.js`。
- 回归测试：`test/miniprogram-employee-shell.test.js`。

### 3.5 员工关联手机号已同步

- 测试员工档案、员工账号和微信绑定的手机号已经统一。
- 管理员手机号未被覆盖。
- 已生成生产数据修改前备份。
- 已写入敏感操作审计日志。
- 本文不记录完整手机号。

### 3.6 签名上传失败根因已定位并处理

生产诊断证据：

- 员工可正常访问工资条列表和详情。
- 点击上传签名时，Nginx 当时没有收到 `POST /api/me/payslips/:id/signature`。
- 服务器内部 multipart PNG 上传测试能到达接口。
- 上传目录和容器目录可写。
- 数据库、上传中间件、路由和权限链路正常。

根因：

- 微信公众平台只在 `request 合法域名` 中配置了 `https://lczpt.com`。
- `uploadFile 合法域名` 中缺少 `https://lczpt.com`，导致 `wx.uploadFile` 在客户端被微信拦截，请求没有到达服务器。

已完成外部配置：

- 微信公众平台 → 开发管理 → 开发设置 → 服务器域名
- 已将 `https://lczpt.com` 加入 `uploadFile 合法域名`
- 保存后刷新页面，已确认该域名出现在上传合法域名列表中

本地同时增强了错误提示：

- 域名未配置：提示管理员配置微信上传合法域名
- 临时签名文件不存在：提示重新签写
- 上传超时：提示检查网络重试

修改文件：

- `wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.js`
- `test/miniprogram-payslip-signature.test.js`

本地验证：

```text
miniprogram-payslip-signature-tests-ok
npm run lint 通过
```

注意：详细错误提示改动目前只在本地，尚未上传新小程序版本；域名配置本身对当前 1.1.12 已生效。

### 3.7 Web 工资条发放、撤回和签名查看已完成（本地未部署）

2026-08-15 已完成以下本地改造：

- 网页端“工资发放”统一改为“工资条发放”。
- 批次列表增加发放成功、发放失败、已签收和待签收人数。
- 批次详情增加每名员工的工资条发放状态、短信通知状态及失败原因。
- 批次详情展示签名姓名、签名时间，并可通过受保护接口预览员工签名图片。
- 新增工资条撤回功能，要求 `payroll:manage` 权限、撤回原因和二次确认。
- 仅无人查看、无人签名、无人签收、无异议时允许撤回。
- 撤回后批次回到待发放、员工端工资条隐藏、短信任务取消，审计日志永久保留。
- 管理员查看员工签名会写入 `view_signature` 审计记录。

新增接口：

```text
PUT /api/payroll/batches/:id/withdraw
GET /api/payroll/payslips/:id/signature
```

主要新增测试：

- `test/payroll-withdrawal.test.js`
- `test/payroll-signature-preview.test.js`
- `test/web-payroll-delivery-withdraw.test.js`

本地验证结果：

```text
npm run check 通过
npm run postcheck 通过
npm audit --audit-level=high：0 vulnerabilities
git diff --check 通过
```

发布状态：尚未部署生产环境，尚未提交 Git。

## 4. 当前卡住或尚未闭环的问题

### 4.1 签名上传需要员工本人重新验收

当前状态：技术根因已修复，但还缺一次真实手机端闭环验收。

需要员工本人执行：

1. 完全退出微信小程序。
2. 重新进入体验版。
3. 打开待签收工资条。
4. 手写签名并确认签收。

验收时应看到：

- Nginx 出现 `POST /api/me/payslips/:id/signature`。
- `salary_signature` 增加有效签名记录。
- `hr_attachment.biz_type='payslip_signature'` 增加附件记录。
- `salary_receipt_log` 增加 `ACCEPT` 留痕。
- `salary_detail.receipt_status` 更新为已签收。

禁止事项：

- 不得由管理员或开发人员代替员工签名或签收。
- 不得为了测试伪造真实员工签字。

### 4.2 腾讯云短信存在单号码日限额

出现过：

```text
LimitExceeded.PhoneNumberDailyLimit
```

这是腾讯云短信侧的单手机号日发送限制，不是工资条发布代码错误。

处理建议：

- 换未达到日限额的测试号码验收。
- 检查腾讯云短信频控配置。
- 不要通过循环重试绕过平台频控。

### 4.3 小程序 1.1.12 尚未审核发布

- 当前只是开发/体验版本。
- 正式线上仍是 1.1.10。
- 提交审核、发布正式版都属于外部发布操作，必须获得用户明确授权。

### 4.4 本地工作区改动很多，尚未提交 Git

当前工作区包含大量已修改和新增文件，覆盖：

- 员工账号和微信登录
- 短信验证码
- 工资条导入、发布、短信通知
- 签名、签收和异议
- 安全、附件和权限隔离
- Web、小程序和数据库迁移

风险：

- 不能使用 `git reset --hard`、`git checkout -- .` 等破坏性命令。
- 不能把未跟踪文件当作无用文件批量删除。
- 不要只提交最近两个文件而遗漏工资条完整依赖链。
- 当前没有 Git 提交或远程推送授权。

### 4.5 本地详细错误提示尚未上传

如要把增强提示交付给用户，需要：

- 确定下一版本号，建议 `1.1.13`。
- 同步修改所有版本展示和发布清单。
- 完成全套验证。
- 获得明确的“小程序上传”授权后再上传。

## 5. 下一步计划

### P0：完成签名真实闭环验收

1. 员工重新进入体验版并签收工资条。
2. 只读检查 Nginx 上传请求。
3. 只读检查签名、附件、签收日志和工资条状态。
4. 若仍失败，记录手机系统、微信版本、完整页面提示和发生时间，再按请求边界排查。

### P1：整理并发布小程序修复版

1. 将版本从 1.1.12 升级为 1.1.13。
2. 保留本次签名上传详细错误提示。
3. 检查员工账号进入工资条后的年份、月份、详情、签名和签收流程。
4. 检查管理账号和员工账号底部菜单完全隔离。
5. 运行完整验证。
6. 用户明确授权后上传体验版。
7. 用户再次授权后提交审核；审核通过后再授权发布。

### P2：完成工资条四角色验收

建议按以下角色测试：

- 企业管理员：导入、预览、发布、短信任务、异议处理
- 薪资专员：工资批次和明细权限
- 驻厂专员：只能访问负责客户和员工，不得越权查看其他客户工资
- 员工：只能查看自己的工资条、签名、签收和提交异议

重点权限断言：

- 员工不能访问管理端工资接口。
- 员工 A 不能查看员工 B 的工资条。
- 企业 A 不能访问企业 B 的员工和工资数据。
- 导出、发布、签收和敏感查询必须有审计日志。

### P3：整理 Git 交付

在用户授权提交前：

1. 先执行 `git status --short`。
2. 按业务闭环审查所有新增文件，尤其是未跟踪文件。
3. 检查数据库迁移、后端、Web、小程序和测试是否成套。
4. 运行完整验证。
5. 使用清晰的提交说明进行本地提交。
6. 远程推送必须单独确认并核验 GitHub 身份认证。

## 6. 推荐验证命令

在项目根目录执行：

```bash
cd /Users/zhuhao/Documents/moluo/hr-roster-system
npm run lint
npm run check
npm run postcheck
npm audit --audit-level=high
git diff --check
```

签名功能定向验证：

```bash
node test/miniprogram-payslip-signature.test.js
node test/payslip-signature-upload.test.js
node test/payslip-signed-receipt.test.js
node test/payslip-signature-security.test.js
node test/employee-account-isolation.test.js
```

生产只读健康检查：

```bash
curl -fsS https://lczpt.com/api/health
```

## 7. 已踩过的坑及规避方法

### 7.1 微信网络域名按 API 类型分别配置

坑：配置了 `request 合法域名`，不代表 `wx.uploadFile` 自动可用。

规避：

- `wx.request` 检查 request 合法域名。
- `wx.uploadFile` 检查 uploadFile 合法域名。
- `wx.downloadFile` 检查 downloadFile 合法域名。
- WebSocket 检查 socket 合法域名。

判断方法：客户端报错且 Nginx 完全没有请求时，优先检查微信合法域名和本地临时文件，不要先改后端。

### 7.2 Express 子路由中间件作用域过大

坑：在共享 Router 根路径挂管理账号守卫，会误拦截员工本人路由。

规避：

- 权限中间件必须挂到明确前缀。
- 同时测试允许路径和禁止路径。
- 修复员工接口时不能顺带放宽附件、导出等管理接口。

### 7.3 MySQL 联表 UPSERT 字段歧义

坑：`ON DUPLICATE KEY UPDATE id=id` 在联表查询中可能产生字段歧义。

规避：

- 使用明确、非歧义的目标字段。
- 工资条发布和短信任务必须有真实 SQL 回归测试。

### 7.4 小程序角色菜单只改选中项不够

坑：切换账号类型后只更新当前菜单颜色，会残留上一角色的菜单结构。

规避：

- 进入页面时先同步账号对应的完整 tab 集合。
- 再同步当前选中项。
- 同时测试管理员、驻厂和员工三类入口。

### 7.5 员工档案、账号和微信绑定手机号可能不一致

坑：只修改员工花名册手机号，员工账号和微信绑定仍保留旧号码。

规避：

- 修改前备份。
- 同一事务或受控脚本同步三个关联位置。
- 保留管理员账号不变。
- 写入审计日志，并只展示脱敏号码。

### 7.6 短信平台限额不能当作代码失败

坑：工资条发布成功，但短信因腾讯云日限额失败，容易误判为发布失败。

规避：

- 区分工资条发布状态和短信投递状态。
- 记录腾讯云错误码。
- 使用独立短信任务重试，但必须遵守平台频控。

### 7.7 部署、上传、审核、发布和 Git 推送不是同一件事

必须分别报告：

- 本地代码已修改
- 本地测试已通过
- Web/API 已部署
- 小程序体验版已上传
- 小程序已提交审核
- 小程序已正式发布
- Git 已本地提交
- Git 已远程推送

任何一个完成都不能推断其他步骤已经完成。

### 7.8 生产数据验证要保护隐私

- 日志中禁止输出完整手机号、身份证号、银行卡号、密码和 Token。
- 工资条验收只使用最小必要测试数据。
- 不得代替员工本人签收。
- 生产 SQL 修改前必须备份，并保留审计记录。

## 8. 发布与操作授权边界

以下操作必须获得用户明确授权后执行：

- 腾讯云生产部署
- 生产数据库写入、修复或删除
- 小程序上传
- 提交微信审核
- 正式发布小程序
- Git commit
- Git push
- 修改域名、证书、密钥、短信权限和 AppSecret

普通本地检查、只读生产健康检查、代码审计和测试可以直接进行。

## 9. 交接给下一位开发者的首要动作

1. 先阅读本文件，不要直接覆盖现有改动。
2. 执行 `git status --short`，确认脏工作区范围。
3. 检查 `release-candidate.json` 和 `wechat-miniprogram/release.json`。
4. 先完成员工本人签名验收，再决定是否继续改代码。
5. 如需发布详细错误提示，按 1.1.13 做完整版本同步和验证。
6. 未收到明确授权前，不部署、不上传、不审核、不发布、不提交 Git。
