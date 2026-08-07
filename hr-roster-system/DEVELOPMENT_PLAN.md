# 优益数字化管理系统 — 开发修改文档

> 基于 2026-08-04 对 `lczpt.com` 全量代码审查输出。目标：安全加固 → 架构优化 → 功能补全 → 体验提升。

## 当前执行状态（2026-08-07）

| 项目 | 状态 | 实际结果 |
|---|---|---|
| SQL 分页参数化 | 已完成 | `operations.service.js`、`employee.service.js` 已无 LIMIT/OFFSET 字符串插值 |
| API 与敏感操作限流 | 已完成 | 已正确配置腾讯云 Nginx 单层代理，登录按 IP+用户名限流，批量操作独立限流 |
| CORS 白名单 | 已完成 | 允许 `lczpt.com`、`www.lczpt.com`、无 Origin 的微信小程序请求；开发环境允许本地地址 |
| npm 安全修复 | 已完成 | `npm audit --audit-level=high --omit=dev` 为 0 漏洞 |
| 小程序员工核心模块 | 已完成待发布 | 新增员工默认待入职，支持确认入职、社保/雇主险、规范离职、客户分类与保险筛选 |
| 前端 app.js 拆分 | 进行中 | 已抽离 state、utils、api、router、dashboard、roster-table，以及花名册列表加载/导出/客户分组渲染，保持经典脚本按序加载，无构建工具 |
| 动态业务通知 | 已完成待发布 | 入职、合同、保险、离职、风险、预支、工资发布自动生成，按员工/项目权限隔离 |
| 定时风险扫描 | 已完成待发布 | 生产环境每日北京时间02:00扫描全部启用企业，防重入并写扫描日志 |
| 附件上传 | 已完成待发布 | 本地持久化、权限和数据范围校验、下载审计及每日备份已完成；COS 作为后续可选存储 |
| Excel 导出 | 已完成待发布 | 新增服务端三 Sheet XLSX、脱敏、公式注入防护、SHA-256 与操作审计 |
| 图表升级 | 已完成待发布 | Chart.js 渐进增强，CDN 不可用时回退现有 CSS 图表，动画受 `?motion=1` 控制 |
| 运维监控 | 已完成待发布 | 健康检查验证 MySQL 并返回 503；结构化错误日志不记录请求体、参数和敏感数据 |
| 可选动效主题 | 已完成待发布 | `?motion=1` 启用独立动效层，默认主题不受影响并支持减少动态效果 |
| 花名册表格增强 | 已完成待发布 | 支持 17 列显示/隐藏、偏好本地保存、键盘可用的当前页排序和动态分组列宽 |
| 雇主险合规口径调整 | 已完成待发布 | 删除“保险提示”菜单和独立台账；取消社保、公积金办理与风险提示，仅保留员工雇主险增保/减保，Web、小程序、风险扫描、权限和导出已同步 |

> 注意：Web/API 发布包不包含 `wechat-miniprogram`。小程序必须通过微信开发者工具单独上传、提交审核和发布。

---

## 阶段一：安全加固（P0，优先执行）

### 1.1 修复 SQL 注入（LIMIT/OFFSET 参数化）

**文件：`src/services/operations.service.js`** — 5 处

所有 `${pageSize}` 和 `${offset}` 字符串拼接改为命名参数 `:pageSize` / `:offset`。`params` 对象中已包含 `pageSize` 和 `offset`，只需改 SQL 字符串。

| 行号 | 函数 | 修改内容 |
|---|---|---|
| 28 | `listCustomers` | `LIMIT ${pageSize} OFFSET ${offset}` → `LIMIT :pageSize OFFSET :offset` |
| 200 | `listProjects` | 同上 |
| 257 | `listFactoryStaff` | 同上 |
| 303 | `listBlacklist` | 同上 |
| 374 | `listAdvances` | 同上 |

**文件：`src/services/employee.service.js`** — 2 处

