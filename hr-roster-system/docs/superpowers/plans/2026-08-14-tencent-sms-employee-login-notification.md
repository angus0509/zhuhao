# Tencent SMS Employee Login and Payslip Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure employee SMS-code login plus asynchronous Tencent Cloud payslip publication, reminder, and retry notifications that open the mini-program payslip list through a safe URL Link.

**Architecture:** Use the installed Tencent Cloud Node SDK behind a focused provider adapter. Store only HMAC hashes for verification codes and phone/IP matching; store notification jobs in MySQL and process them with the existing scheduler so SMS failure never rolls back payroll publication. The SMS URL Link is a fixed production mini-program link with no employee, payslip, salary, or login-token parameters.

**Tech Stack:** Node.js 22, Express 4, MySQL 8, `tencentcloud-sdk-nodejs` SMS v20210111, native WeChat mini-program, existing scheduler and JWT stack.

**Spec:** `docs/superpowers/specs/2026-08-14-tencent-sms-employee-login-notification-design.md`

## Global Constraints

- Do not send real SMS during automated tests or local development.
- Keep `TENCENT_SMS_ENABLED=false` by default.
- Do not commit Git, deploy Tencent Cloud, upload the mini-program, or modify `data/db.json` in this implementation session.
- Never store or log plaintext verification codes, full phone numbers, SecretId, SecretKey, JWTs, salary amounts, ID-card numbers, or bank-card numbers.
- Employee existence must not be enumerable from the public SMS-code endpoint.
- An employee can receive a login session only while `employee_status=2` and `deleted_at IS NULL`.
- All employee salary reads derive `employeeId` from the signed employee token.
- All SMS and payroll SQL must include `company_id`; manager endpoints must preserve existing project data scope.
- Payroll publication must succeed even if Tencent Cloud SMS is disabled or unavailable.
- Follow TDD: write and run a focused failing test before each production behavior.

---

## File Structure

### Create

- `sql/migrate-tencent-sms-20260814.mysql.sql`: idempotent verification-code and delivery-job schema.
- `src/services/tencent-sms.service.js`: Tencent SMS SDK adapter and safe result normalization.
- `src/services/employee-sms-auth.service.js`: code issuance, verification, limits, audit, and employee session creation.
- `src/services/sms-delivery.service.js`: job enqueue, summary, reminder, retry, claim, send, and backoff logic.
- `src/controllers/sms.controller.js`: public employee SMS handlers.
- `src/routes/sms.routes.js`: public SMS login routes with login limiter.
- Focused tests named in each task.

### Modify

- `.env.production.example`, `src/config/env.js`: SMS settings and safe production validation.
- `sql/schema.mysql.sql`, `scripts/deploy-production.sh`, `scripts/verify-release-package.sh`: canonical and release schema.
- `src/services/employee-auth.service.js`: expose reusable employee-account/session helpers without weakening WeChat binding.
- `src/routes/index.js`: mount public SMS routes.
- `src/services/operations.service.js`, `src/controllers/operations.controller.js`, `src/routes/operations.routes.js`: publish enqueue and management endpoints.
- `src/scheduler.js`: process pending SMS jobs with overlap protection.
- `public/index.html`, `public/app.js`, `public/styles.css`: payroll SMS summary and confirmed actions.
- `wechat-miniprogram/miniprogram/pages/login/index.js`, `.wxml`, `.wxss`: SMS login form and countdown.
- `wechat-miniprogram/miniprogram/app.js`, `wechat-miniprogram/miniprogram/pages/payroll/index.js`: preserve pending payslip destination across login.
- `package.json`: add focused tests to `npm run check`.

---

### Task 1: Add SMS Schema, Configuration, and Release Contracts

**Files:**
- Create: `sql/migrate-tencent-sms-20260814.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `.env.production.example`
- Modify: `src/config/env.js`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Test: `test/tencent-sms-schema-config.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `env.tencentSms`, `env.smsCode`, `employee_sms_verification`, `sms_delivery_job`.
- Consumes: existing environment parsing, migration runner, and release-package audit conventions.

- [ ] **Step 1: Write the failing schema/config contract test**

