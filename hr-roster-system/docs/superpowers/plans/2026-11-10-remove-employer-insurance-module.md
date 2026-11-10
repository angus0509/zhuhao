# 雇主险模块下线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Web、手机 Web、微信小程序、API、权限、统计和导出中彻底下线雇主险业务，同时完整保留历史数据库记录。

**Architecture:** 使用兼容式下线：旧写接口保留路由但固定返回 HTTP 410；查询、统计和导出不再读取或返回雇主险字段；客户端删除所有可达入口。新增幂等迁移只停用权限并关闭开放事项，不删除表、列或历史记录。

**Tech Stack:** Vanilla JavaScript SPA、微信原生小程序、Node.js、Express 4、MySQL 8、Node `assert` 测试。

**Spec:** `docs/superpowers/specs/2026-11-10-remove-employer-insurance-module-design.md`

## Global Constraints

- 不执行 `DROP`、`DELETE`、`TRUNCATE`，不改写历史雇主险字段值。
- SQL 必须参数化；迁移必须幂等并限定未完成状态。
- 旧接口固定返回 HTTP `410`、`code: 410`、`message: "雇主险功能已停用"`，不得进入业务服务。
- 不改变员工到岗、在职、调岗、离职、考勤、工资条和人才库状态逻辑。
- 不改变企业、客户、项目和角色数据隔离。
- 微信小程序源码独立发布；本计划不授权上传、部署或生产迁移。
- 当前工作区已有工资条和花名册修改；每个提交只暂存本任务列出的文件或精确代码块。
- 每个任务在提交前执行一次规格复核和一次代码质量复核，二者都通过后才能提交。

## File Structure

- `src/routes/employee.routes.js`：旧合同/雇主险写接口的 410 兼容层。
- `src/services/employee.service.js`：员工列表、详情、生命周期和导出，不再读取或派生雇主险。
- `src/services/operations.service.js`、`src/services/portal.service.js`：运营、项目和驾驶舱统计去除雇主险。
- `src/services/risk.service.js`、`src/services/notice.service.js`、`src/services/work-task.service.js`：停止雇主险风险、通知和待办行为，仅保留历史关闭兼容。
- `src/services/attachment.service.js`、`src/utils/dictionaries.js`、`src/middlewares/auth.middleware.js`：停用雇主险附件类型、字典和权限文案。
- `public/js/views/roster.js`、`public/app.js`、`public/layout-refine.css`、`public/ui-polish.css`：Web/手机 Web 去除雇主险展示和样式。
- `wechat-miniprogram/miniprogram/app.json`、`wechat-miniprogram/miniprogram/pages/employees/**`：小程序去除雇主险页面、字段和导航。
- `sql/migrate-disable-employer-insurance-module-20261110.mysql.sql`、`sql/seed.mysql.sql`：停用权限和开放事项，保留历史数据。
- `test/employer-insurance-module-removal.test.js`：统一的无入口、无返回字段、无导出项和 410 契约。

---

### Task 1: 锁定旧接口停用契约

**Files:**
- Create: `test/employer-insurance-module-removal.test.js`
- Modify: `src/routes/employee.routes.js:6-40`

**Interfaces:**
- Consumes: Express `router`、已有 `requireAuth` 和 `sensitiveLimiter`。
- Produces: `featureDisabled(_req, res)` 固定响应 `{ code: 410, message: '雇主险功能已停用', data: null }`；旧 URL 保持注册。

- [ ] **Step 1: 写失败测试**

在 `test/employer-insurance-module-removal.test.js` 中加载路由源并以伪 `res` 调用导出的测试钩子，断言状态和响应，同时断言服务方法未执行：

```js
const assert = require('node:assert/strict');
const { _testing } = require('../src/routes/employee.routes');

let statusCode = 0;
let payload = null;
const res = {
  status(code) { statusCode = code; return this; },
  json(body) { payload = body; return body; }
};

_testing.featureDisabled({}, res);
assert.equal(statusCode, 410);
assert.deepEqual(payload, { code: 410, message: '雇主险功能已停用', data: null });
console.log('employer-insurance-module-removal-route-tests-ok');
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `node test/employer-insurance-module-removal.test.js`

Expected: FAIL，因为路由尚未导出 `_testing`，且当前提示仍是“功能已停用”。

- [ ] **Step 3: 最小实现 410 兼容层**

在 `src/routes/employee.routes.js` 保留三条历史路由，并改为：

```js
const featureDisabled = (_req, res) => res.status(410).json({
  code: 410,
  message: '雇主险功能已停用',
  data: null
});