| 行号 | 函数 | 修改内容 |
|---|---|---|
| 475 | `listEmployees` | `LIMIT ${pageSize} OFFSET ${offset}` → `LIMIT :pageSize OFFSET :offset` |
| 529 | `listMyEmployees` | `LIMIT ${pageSize} OFFSET ${offset}` → `LIMIT :limit OFFSET :offset`（注意此函数 params 中键名为 `limit` 而非 `pageSize`，见第 497 行） |

**验证命令：**
```bash
grep -rn 'LIMIT \${' src/ --include="*.js"   # 应无输出
grep -rn 'OFFSET \${' src/ --include="*.js"   # 应无输出
node -e "require('./src/services/operations.service');require('./src/services/employee.service');console.log('OK')"
```

---

### 1.2 添加速率限制

**安装：**
```bash
cd /Users/zhuhao/Documents/moluo/hr-roster-system
npm install express-rate-limit
```

**新建文件：`src/middlewares/rate-limit.middleware.js`**

```javascript
const rateLimit = require('express-rate-limit');

// 全局限制：每个 IP 每分钟 100 次
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后再试', data: null }
});

// 敏感接口限制：每个 IP 每分钟 10 次
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '操作过于频繁，请稍后再试', data: null }
});

module.exports = { globalLimiter, sensitiveLimiter };
```

**修改文件：`src/app.js`**

在 `app.use(express.json(...))` 之后、`app.use('/api', apiRoutes)` 之前添加：

```javascript
const { globalLimiter, sensitiveLimiter } = require('./middlewares/rate-limit.middleware');
app.use('/api', globalLimiter);
```

**修改文件：`src/routes/index.js`**

对敏感路由单独应用 `sensitiveLimiter`：
- `POST /auth/login` — 登录
- `POST /advances` — 预支申请
- `PUT /advances/:id/approve` — 审批预支
- `PUT /advances/:id/pay` — 放款
- `POST /payroll/batches` — 创建工资批次
- `PUT /payroll/batches/:id/publish` — 发布工资条
- `POST /employees` — 新增员工
- `POST /employees/batch` — 批量录入

写法示例：
```javascript
const { sensitiveLimiter } = require('../middlewares/rate-limit.middleware');
router.post('/auth/login', sensitiveLimiter, authController.login);
```

---

### 1.3 配置 CORS 白名单

**安装：**
```bash
npm install cors
```

**修改文件：`src/app.js`**

在 `const app = express();` 之后、`app.use(express.json(...))` 之前添加：

```javascript
const cors = require('cors');
app.use(cors({
  origin: [
    'https://lczpt.com',
    'https://www.lczpt.com',
    'https://servicewechat.com'  // 微信小程序
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
}));
```

---

### 1.4 npm audit 安全修复

```bash
npm audit fix
```

当前 1 个 low severity 漏洞（body-parser 间接依赖），执行 `npm audit fix` 尝试自动修复。如果无法自动修复且确认为 low 级别，可记录豁免。

---

## 阶段二：前端架构重构（P1）

### 2.1 拆分 app.js

**执行状态（2026-08-06）：进行中。** 第一批已抽离全局状态、DOM 基础工具、加载状态、API 请求和缓存层；后续继续拆分通用工具、路由和各业务视图。

当前 `public/app.js` 为 2445 行巨型单文件，包含所有视图逻辑。目标拆分为以下结构：