The test must assert both migration and canonical schema contain the two tables, required indexes, no destructive SQL, all environment names, deployment inclusion, and `TENCENT_SMS_ENABLED=false` in the example.

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('sql/migrate-tencent-sms-20260814.mysql.sql', 'utf8');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const envSource = fs.readFileSync('src/config/env.js', 'utf8');
const envExample = fs.readFileSync('.env.production.example', 'utf8');
const deploy = fs.readFileSync('scripts/deploy-production.sh', 'utf8');

for (const source of [migration, schema]) {
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_sms_verification/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?sms_delivery_job/);
  assert.match(source, /uk_company_dedupe/);
  assert.match(source, /idx_pending/);
}
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
for (const name of [
  'TENCENT_SMS_ENABLED', 'TENCENT_SMS_REGION', 'TENCENT_SMS_SDK_APP_ID',
  'TENCENT_SMS_SIGN_NAME', 'TENCENT_SMS_TEMPLATE_LOGIN_CODE',
  'TENCENT_SMS_TEMPLATE_PAYSLIP_PUBLISHED', 'TENCENT_SMS_TEMPLATE_PAYSLIP_REMINDER',
  'TENCENT_SMS_PAYSLIP_URL_LINK', 'SMS_CODE_HMAC_SECRET'
]) {
  assert.match(envSource, new RegExp(name));
  assert.match(envExample, new RegExp(`^${name}=`, 'm'));
}
assert.match(envExample, /^TENCENT_SMS_ENABLED=false$/m);
assert.match(deploy, /migrate-tencent-sms-20260814\.mysql\.sql/);
console.log('tencent-sms-schema-config-tests-ok');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/tencent-sms-schema-config.test.js`

Expected: FAIL because the migration and SMS config do not exist.

- [ ] **Step 3: Implement the idempotent migration and canonical schema**

Create the exact columns and indexes from design sections 5.1 and 5.2. Use `CREATE TABLE IF NOT EXISTS`, `utf8mb4_unicode_ci`, `DATETIME`, and an enterprise-scoped unique dedupe key. Do not add foreign keys that could block existing delete/offboarding flows.

- [ ] **Step 4: Add configuration objects**

```js
tencentSms: {
  enabled: String(process.env.TENCENT_SMS_ENABLED || 'false').toLowerCase() === 'true',
  region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
  sdkAppId: process.env.TENCENT_SMS_SDK_APP_ID || '',
  signName: process.env.TENCENT_SMS_SIGN_NAME || '',
  templates: {
    loginCode: process.env.TENCENT_SMS_TEMPLATE_LOGIN_CODE || '',
    payslipPublished: process.env.TENCENT_SMS_TEMPLATE_PAYSLIP_PUBLISHED || '',
    payslipReminder: process.env.TENCENT_SMS_TEMPLATE_PAYSLIP_REMINDER || ''
  },
  payslipUrlLink: process.env.TENCENT_SMS_PAYSLIP_URL_LINK || ''
},
smsCode: {
  hmacSecret: process.env.SMS_CODE_HMAC_SECRET || '',
  ttlSeconds: 300,
  resendSeconds: 60,
  maxDailySends: 10,
  maxHourlyIpRequests: 20,
  maxAttempts: 5
}
```

Production validation checks SMS fields only when `tencentSms.enabled` is true. `SMS_CODE_HMAC_SECRET` must be at least 32 bytes when enabled. Existing production startup remains unchanged while SMS is disabled.

- [ ] **Step 5: Wire release scripts and check script**

Add the migration to deployment immediately after employee-login migrations, add it to release-package required and destructive-keyword checks, and add the focused test near the employee authentication tests in `package.json`.

- [ ] **Step 6: Run focused validation**

Run:

```bash
node test/tencent-sms-schema-config.test.js
node test/release-migration-consistency.test.js
node test/release-candidate-manifest.test.js
npm run lint
```

Expected: all PASS.

- [ ] **Step 7: Review checkpoint**

Inspect only Task 1 files with `git diff --check`; do not commit.

---

### Task 2: Implement the Tencent SMS Provider Adapter

**Files:**
- Create: `src/services/tencent-sms.service.js`
- Test: `test/tencent-sms-service.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `env.tencentSms`, `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, installed Tencent SDK.
- Produces: `createTencentSmsService(dependencies)`, `sendTemplate({ phone, templateKey, params })`, `normalizePhone(phone)`.

- [ ] **Step 1: Write provider behavior tests**

Tests cover domestic phone normalization, disabled configuration, template allow-listing, successful response normalization, Tencent rejection, timeout/error sanitization, and absence of secrets/full phone in errors.

```js
const service = createTencentSmsService({
  config: {
    enabled: true,
    region: 'ap-guangzhou',
    sdkAppId: '1400000000',
    signName: '优益数字化',
    templates: { loginCode: '100001' }
  },
  createClient: () => ({
    SendSms: async request => ({
      RequestId: 'request-1',
      SendStatusSet: [{ Code: 'Ok', Message: 'send success', SerialNo: 'serial-1' }]
    })
  })
});
const result = await service.sendTemplate({
  phone: '13800000000', templateKey: 'loginCode', params: ['123456', '5']
});
assert.deepEqual(result, {
  accepted: true, providerCode: 'Ok', providerMessage: 'send success',
  requestId: 'request-1', serialNo: 'serial-1'
});
```

- [ ] **Step 2: Run provider test and verify RED**

Run: `node test/tencent-sms-service.test.js`

Expected: FAIL because the provider module does not exist.

- [ ] **Step 3: Implement minimal adapter**

Use `tencentcloud.sms.v20210111.Client`. Construct the client lazily so disabled SMS does not require usable cloud credentials. `sendTemplate` accepts only configured template keys and sends one phone per call. Return normalized data; throw exposed 503 for disabled/misconfigured service and sanitized 502 for provider transport failure.

- [ ] **Step 4: Run focused validation**

Run:

```bash
node test/tencent-sms-service.test.js
node --check src/services/tencent-sms.service.js
npm run lint
```

Expected: all PASS and no real network call.

- [ ] **Step 5: Review checkpoint**

Search the new file for `console`, full test phone values outside tests, and direct secret interpolation. Do not commit.

---

### Task 3: Implement Secure Employee SMS-Code Authentication

**Files:**
- Create: `src/services/employee-sms-auth.service.js`
- Create: `src/controllers/sms.controller.js`
- Create: `src/routes/sms.routes.js`
- Modify: `src/services/employee-auth.service.js`
- Modify: `src/routes/index.js`
- Test: `test/employee-sms-auth.test.js`
- Test: `test/employee-sms-enumeration-security.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `smsProvider.sendTemplate`, `env.smsCode`, existing employee session and account rules.
- Produces: `requestLoginCode(companyId, body, meta)`, `loginByCode(companyId, body, meta)`.