module.exports = router;
module.exports._testing = { featureDisabled };
```

不得恢复 `controller.confirmOnboardingCompliance` 或 `controller.updateSocialSecurity` 绑定。

- [ ] **Step 4: 运行任务测试和路由回归**

Run: `node test/employer-insurance-module-removal.test.js && node test/security-hardening.test.js && node test/disabled-contract-insurance-flow.test.js`

Expected: 全部 PASS；旧 URL 仍注册且只能返回 410。

- [ ] **Step 5: 双重复核并提交**

规格复核：确认没有删除路由、没有调用服务、响应文案准确。质量复核：确认无敏感数据回显、无新权限绕过。

```bash
git add src/routes/employee.routes.js test/employer-insurance-module-removal.test.js
git diff --cached --check
git commit -m "fix: retire employer insurance write routes"
```

---

### Task 2: 去除员工查询、生命周期和导出中的雇主险

**Files:**
- Modify: `src/services/employee.service.js:150-175,560-730,920-960,1490-1640,2590-2870,2930-3120`
- Modify: `src/controllers/employee.controller.js:145-180`
- Modify: `src/services/attachment.service.js:1-20`
- Modify: `src/utils/dictionaries.js:30-40`
- Modify: `test/employee-pagination-contract.test.js`
- Modify: `test/excel-export.test.js`
- Modify: `test/excel-export-workbook.test.js`
- Modify: `test/attachment-contract.test.js`
- Modify: `test/employer-insurance-module-removal.test.js`

**Interfaces:**
- Consumes: `listEmployees(companyId, query, user, options)` 和现有 CSV/XLSX 导出入口。
- Produces: 员工响应不含 `employerInsurance*`、客户汇总不含 `insuranceGapCount`、导出不含雇主险列或工作表；`attachmentService` 不接受新 `social` 类型附件。

- [ ] **Step 1: 扩充失败测试**

为统一测试增加递归字段检查，并调用真实格式化/导出边界：

```js
function assertNoEmployerInsurance(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /employerInsurance|insuranceGapCount|雇主险/);
}

assertNoEmployerInsurance(employeeListResult);
assertNoEmployerInsurance(employeeDetailResult);
assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['基本信息', '合同信息']);
```

将 `test/employee-pagination-contract.test.js` 的客户汇总期望改为：

```js
assert.deepEqual(result.customerStats, [{
  customerId: 7,
  customerName: '客户A',
  employeeCount: 1080,
  activeCount: 1080,
  riskCount: 3
}]);
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `node test/employee-pagination-contract.test.js && node test/excel-export-workbook.test.js && node test/attachment-contract.test.js && node test/employer-insurance-module-removal.test.js`

Expected: FAIL，失败点分别为客户汇总、员工响应、雇主险工作表或 `social` 附件类型仍存在。

- [ ] **Step 3: 删除员工读取与派生字段**

在 `formatEmployeeRow`、员工列表 SQL、员工详情 SQL 和客户汇总 SQL 中移除：

```text
employer_insurance_status
employer_insurer
employer_policy_no
employer_start_date
employer_end_date
employer_insured_amount
insuranceGapCount
```

客户汇总返回固定结构：

```js
{
  customerId,
  customerName,
  employeeCount,
  activeCount,
  riskCount
}
```

删除 `confirmOnboardingCompliance`、`updateSocialSecurity` 和 `terminateEmployerInsuranceForResignation` 的可执行服务代码；离职事务不得读取或更新雇主险字段。

- [ ] **Step 4: 清理导出与附件入口**

CSV 表头改为：

```js
['姓名', '手机号', '客户单位', '岗位', '用工模式', '费用模式', '工资类型', '入职日期', '合同状态', '风险数', '员工状态']
```

XLSX 仅保留“基本信息”和“合同信息”，删除“雇主险信息”工作表查询和生成。删除 `attachment.service.js` 的 `social` 类型映射，并从字典中删除 `employer_insurance`。