```
public/
├── index.html              # 不变
├── styles.css              # 不变
├── theme-next.css          # 不变
├── theme-tech.css          # 不变
├── js/
│   ├── core/
│   │   ├── state.js        # state 对象 + showLoading/hideLoading
│   │   ├── api.js          # api() + cachedApi() + clearCache()
│   │   ├── router.js       # switchView() + viewLoaders + viewElements
│   │   └── utils.js        # escapeHtml, badge, statusTone, debounce, toast,
│   │                          money, formToObject, paging, optionHtml, emptyRow,
│   │                          tableFooter, parseBatchTable, downloadCsvTemplate,
│   │                          downloadXlsxTemplate, rowsToTabText,
│   │                          handleBatchFile, bindBatchFileZone, showBatchResult
│   ├── views/
│   │   ├── office.js       # loadOffice + renderOfficeActions + runOfficeAction
│   │   ├── dashboard.js    # loadDashboard + render系列函数(dashboard/employment/compliance/risk/trend)
│   │   ├── roster.js       # loadEmployees + renderEmployees + selectEmployee +
│   │   │                       renderDetail + openEmployeeModal + saveEmployee +
│   │   │                       openTransfer/Resign/Contract/Social/Certificate +
│   │   │                       submitTransfer/Resign/Contract/Social/Certificate +
│   │   │                       loadMobileEmployees + renderMobileEmpCards +
│   │   │                       submitMobileEmployee + handleOcrScan + compressImage
│   │   ├── projects.js     # loadProjects + openClientManagement + customerProjectEditor
│   │   ├── insurance.js    # loadInsurance + renderInsuranceRows
│   │   ├── advances.js     # loadAdvances + prepareAdvanceForm + approveAdvance + payAdvance
│   │   ├── payroll.js      # loadPayroll + submitPayrollBatch
│   │   ├── risk.js         # loadRisks + scanRisks + handleRisk
│   │   ├── riskCases.js    # loadRiskCases + openRiskCaseModal + saveRiskCase
│   │   ├── blacklist.js    # loadBlacklist + submitBlacklistBatch
│   │   ├── talents.js      # loadTalents
│   │   ├── audit.js        # loadAuditLogs
│   │   └── permissions.js  # loadPermissions + openPermissionUserModal +
│   │                          openRolePermissionModal + renderPermTree
│   └── app.js              # 入口：init() + bindEvents() + login/logout + bootAuthedApp
```

**实施步骤：**
1. 先抽出 `core/` 下的 4 个文件（state, api, router, utils）
2. 再逐个抽出 `views/` 下的视图文件
3. `index.html` 底部改为按需加载 `<script>` 标签
4. 每个视图 JS 文件暴露一个 `initXxxView()` 函数，往 `viewLoaders` 注册
5. 不要引入 Webpack/Vite 等构建工具，保持原生 ES module 或 IIFE 模式

**验证：**
```bash
# 每个 JS 文件语法检查
for f in public/js/core/*.js public/js/views/*.js public/js/app.js; do
  node --check "$f" || echo "FAIL: $f"
done
```

### 2.2 通知系统动态化

**执行状态（2026-08-04）：已完成。** 已落地 `GET /api/notices`、`hr_system_notice`、业务幂等键、员工/项目数据隔离和办公首页动态渲染。未采用“全公司共用 is_read”设计，避免一名用户读取后影响其他账号；个人已读状态将在需要红点提醒时通过独立读取记录表扩展。

**新建数据库表（SQL 迁移文件）：`sql/migrate-system-notices.mysql.sql`**