- [ ] **Step 1: Write failing issuance and verification tests**

Tests must use an injected fake provider and fake database. Assert code HMAC storage, 5-minute expiry, 60-second resend, daily/IP limits, uniform public response, five-attempt lock, atomic consume, replay rejection, active employee check, and `accountType=EMPLOYEE` result.

```js
const response = await service.requestLoginCode(1, { phone: '13800000000' }, { ipAddress: '127.0.0.1' });
assert.equal(response.retryAfterSeconds, 60);
assert.equal(provider.calls.length, 1);
assert.equal(JSON.stringify(state.rows).includes(state.plainCode), false);

const session = await service.loginByCode(1, { phone: '13800000000', code: state.plainCode }, {});
assert.equal(session.user.accountType, 'EMPLOYEE');
assert.equal(session.user.employeeId, 88);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node test/employee-sms-auth.test.js
node test/employee-sms-enumeration-security.test.js
```

Expected: FAIL because service and routes do not exist.

- [ ] **Step 3: Extract reusable employee session helper**

Export a narrowly scoped helper from `employee-auth.service.js` that creates/enables the fixed employee user and returns the existing employee session shape. Do not reuse WeChat binding identity or create an `employee_wechat_binding` row for SMS-only login.

Required export shape:

```js
async function ensureEmployeeAccount(connection, companyId, employee, phone) { /* fixed EMPLOYEE account */ }
function employeeSession(employee, user) { /* existing JWT shape */ }
```