- [ ] **Step 5: 运行任务回归**

Run: `node test/employee-pagination-contract.test.js && node test/excel-export.test.js && node test/excel-export-workbook.test.js && node test/attachment-contract.test.js && node test/simplified-resignation-flow.test.js && node test/one-click-resignation-flow.test.js && node test/employer-insurance-module-removal.test.js`

Expected: 全部 PASS；离职不再依赖雇主险，历史数据库字段未被更新。

- [ ] **Step 6: 双重复核并提交**

规格复核：确认 API、CSV、XLSX 和生命周期全部不含雇主险。质量复核：检查 SQL 参数化、数据范围和身份证等敏感字段输出未变化。

```bash
git add src/services/employee.service.js src/controllers/employee.controller.js src/services/attachment.service.js src/utils/dictionaries.js test/employee-pagination-contract.test.js test/excel-export.test.js test/excel-export-workbook.test.js test/attachment-contract.test.js test/employer-insurance-module-removal.test.js
git diff --cached --check
git commit -m "refactor: remove employer insurance employee data flow"
```

---

### Task 3: 去除运营统计、风险、通知和待办逻辑

**Files:**
- Modify: `src/services/operations.service.js:230-275,2440-2520`
- Modify: `src/services/portal.service.js:390-470`
- Modify: `src/services/risk.service.js:1-310`
- Modify: `src/services/notice.service.js`
- Modify: `src/services/work-task.service.js`
- Modify: `test/disabled-contract-insurance-flow.test.js`
- Modify: `test/removed-compliance-flow.test.js`
- Modify: `test/risk-center-unified.test.js`
- Modify: `test/web-simplified-risk-workflow.test.js`
- Modify: `test/employer-insurance-module-removal.test.js`

**Interfaces:**
- Consumes: 运营首页、驾驶舱、风险扫描、通知和待办查询。
- Produces: 所有新响应和新副作用不含雇主险；历史开放记录只允许关闭，不允许重新打开或生成。

- [ ] **Step 1: 写失败测试**

在统一测试中调用运营和门户服务的现有测试边界，断言：

```js
assert.equal('uninsuredCount' in operationsSummary, false);
assert.equal('employerInsuranceRate' in portalSummary, false);
assert.equal(generatedRisks.some(item => Number(item.riskType) === 7), false);
assert.equal(generatedTasks.some(item => ['INSURANCE', 'INSURANCE_TERMINATION'].includes(item.taskType)), false);
```