```sql
CREATE TABLE IF NOT EXISTS hr_system_notice (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT '系统通知',
  notice_type VARCHAR(30) NOT NULL DEFAULT 'info',
  target_view VARCHAR(30) DEFAULT NULL,
  is_read TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_company (company_id, is_read, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**新建 GET /api/notices 接口：**

在 `src/routes/operations.routes.js` 添加路由，在 `src/services/operations.service.js` 添加 `listNotices` 函数：

```javascript
async function listNotices(companyId) {
  return db.query(
    `SELECT id, title, category, notice_type noticeType, target_view targetView,
            is_read isRead, created_at createdAt
     FROM hr_system_notice
     WHERE company_id = :companyId AND is_read = 0
     ORDER BY created_at DESC LIMIT 20`,
    { companyId }
  );
}
```

**修改前端 `loadOffice()`：**

将 `operationsHome()` 返回的 `notices` 硬编码数组替换为 `GET /api/notices` 的真实数据。同时修改 `bottomAuthedApp()` 中对 notices 的渲染。

**定时任务生成通知：**

在阶段三的定时风险扫描中，同时向 `hr_system_notice` 插入通知记录。

---

### 2.3 操作日志写入动态通知

**执行状态（2026-08-04）：已完成核心流程。** 已覆盖员工确认入职、合同登记、社保/雇主险变更、员工离职、风险扫描新增项、预支审批通过和工资条发布。

在以下 Service 层操作点追加通知写入（示例）：

| 触发操作 | 通知标题 | 类别 |
|---|---|---|
| 员工新签合同 | `${name} 劳动合同已登记` | 合同变更 |
| 合同到期30天内 | `${name} 合同即将到期` | 风险提醒 |
| 证件过期 | `${name} ${certType}已过期` | 风险提醒 |
| 社保停保 | `${name} 社保已停保` | 保险变动 |
| 预支审批通过 | `${name} 预支${amount}元已通过` | 预支审批 |
| 工资条发布 | `${month} 工资条已发布` | 薪资通知 |
| 整改逾期 | `${name} 风险整改已逾期` | 风险提醒 |

每个写入点示例：
```javascript
await connection.execute(
  `INSERT INTO hr_system_notice (company_id, title, category, notice_type, target_view)
   VALUES (:companyId, :title, :category, 'risk', :targetView)`,
  { companyId, title: `${employeeName} 合同即将到期`, category: '风险提醒', targetView: 'risk' }
);
```

---

## 阶段三：功能补全（P2）

### 3.1 附件上传

**执行状态（2026-08-04）：已完成待发布。** 已支持劳动合同、社保/雇主险、员工证件、风险整改证据上传；文件限制10MB并校验扩展名与MIME，使用随机存储名和SHA-256完整性摘要。上传、查询和下载均执行角色权限及员工数据范围校验，附件不通过静态目录公开。生产目录使用 Docker 持久化挂载，并与数据库按相同时间戳每日备份14天。

**安装：**
```bash
npm install multer
```

**新建文件：`src/middlewares/upload.middleware.js`**

```javascript
const multer = require('multer');
const path = require('path');

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'uploads'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error(`不支持的文件类型：${ext}`));
    }
    cb(null, true);
  }
});

module.exports = upload;
```

**新建目录：**
```bash
mkdir -p /Users/zhuhao/Documents/moluo/hr-roster-system/uploads
echo ".gitignore" > /Users/zhuhao/Documents/moluo/hr-roster-system/uploads/.gitkeep
```

**新建路由：`POST /api/attachments/upload`**

在 `src/routes/operations.routes.js` 添加：
```javascript
const upload = require('../middlewares/upload.middleware');
router.post('/attachments/upload', upload.single('file'), operationsController.uploadAttachment);
```

**新增数据库表（SQL 迁移文件）：`sql/migrate-attachments.mysql.sql`**

```sql
CREATE TABLE IF NOT EXISTS hr_attachment (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  biz_type VARCHAR(30) NOT NULL COMMENT '关联业务: contract/social/certificate/risk_case',
  biz_id INT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_size INT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_biz (company_id, biz_type, biz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**前端改造：**

在合同模态框（`#contractModal`）、社保模态框（`#socialModal`）、证件模态框（`#certificateModal`）、整改任务模态框（`#riskCaseModal`）中各添加一个文件上传区域。参考现有 `#employeeFileZone` 的拖拽上传实现。

上传函数示例：
```javascript
async function uploadAttachment(file, bizType, bizId) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('bizType', bizType);
  formData.append('bizId', String(bizId));
  const res = await fetch('/api/attachments/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}` },
    body: formData
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.message);
  return data.data;
}
```

**注意：** Docker 部署时 `uploads/` 目录需要挂载到宿主机持久化，修改 `docker-compose.prod.yml`：
```yaml
volumes:
  - ./uploads:/opt/moluo-hr/uploads
```

---

### 3.2 定时风险扫描

**执行状态（2026-08-04）：已完成待发布。** 已新增 `src/scheduler.js`、风险扫描日志迁移、生产容器中国时区配置，并移除登录时重复扫描。调度器每天北京时间02:00运行，单进程防重入；扫描失败按企业记录，不影响其他企业。

**安装：**
```bash
npm install node-cron
```

**新建文件：`src/scheduler.js`**

```javascript
const cron = require('node-cron');
const db = require('./db');