- [ ] **Step 4: Implement issuance and login**

Use HMAC values:

```js
phoneHash = HMAC(secret, `phone:${companyId}:${normalizedPhone}`)
codeHash = HMAC(secret, `code:${companyId}:${normalizedPhone}:${plainCode}`)
ipHash = HMAC(secret, `ip:${companyId}:${ipAddress}`)
```

Generate the code with `crypto.randomInt(0, 1_000_000)` and `padStart(6, '0')`. Never return it. Select at most two active matching employees; only exactly one match triggers provider sending. Verification uses `FOR UPDATE`, constant-time comparison, and consumes the row inside the employee-account transaction.

- [ ] **Step 5: Add public routes**

```js
router.post('/auth/employee/sms-code', loginLimiter, controller.requestCode);
router.post('/auth/employee/sms-login', loginLimiter, controller.login);
```

Controllers use existing `success`, `asyncHandler`, company context, IP, and user-agent patterns.

- [ ] **Step 6: Run focused validation**

Run:

```bash
node test/employee-sms-auth.test.js
node test/employee-sms-enumeration-security.test.js
node test/employee-auth-flow.test.js
node test/employee-account-isolation.test.js
npm run lint
```

Expected: all PASS.

- [ ] **Step 7: Review checkpoint**

Search new backend files and test output for the test plaintext code and full phone; production source must not log either. Do not commit.

---

### Task 4: Add Mini-Program SMS Login and URL-Link Destination Handling

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/login/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/login/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/login/index.wxss`
- Modify: `wechat-miniprogram/miniprogram/app.js`
- Modify: `wechat-miniprogram/miniprogram/pages/payroll/index.js`
- Test: `test/miniprogram-employee-sms-login.test.js`
- Test: `test/miniprogram-payslip-url-link.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `POST /auth/employee/sms-code`, `POST /auth/employee/sms-login`, common session helpers.
- Produces: SMS form, countdown, duplicate-click protection, and post-login destination restoration.

- [ ] **Step 1: Write failing mini-program contract tests**

Assert the login page exposes phone/code inputs, calls both endpoints, validates formats, guards duplicate requests, starts a 60-second countdown, does not display employee existence, and saves only the returned session. Assert URL-Link entry sets a non-sensitive local destination and unauthenticated users return to the payslip list after login.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node test/miniprogram-employee-sms-login.test.js
node test/miniprogram-payslip-url-link.test.js
```

Expected: FAIL because the SMS form and destination handling do not exist.

- [ ] **Step 3: Implement login state and handlers**

Add data fields:

```js
smsPhone: '', smsCode: '', smsSending: false, smsLoggingIn: false,
smsCountdown: 0, smsTimer: null
```

Handlers:

```js
onSmsPhone(event)
onSmsCode(event)
requestSmsCode()
submitSmsLogin()
startSmsCountdown(seconds)
```

Validate `/^1\d{10}$/` and `/^\d{6}$/`. Clear the timer in `onUnload`. On successful login call the existing `enterHome` helper with a pending destination override.

- [ ] **Step 4: Implement URL-Link landing behavior**

When `pages/payroll/index` opens without an employee session, store only the constant destination `/pages/payroll/index` and relaunch login. Never persist link query values. After employee login, switch to the stored tab destination once and clear it.

- [ ] **Step 5: Run focused validation**

Run:

```bash
node test/miniprogram-employee-sms-login.test.js
node test/miniprogram-payslip-url-link.test.js
node test/miniprogram-dual-login.test.js
node test/miniprogram-employee-payslips.test.js
npm run lint
```

Expected: all PASS.

- [ ] **Step 6: Review checkpoint**

Confirm no phone, code, token, employee ID, or payslip ID is placed in URL parameters or rendered debug text. Do not commit.

---

### Task 5: Add Payslip SMS Delivery Queue and Payroll Publication Integration

**Files:**
- Create: `src/services/sms-delivery.service.js`
- Modify: `src/services/operations.service.js`
- Test: `test/payroll-sms-delivery.test.js`
- Test: `test/payroll-publish-sms-isolation.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `sms_delivery_job`, payroll batch/detail, employee phone, `smsProvider.sendTemplate`.
- Produces: `enqueuePublishedJobs`, `enqueueReminderJobs`, `retryFailedJobs`, `getBatchSummary`, `processPendingJobs`.