将旧测试从“仍可扫描/重新打开雇主险风险”改为“风险类型 7 永不新建或重新打开”。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node test/risk-center-unified.test.js && node test/disabled-contract-insurance-flow.test.js && node test/employer-insurance-module-removal.test.js`

Expected: FAIL，因为运营和门户仍返回雇主险指标，风险服务仍含扫描查询。

- [ ] **Step 3: 最小删除运营和门户统计**

从 SQL 和返回对象中移除：

```text
uninsuredCount
employerInsuranceCount
employerInsuranceRate
insuranceGapCount
```

不得以常量 `0` 或 `100` 伪装保留字段；字段必须从响应结构中消失。

- [ ] **Step 4: 删除风险、通知和待办生成路径**

删除 `scanEmployerInsurance` 及其调用，删除 `INSURANCE`、`INSURANCE_TERMINATION` 的行动映射和新建逻辑。保留关闭历史开放记录的兼容更新，并确保条件仅匹配未完成状态。

通知服务继续过滤历史雇主险通知，但不得生成新通知。

- [ ] **Step 5: 运行任务回归**

Run: `node test/disabled-contract-insurance-flow.test.js && node test/removed-compliance-flow.test.js && node test/risk-center-unified.test.js && node test/web-simplified-risk-workflow.test.js && node test/operational-monitoring.test.js && node test/employer-insurance-module-removal.test.js`

Expected: 全部 PASS；响应无雇主险指标，新风险/待办/通知为 0。

- [ ] **Step 6: 双重复核并提交**

规格复核：确认只保留历史关闭兼容。质量复核：确认没有扩大查询范围、没有删除历史记录、没有修改其他风险类型。

```bash
git add src/services/operations.service.js src/services/portal.service.js src/services/risk.service.js src/services/notice.service.js src/services/work-task.service.js test/disabled-contract-insurance-flow.test.js test/removed-compliance-flow.test.js test/risk-center-unified.test.js test/web-simplified-risk-workflow.test.js test/employer-insurance-module-removal.test.js
git diff --cached --check
git commit -m "refactor: remove employer insurance operations logic"
```

---

### Task 4: 清理 Web 与手机 Web 展示

**Files:**
- Modify: `public/js/views/roster.js:1-230`
- Modify: `public/app.js`
- Modify: `public/layout-refine.css:960-1010`
- Modify: `public/ui-polish.css:350-380`
- Modify: `test/web-roster-pagination-runtime.test.js`
- Modify: `test/roster-customer-grouping.test.js`
- Modify: `test/cross-client-data-alignment.test.js`
- Modify: `test/employer-insurance-module-removal.test.js`

**Interfaces:**
- Consumes: Task 2 的客户汇总 `{ customerId, customerName, employeeCount, activeCount, riskCount }`。
- Produces: Web 客户卡只显示在职人数和风险数；页面源码不存在雇主险入口、字段或样式。

- [ ] **Step 1: 写失败的运行时测试**

将 `test/web-roster-pagination-runtime.test.js` 的客户汇总夹具改为不含 `insuranceGapCount`，并断言渲染内容：

```js
assert.match(elements['#customerRosterRail'].innerHTML, /风险 2/);
assert.doesNotMatch(elements['#customerRosterRail'].innerHTML, /雇主险|保险/);
assert.equal(context.state.employees.length, 50);
```

统一测试再扫描实际可加载的 Web 文件，断言不含业务标识：

```js
for (const source of [appSource, rosterSource, layoutCss, polishCss]) {
  assert.doesNotMatch(source, /雇主险|employerInsurance|insuranceGapCount/);
}
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `node test/web-roster-pagination-runtime.test.js && node test/roster-customer-grouping.test.js && node test/employer-insurance-module-removal.test.js`

Expected: FAIL，因为花名册客户卡仍渲染雇主险缺口，CSS 仍含旧模块样式。

- [ ] **Step 3: 最小清理 Web**

在 `renderCustomerRosterRail()` 中只保留：

```js
const risks = Number(group.riskCount || 0);
return `<button ...><span>${escapeHtml(group.customerName)}</span><strong>${active}<small>人在职</small></strong><div><em class="${risks ? 'risk' : ''}">风险 ${risks}</em></div></button>`;
```

删除 `public/app.js` 中雇主险通知关键词以外的业务字段和动作；历史消息过滤可使用通用停用类别集合，不恢复入口。删除只服务于已移除表单的 CSS。

- [ ] **Step 4: 运行 Web 回归**

Run: `node test/web-roster-pagination-runtime.test.js && node test/roster-customer-grouping.test.js && node test/cross-client-data-alignment.test.js && node test/web-simplified-onsite-flow.test.js && node test/frontend-core-split.test.js && node test/employer-insurance-module-removal.test.js`

Expected: 全部 PASS；1080 人首屏仍只渲染 50 人。

- [ ] **Step 5: 双重复核并提交**

规格复核：确认 Web、手机 Web 无可见雇主险内容。质量复核：确认分页、客户筛选、风险数、导出链接和工资条改动未受影响。

```bash
git add public/js/views/roster.js public/app.js public/layout-refine.css public/ui-polish.css test/web-roster-pagination-runtime.test.js test/roster-customer-grouping.test.js test/cross-client-data-alignment.test.js test/employer-insurance-module-removal.test.js
git diff --cached --check
git commit -m "refactor: remove employer insurance web surfaces"
```

---

### Task 5: 下线微信小程序雇主险页面