async function scanAllRisks() {
  console.log('[Scheduler] 开始定时风险扫描');
  // 1. 未签合同
  await checkUnsignedContracts();
  // 2. 合同即将到期（30天）
  await checkExpiringContracts();
  // 3. 合同已过期
  await checkExpiredContracts();
  // 4. 全职无社保
  await checkMissingSocialInsurance();
  // 5. 证件过期
  await checkExpiredCertificates();
  // 6. 特殊工种无证
  await checkMissingSpecialCerts();
  // 7. 离职停保提醒
  await checkResignedInsurance();

  // 8. 写入扫描日志
  await db.query(
    `INSERT INTO hr_risk_scan_log (company_id, scan_type, created_at) VALUES (1, 'scheduled', NOW())`
  );

  // 9. 高风险项写入通知
  await insertHighRiskNotices();

  console.log('[Scheduler] 风险扫描完成');
}

// 每天凌晨 2:00 执行
cron.schedule('0 2 * * *', scanAllRisks);

module.exports = { scanAllRisks };
```

**新建数据库表：`sql/migrate-risk-scan-log.mysql.sql`**

```sql
CREATE TABLE IF NOT EXISTS hr_risk_scan_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  scan_type VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  risk_count INT NOT NULL DEFAULT 0,
  new_risk_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_company_time (company_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**修改 `src/app.js`**，在文件末尾启动 scheduler（仅在生产模式下）：

```javascript
if (process.env.NODE_ENV === 'production') {
  require('./scheduler');
}
```

**前端改造：** `bootAuthedApp()` 中移除每次登录时的 `scanRisks()` 调用。保留手动"扫描风险"按钮。

---

### 3.3 Excel 导出升级（替换纯 CSV）

**执行状态（2026-08-06）：已完成待发布。** 保留 CSV，同时新增 `GET /api/export/employees.xlsx`。导出按企业和账号数据范围过滤，身份证号、手机号保持脱敏，三张 Sheet 均带表头样式、冻结首行和筛选；下载记录操作人、IP、筛选摘要、记录数与文件 SHA-256，不记录文件正文。

**安装：**
```bash
npm install exceljs
```

**修改：`GET /api/export/employees.xlsx`**

新增加一个 Excel 导出端点（保留原 CSV 端点作为快速导出选项）。

Excel 导出要求：
- Sheet 1 "基本信息"：姓名、性别、身份证号、电话、工作单位、岗位、用工模式、费用模式、入职日期、状态
- Sheet 2 "合同信息"：姓名、合同编号、合同类型、签署状态、开始日期、结束日期
- Sheet 3 "社保信息"：姓名、社保状态、参保城市、社保基数、公积金状态、公积金基数、雇主险、代缴供应商
- 表头行加粗、浅蓝背景色（#E3F2FD）
- 状态列按值着色（在职=绿、离职=红、待入职=蓝）
- 身份证号列宽 20、手机号列宽 15、日期列宽 12

**Service 层核心代码骨架：**
```javascript
const ExcelJS = require('exceljs');

async function exportEmployeesExcel(companyId, query, user) {
  const workbook = new ExcelJS.Workbook();
  // Sheet 1: 基本信息
  const sheet1 = workbook.addWorksheet('基本信息');
  sheet1.columns = [
    { header: '姓名', key: 'name', width: 10 },
    { header: '性别', key: 'gender', width: 6 },
    // ... 其余列
  ];
  // 表头样式
  sheet1.getRow(1).font = { bold: true };
  sheet1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
  // 数据行
  const employees = await getEmployeeList(companyId, query, user);
  for (const emp of employees) {
    sheet1.addRow({ name: emp.name, gender: emp.genderName, ... });
  }
  return workbook;
}
```

**前端按钮：** 在花名册面板头部增加"导出 XLSX"按钮，与现有"导出 CSV"并列。

---

### 3.4 图表升级（Chart.js）

**执行状态（2026-08-06）：已完成待发布。** 驾驶舱已拆到 `public/js/views/dashboard.js`；Chart.js 加载成功时渲染专业图表，加载失败时自动使用原 CSS 图表。默认关闭图表动画，仅 `?motion=1` 且用户未开启减少动态效果时播放。

**方案：** 使用 CDN 引入 Chart.js v4（不到 70KB gzipped），无需 npm install

**修改 `public/index.html`**，在 `<head>` 中添加：
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js" defer></script>
```

**修改 `public/js/views/dashboard.js`**，替换现有 CSS 手绘图表：

| 现有实现 | 替换为 | 说明 |
|---|---|---|
| `renderDepartmentChart()` CSS bar | Chart.js horizontal bar | 客户单位分布柱状图 |
| `renderEmploymentDonut()` CSS conic-gradient | Chart.js doughnut | 用工模式环形图 |
| `renderCompliance()` CSS ring | Chart.js doughnut（多个小环形） | 合规覆盖率 |
| `renderRiskTypes()` CSS stacked bar | Chart.js stacked horizontal bar | 风险类别处置 |
| `renderTrend()` CSS column bars | Chart.js line | 入离职趋势 |

每个 canvas 容器示例：
```html
<canvas id="departmentChartCanvas" height="200"></canvas>
```

Chart.js 初始化示例：
```javascript
new Chart(ctx, {
  type: 'bar',
  data: {
    labels: rows.map(r => r.name),
    datasets: [{
      data: rows.map(r => r.value),
      backgroundColor: '#326c8c'
    }]
  },
  options: {
    indexAxis: 'y',  // 水平柱状图
    plugins: { legend: { display: false } },
    responsive: true,
    maintainAspectRatio: false
  }
});
```

**保留 CSS 降级：** Chart.js 加载失败时，回退到现有 CSS 渲染。判断 `typeof Chart !== 'undefined'`。

---

## 阶段四：体验优化（P3）

### 4.1 主题持久化（替代 URL 参数）

**问题：** 当前主题通过 `?theme=tech-20260730` URL 参数切换，刷新后需重新添加。

**修改：**

1. **登录后**自动应用 localStorage 中保存的主题：
```javascript
const theme = localStorage.getItem('hrTheme') || 'default';
if (theme === 'tech') {
  document.querySelector('link[href="/theme-tech.css"]').disabled = false;
}
```

2. **在用户下拉菜单中增加主题切换入口**（或放在侧栏 footer）：
```html
<button class="theme-toggle" id="themeToggle">
  切换数据中枢主题
</button>
```

3. **样式处理：** `theme-tech.css` 默认 disabled，JS 控制启用。

---

### 4.2 移动端增强

**当前状态：** 移动端仅有 tabbar 快捷导航 + 花名册卡片列表 + 新增员工表单 + OCR 扫描。

**需补充：**

1. **员工详情页（移动端）：** 点击卡片展示可滑动的详情面板，包含基础信息、任职记录、合同简述、风险标记。参照现有桌面端 `renderDetail()` 简化。

2. **移动端审批操作：**
   - 预支审批：列表项滑动操作（通过/驳回）
   - 风险处理：点击进入处理表单
   - 工资签收：简单的确认按钮

3. **PWA 基础配置：**
   - 新建 `public/manifest.json`
   - 新建 `public/sw.js`（Service Worker 缓存 CSS/JS/字体）
   - `index.html` 添加 `<link rel="manifest" href="/manifest.json">`

---

### 4.3 表格增强

**执行状态（2026-08-07）：已完成待发布。** 花名册提供 17 列设置，序号、姓名和操作列固定保留，其余列可按需显示；偏好仅存储在浏览器本地，不保存员工数据。可点击表头或使用 Enter/空格键进行当前页中文排序，客户分组行和空数据行会随可见列数自动调整。

**花名册列显示/隐藏：**

在 `#filterForm` 下方增加"列设置"下拉：

```html
<div class="column-toggler">
  <button id="colToggleBtn" class="secondary-button">列设置 ▾</button>
  <div class="col-toggle-dropdown hidden" id="colToggleDropdown">
    <!-- 17 个 checkbox，默认勾选常用 6 列 -->
  </div>
</div>
```

实现逻辑：checkbox 变更时，切换对应 `th.col-xxx` 和 `td.col-xxx` 的 `display`。

**前端排序：**

表头 `<th>` 点击排序（当前页 100 条以内，前端排序足够）：

```javascript
let sortColumn = null;  // 当前排序列 key
let sortAsc = true;     // 升序/降序

function sortEmployees(col, key) {
  if (sortColumn === col) sortAsc = !sortAsc;
  else { sortColumn = col; sortAsc = true; }
  state.employees.sort((a, b) => {
    const va = (a[key] || '').toString();
    const vb = (b[key] || '').toString();
    return sortAsc ? va.localeCompare(vb, 'zh') : vb.localeCompare(va, 'zh');
  });
  renderEmployees();
}
```

---

## 阶段五：运维监控

### 5.1 健康检查增强

**执行状态（2026-08-06）：已完成待发布。** 使用参数化数据库查询验证 MySQL，返回数据库状态和 Node 运行时长；数据库异常时返回 HTTP 503，不执行系统命令、不暴露内部错误。

**修改 `src/app.js` 中 `GET /api/health`：**

```javascript
const db = require('./db');
app.get('/api/health', async (_req, res) => {
  try {
    const dbOk = await db.first('SELECT 1 AS ok');
    const diskUsage = require('child_process')
      .execSync("df -h / | tail -1 | awk '{print $5}'").toString().trim();
    res.json({
      code: 0, message: 'ok',
      data: {
        service: 'hr-roster-system',
        mode: 'express-mysql',
        db: dbOk ? 'connected' : 'error',
        diskUsage,
        uptime: Math.floor(process.uptime())
      }
    });
  } catch (err) {
    res.status(503).json({ code: 503, message: '服务异常', data: { error: err.message } });
  }
});
```

### 5.2 错误日志收集

**执行状态（2026-08-06）：已完成待发布。** 采用 Docker 标准输出收集结构化错误日志，便于腾讯云统一查看；不额外写容器内文件，避免日志卷丢失和同步阻塞。日志主动移除查询参数，不记录请求体、密码、Token、身份证号和银行卡号。

**新建文件：`src/middlewares/error-log.middleware.js`**

```javascript
const fs = require('fs');
const path = require('path');
const logPath = path.join(__dirname, '..', '..', 'logs', 'error.log');

// 确保日志目录存在
fs.mkdirSync(path.dirname(logPath), { recursive: true });

function errorLogger(err, req, _res, next) {
  const entry = {
    time: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 5).map(s => s.trim())
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  next(err);
}
module.exports = errorLogger;
```

**修改 `src/app.js`：** 在全局错误处理中间件前插入 `errorLogger`。

---

## 附录：SQL 迁移文件清单

按顺序执行（放在 `sql/` 目录下）：

| 文件名 | 用途 | 阶段 |
|---|---|---|
| `migrate-system-notices-20260804.mysql.sql` | 系统通知表 | 二 |
| `migrate-risk-scan-log-20260804.mysql.sql` | 风险扫描日志表 | 三 |
| `migrate-attachments-20260804.mysql.sql` | 附件表 | 三 |

所有迁移文件必须：
- 使用 `CREATE TABLE IF NOT EXISTS`（幂等）
- 字符集显式声明 `utf8mb4`
- 包含回滚注释

---

## 执行顺序建议

```
第 1 天：阶段一（安全加固）全部完成
         ├─ 1.1 SQL 注入修复（2h）
         ├─ 1.2 速率限制（1h）
         ├─ 1.3 CORS 配置（0.5h）
         └─ 1.4 npm audit fix（0.5h）

第 2-4 天：阶段二（前端重构）
         ├─ 2.1 app.js 拆分（8h）
         ├─ 2.2 通知动态化（4h）
         └─ 2.3 操作日志→通知（3h）

第 5-7 天：阶段三（功能补全）
         ├─ 3.1 附件上传（6h）
         ├─ 3.2 定时风险扫描（3h）
         ├─ 3.3 Excel 导出（4h）
         └─ 3.4 图表升级（4h）

第 8-9 天：阶段四（体验优化）
         ├─ 4.1 主题持久化（2h）
         ├─ 4.2 移动端增强（5h）
         └─ 4.3 表格增强（4h）

第 10 天：阶段五（运维监控）
         ├─ 5.1 健康检查增强（1h）
         └─ 5.2 错误日志（2h）
```

---

## 每次修改后验证

```bash
# 语法检查
npm run check

# 安全审计
npm audit --audit-level=high --omit=dev

# 生产部署前
bash scripts/build-release-package.sh
bash scripts/verify-release-package.sh
```

---

## 2026-08-07 页面体验与雇主险口径优化

**执行状态：已完成待发布。**

- Web 采用“工业数据中枢”视觉细节层，增加运行轨道、页面状态光带、滚动层级、面板渐入和按钮反馈。
- 顶部标题随业务页面切换，办公中心按北京时间和当前登录账号动态问候，不再固定显示企业管理员。
- 弹窗、表格、表单和移动 Web 增加统一交互反馈，同时支持键盘焦点与 `prefers-reduced-motion` 无障碍降级。
- 微信小程序增加页面进入、卡片分段和触控按压反馈，保持轻量且不改变业务流程。
- 页面、花名册、待办和小程序统一使用“雇主险增保 / 减保”口径，取消独立保险提示和社保公积金办理入口。
- 新增 `test/ui-polish.test.js`，校验资源加载、动态标题、动效降级、CSP 兼容、动态问候和小程序触控反馈。

### 小程序驻厂工作台增强

**执行状态（2026-08-07）：已完成待上传。**

- 小程序员工主入口调整为“驻厂”，默认展示当前权限范围内的正常在职员工。
- 首页新增驻厂人员管理和驻厂处理队列，可直达新员工录入、待入职、在职维护、离职交接及雇主险事项。
- 驻厂人员按客户单位和员工生命周期分类，支持待入职、在职、离职中、已离职快捷筛选。
- 员工卡片增加确认入职、编辑资料、雇主险增减、办理离职和继续离职交接操作，仍由后端权限与项目数据范围双重校验。
- 员工详情增加生命周期轨道，明确录入、到岗、在职、离职交接和归档状态。
- 离职页面支持继续更新工牌、工具、宿舍、考勤、工资结算进度，并联动雇主险减保；全部完成后自动归档为已离职。
- 修复历史社保状态阻塞离职完成的问题，离职保险条件仅判断雇主险是否已减保。
- 驻厂与薪资职责分离：驻厂/HR确认现场交接，薪资专员确认离职工资结算，后端按字段权限拦截越权修改。
- 待办页面只向具备对应权限的账号展示可执行按钮，避免无权限账号点击后才收到接口报错。
- 驻厂首页同时展示待处理和处理中事项，防止开始处理后的任务从移动队列消失。
- 入职后仅在账号具备雇主险权限时进入增保流程；雇主险普通入口不再自动预选增保或减保，降低误操作风险。
- 员工生命周期进度改为按合同、雇主险和真实离职交接完成项动态计算，不再使用固定展示值。

### 网页端与小程序数据关联统一

**执行状态（2026-08-07）：已完成待发布。**

- 桌面 Web、手机 Web 和微信小程序统一使用 `/employees`，员工可见范围全部由后端角色权限、部门范围和授权项目决定，不再使用手机 Web“仅本人录入”的独立口径。
- Web 和小程序均自动读取员工、工资预支的全部分页数据，避免超过 20 条或 200 条后出现人数、待办金额和状态统计不一致。
- 三端新增员工默认进入“待入职”，可明确选择“直接入职”；编辑员工档案时不允许通过普通资料表单覆盖员工生命周期状态。
- 三端统一识别 `OFFBOARDING` 为“离职交接中”，客户单位统计中的正常在职人数排除离职交接人员，并单列离职中数量。
- 客户、项目、员工、招聘渠道、雇主险、工资预支和工资批次继续使用同一套生产 REST API 与 MySQL 数据，不在前端保存独立业务副本。
- 新增 `test/cross-client-data-alignment.test.js`，持续校验 Web、小程序核心接口、字段、分页和状态口径，防止后续版本再次分叉。