- [ ] **Step 1: Write failing queue and publication tests**

Assert publication inserts one idempotent job per unsigned salary detail in the same transaction, repeated publication cannot duplicate jobs, no-phone employees are marked skipped, and provider failure occurs outside and cannot roll back the published batch.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node test/payroll-sms-delivery.test.js
node test/payroll-publish-sms-isolation.test.js
```

Expected: FAIL because the delivery service and publication enqueue are missing.

- [ ] **Step 3: Implement enqueue functions**

Required signatures:

```js
async function enqueuePublishedJobs(connection, { companyId, batchId, salaryMonth, operatorId })
async function enqueueReminderJobs({ companyId, batchId, operatorId, user, confirmed })
async function retryFailedJobs({ companyId, batchId, operatorId, user, confirmed })
```

Use `INSERT ... SELECT` from `salary_detail` joined to `hr_employee`; use `ON DUPLICATE KEY UPDATE id=id` for publication idempotency. Reminder dedupe keys include a 12-hour bucket.

- [ ] **Step 4: Integrate payroll publication**

Call `enqueuePublishedJobs(connection, ...)` after receipt statuses are updated and before the transaction returns. Return `{ batchId, smsQueued, smsSkippedNoPhone }`. Do not call Tencent Cloud from `publishPayrollBatch`.

- [ ] **Step 5: Implement job processing**

Claim at most 100 due jobs using a short transaction and `FOR UPDATE SKIP LOCKED`, set them to `SENDING`, then send outside the transaction. Before sending, re-query active employee phone and current receipt status. Apply retry delays `[60, 300, 1800]` seconds only for retryable errors.

- [ ] **Step 6: Run focused validation**

Run:

```bash
node test/payroll-sms-delivery.test.js
node test/payroll-publish-sms-isolation.test.js
node test/payroll-batch-detail.test.js
node test/dynamic-notices.test.js
npm run lint
```

Expected: all PASS.

- [ ] **Step 7: Review checkpoint**

Confirm publishing contains no provider network call and every SQL statement includes `company_id`. Do not commit.

---

### Task 6: Add SMS Management APIs and Web Payroll UI

**Files:**
- Modify: `src/controllers/operations.controller.js`
- Modify: `src/routes/operations.routes.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/payroll-sms-management.test.js`
- Test: `test/web-payroll-sms-management.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 5 summary/reminder/retry functions and existing payroll permissions/data scope.
- Produces: three manager endpoints and batch-detail SMS controls.

- [ ] **Step 1: Write failing API and UI tests**

Assert routes and permissions for summary/reminder/retry, `confirmed === true`, project-scope enforcement, 500-job cap, masked phone display, confirmation dialogs, duplicate-submit guards, and absence of full phone/salary data in SMS views.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node test/payroll-sms-management.test.js
node test/web-payroll-sms-management.test.js
```

Expected: FAIL because routes and UI controls do not exist.

- [ ] **Step 3: Add manager routes**

```js
router.get('/payroll/batches/:id/sms-summary', requirePermission('payroll:view'), controller.getPayrollSmsSummary);
router.post('/payroll/batches/:id/sms-reminders', sensitiveLimiter, requirePermission('payroll:manage'), controller.createPayrollSmsReminders);
router.post('/payroll/batches/:id/sms-retry', sensitiveLimiter, requirePermission('payroll:manage'), controller.retryPayrollSms);
```

- [ ] **Step 4: Add compact web UI**

Add a summary strip to the existing payroll batch detail modal. Use current `api()` and confirmation-dialog conventions. Buttons remain disabled during requests and refresh the summary afterward. Render only `phoneTail` as `****0000`.

- [ ] **Step 5: Run focused validation**

Run:

```bash
node test/payroll-sms-management.test.js
node test/web-payroll-sms-management.test.js
node test/web-payroll-batch-detail.test.js
node test/role-permission-matrix.test.js
npm run lint
```

Expected: all PASS.

- [ ] **Step 6: Review checkpoint**

Check desktop and narrow mobile-web markup for overflow and ensure all bulk actions require confirmation. Do not commit.

---

### Task 7: Wire the SMS Worker into the Existing Scheduler

**Files:**
- Modify: `src/scheduler.js`
- Test: `test/sms-scheduler.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `smsDeliveryService.processPendingJobs({ limit: 100 })`.
- Produces: one-minute scheduled processing with overlap protection and sanitized operational output.