**Files:**
- Modify: `wechat-miniprogram/miniprogram/app.json`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/detail/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml`
- Delete: `wechat-miniprogram/miniprogram/pages/employees/insurance/index.js`
- Delete: `wechat-miniprogram/miniprogram/pages/employees/insurance/index.json`
- Delete: `wechat-miniprogram/miniprogram/pages/employees/insurance/index.wxml`
- Delete: `wechat-miniprogram/miniprogram/pages/employees/insurance/index.wxss`
- Modify: `test/miniprogram-employee-core.test.js`
- Modify: `test/miniprogram-contract-save-fix.test.js`
- Modify: `test/miniprogram-onsite-fast-processing.test.js`
- Modify: `test/miniprogram-simplified-onsite-flow.test.js`
- Modify: `test/employer-insurance-module-removal.test.js`

**Interfaces:**
- Consumes: Task 1 的旧接口 410 兼容；Task 2 的无雇主险员工响应。
- Produces: 新小程序包中不存在雇主险页面注册、跳转、状态或展示。

- [ ] **Step 1: 写失败测试**

将小程序契约改为：

```js
assert.doesNotMatch(appJson, /pages\/employees\/insurance\/index/);
assert.equal(fs.existsSync(path.join(miniRoot, 'pages/employees/insurance/index.js')), false);
for (const source of [employeesJs, employeesWxml, detailJs, detailWxml]) {
  assert.doesNotMatch(source, /雇主险|employerInsurance|insuranceComplete|insuranceGapCount|goInsurance/);
}
```

删除旧测试中要求 `ACTION_VALUES`、`employerInsuranceAction` 或合同保存后跳转雇主险的断言。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node test/miniprogram-employee-core.test.js && node test/miniprogram-contract-save-fix.test.js && node test/employer-insurance-module-removal.test.js`

Expected: FAIL，因为页面仍注册或源码仍包含雇主险状态。

- [ ] **Step 3: 删除可达入口和页面文件**

从 `app.json` 删除页面注册；从员工列表和详情删除雇主险字段、计算、筛选、按钮及跳转。删除四个页面文件，但不得删除上传目录、历史附件或其他员工页面。

- [ ] **Step 4: 运行小程序契约**

Run: `node scripts/check-miniprogram-contracts.js && node test/miniprogram-employee-core.test.js && node test/miniprogram-contract-save-fix.test.js && node test/miniprogram-onsite-fast-processing.test.js && node test/miniprogram-simplified-onsite-flow.test.js && node test/miniprogram-manager-page-guard.test.js && node test/employer-insurance-module-removal.test.js`

Expected: 全部 PASS，小程序页面清单无失效路径。

- [ ] **Step 5: 双重复核并提交**

规格复核：确认所有入口和路由已移除。质量复核：确认员工查看、编辑、确认入职和离职仍可用，且未修改小程序版本号或上传平台。

```bash
git add wechat-miniprogram/miniprogram/app.json wechat-miniprogram/miniprogram/pages/employees test/miniprogram-employee-core.test.js test/miniprogram-contract-save-fix.test.js test/miniprogram-onsite-fast-processing.test.js test/miniprogram-simplified-onsite-flow.test.js test/employer-insurance-module-removal.test.js
git diff --cached --check
git commit -m "refactor: remove employer insurance mini program pages"
```

---

### Task 6: 停用权限并关闭开放事项

**Files:**
- Create: `sql/migrate-disable-employer-insurance-module-20261110.mysql.sql`
- Modify: `sql/seed.mysql.sql:90-165`
- Modify: `src/middlewares/auth.middleware.js:85-100`
- Modify: `test/role-catalog.test.js`
- Modify: `test/release-migration-consistency.test.js`
- Modify: `test/employer-insurance-module-removal.test.js`

**Interfaces:**
- Consumes: `social:manage` 权限代码、历史 `INSURANCE`/`INSURANCE_TERMINATION`/`ONBOARDING_COMPLIANCE` 待办和风险类型 7。
- Produces: 新环境不再授予雇主险权限；存量环境幂等停用权限并关闭开放事项；历史记录和值保留。

- [ ] **Step 1: 写失败迁移契约**

测试必须读取迁移并断言：

```js
assert.match(sql, /permission_code='social:manage'/);
assert.match(sql, /status=0/);
assert.match(sql, /task_type IN \('INSURANCE','INSURANCE_TERMINATION','ONBOARDING_COMPLIANCE'\)/);
assert.match(sql, /risk_type=7/);
assert.doesNotMatch(sql, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.doesNotMatch(sql, /employer_insurance_status\s*=/i);
```

角色测试改为断言默认角色不再包含 `'social:manage'`。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node test/role-catalog.test.js && node test/release-migration-consistency.test.js && node test/employer-insurance-module-removal.test.js`

Expected: FAIL，因为迁移不存在且 seed 仍授予 `social:manage`。

- [ ] **Step 3: 编写幂等迁移**

迁移只允许以下更新：

```sql
UPDATE sys_permission
SET status=0
WHERE permission_code='social:manage' AND status<>0;

UPDATE hr_work_task
SET task_status=3, completed_at=COALESCE(completed_at,NOW()), updated_at=NOW()
WHERE task_type IN ('INSURANCE','INSURANCE_TERMINATION','ONBOARDING_COMPLIANCE')
  AND task_status IN (0,1);

UPDATE hr_risk_alert
SET handle_status=2, handle_time=COALESCE(handle_time,NOW()),
    handle_remark='功能已停用：雇主险事项已关闭', updated_at=NOW()
WHERE risk_type=7 AND handle_status IN (0,1);
```

`sys_role_permission` 没有状态字段，且认证服务已通过 `sys_permission.status=1` 过滤有效权限，因此迁移保留角色关联，不执行删除。迁移不得更新 `hr_social_security`。

- [ ] **Step 4: 更新新环境 seed 和权限文案**

从默认角色权限集合移除 `social:manage`，将该权限 seed 为停用状态。删除认证中间件的“合同或雇主险”专用提示，保留通用最小权限错误。

- [ ] **Step 5: 运行迁移与权限测试**

Run: `node test/role-catalog.test.js && node test/release-migration-consistency.test.js && node test/high-risk-security.test.js && node test/p1-security-hardening.test.js && node test/employer-insurance-module-removal.test.js && bash -n scripts/deploy-production.sh`

Expected: 全部 PASS；迁移无危险语句，默认角色无雇主险权限。

- [ ] **Step 6: 双重复核并提交**

规格复核：确认历史数据字段和记录完全保留。质量复核：逐条审查 SQL 条件、幂等性和多企业影响，确认仅关闭指定类型的开放事项。

```bash
git add sql/migrate-disable-employer-insurance-module-20261110.mysql.sql sql/seed.mysql.sql src/middlewares/auth.middleware.js test/role-catalog.test.js test/release-migration-consistency.test.js test/employer-insurance-module-removal.test.js
git diff --cached --check
git commit -m "chore: disable employer insurance permissions"
```

---

### Task 7: 全量验证与发布边界确认

**Files:**
- Modify only if a failing regression proves a requirement gap; do not perform unrelated cleanup.

**Interfaces:**
- Consumes: Tasks 1-6 的代码和独立提交。
- Produces: 可供发布审核的本地候选版本；不执行推送、迁移、部署或小程序上传。

- [ ] **Step 1: 搜索残留业务引用**

Run:

```bash
rg -n "雇主险|employerInsurance|employer_insurance|insuranceGapCount|insuranceComplete|social:manage|employees/insurance" public src wechat-miniprogram/miniprogram sql/seed.mysql.sql
```

Expected: 仅允许出现于 410 兼容注释/提示、历史数据字段兼容和明确的停用迁移；不得出现可执行写入、客户端入口、统计、返回字段或导出。

- [ ] **Step 2: 运行全量检查**

Run: `npm run check`

Expected: exit 0，所有 Web、API、小程序、权限、工资条、考勤、数据隔离测试通过。

- [ ] **Step 3: 运行安全与差异检查**

Run: `npm audit --audit-level=high && git diff --check`

Expected: 0 个 high/critical 漏洞；无空白错误。

- [ ] **Step 4: 验证工作区边界**

Run: `git status --short --branch && git log --oneline -8`

Expected: 雇主险任务形成独立提交；工资条和花名册既有修改没有被误纳入错误提交。

- [ ] **Step 5: 双重复核并形成交付报告**

规格复核逐项对照设计文档第 2-9 节；质量复核检查 API 兼容、SQL 安全、数据隔离、旧小程序行为和导出结果。报告必须分别写明：本地修改、提交、推送、数据库迁移、Web/API 部署、小程序上传、生产验收的状态。

- [ ] **Step 6: 停在发布确认门槛**

不执行 `git push`、生产 SSH、数据库迁移、Web/API 部署或微信小程序上传。将验证证据交给用户，等待下一次明确授权。