- [ ] **Step 1: Write failing scheduler test**

Assert the scheduler invokes SMS processing, uses a separate running flag, cannot overlap, continues existing risk scans, and never logs job payloads, phones, template params, or credentials.

- [ ] **Step 2: Run test and verify RED**

Run: `node test/sms-scheduler.test.js`

Expected: FAIL because the scheduler does not process SMS jobs.

- [ ] **Step 3: Implement minimal worker schedule**

Add `runSmsDelivery()` with `smsDeliveryRunning` protection. Schedule every minute using the existing scheduler pattern. Log only counts `{ claimed, sent, failed, skipped }`; on error log only sanitized name/code.

- [ ] **Step 4: Run focused validation**

Run:

```bash
node test/sms-scheduler.test.js
node test/scheduler.test.js
node test/operational-monitoring.test.js
npm run lint
```

Expected: all PASS.

- [ ] **Step 5: Review checkpoint**

Confirm no new timer starts during module import in tests and no real SMS can send when `TENCENT_SMS_ENABLED=false`. Do not commit.

---

### Task 8: Full Security, Regression, and Release Verification

**Files:**
- Test: all files from Tasks 1-7
- Inspect: `data/db.json`, both Git worktrees, release scripts, and production example config.

**Interfaces:**
- Consumes: complete local implementation.
- Produces: release-readiness evidence only; no external deployment or upload.

- [ ] **Step 1: Run all focused SMS tests**

```bash
node test/tencent-sms-schema-config.test.js
node test/tencent-sms-service.test.js
node test/employee-sms-auth.test.js
node test/employee-sms-enumeration-security.test.js
node test/miniprogram-employee-sms-login.test.js
node test/miniprogram-payslip-url-link.test.js
node test/payroll-sms-delivery.test.js
node test/payroll-publish-sms-isolation.test.js
node test/payroll-sms-management.test.js
node test/web-payroll-sms-management.test.js
node test/sms-scheduler.test.js
```

Expected: all PASS without outbound SMS.

- [ ] **Step 2: Run complete quality gates**

```bash
npm run lint
npm run check
npm run postcheck
npm audit --audit-level=high
git diff --check
git -C wechat-miniprogram diff --check
```

Expected: all commands exit 0 and npm reports 0 high-or-greater vulnerabilities.

- [ ] **Step 3: Run sensitive-data scans**

```bash
rg -n "console\.(log|error).*?(phone|code|token|secret)|13800000000|123456" src public wechat-miniprogram/miniprogram --glob '*.js'
rg -n "TENCENT_SECRET_(ID|KEY)=.+|SMS_CODE_HMAC_SECRET=.+" . --glob '!node_modules/**' --glob '!test/**'
```

Expected: no production secret, verification code, full phone, or unsafe logging match. Benign test fixtures must remain only under `test/`.

- [ ] **Step 4: Confirm data and external-state boundaries**

```bash
git status --short -- data/db.json
git diff -- data/db.json
git status --short
git -C wechat-miniprogram status --short
```

Expected: `data/db.json` unchanged; local source changes remain uncommitted; no deployment/upload side effects.

- [ ] **Step 5: Produce handoff checklist**

Report required Tencent values without requesting secrets in chat: SDK AppID, approved sign name, three approved template IDs, generated production URL Link, SMS HMAC secret, and either CVM role permission or server-side credential configuration. State that real SMS and URL-Link tests remain pending until explicit production authorization.
