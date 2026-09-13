# Employee Login and Portal Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build secure WeChat employee login, phone or one-time-code employee binding, manager/employee account isolation, and the employee mini-program home/profile shell without changing existing manager workflows.

**Architecture:** Reuse `sys_user.employee_id` and the existing JWT/session stack, add a fixed `EMPLOYEE` account type plus dedicated WeChat binding tables and services, and keep employee identity endpoints separate from manager username/password login. The same mini-program switches login form, routes, and custom tab bar by `accountType`; all employee APIs derive the employee ID from the authenticated session rather than request parameters.

**Tech Stack:** Node.js 22, Express 4, MySQL 8, native WeChat mini-program, built-in `fetch`, existing HMAC JWT, existing Node assertion test scripts.

**Spec:** `docs/superpowers/specs/2026-08-14-employee-payslip-portal-design.md`

## Global Constraints

- This plan implements only employee login, binding, employee home/profile, and dual-role navigation.
- Do not implement salary signature, salary dispute, payroll import enhancement, or Tencent Cloud SMS in this plan.
- Keep the four configurable manager roles unchanged: company administrator, HR manager, onsite staff, and payroll staff.
- Employee accounts use fixed `accountType=EMPLOYEE`; they do not receive manager roles or manager permissions.
- An employee can log in only while `employee_status=2` and `deleted_at IS NULL`.
- Employee identity is always derived from the signed token and `sys_user.employee_id`.
- Do not log WeChat `session_key`, full phone numbers, full ID card numbers, binding-code plaintext, passwords, or tokens.
- One-time binding codes expire after 10 minutes, allow at most 5 failed attempts, and become unusable after successful binding.
- Preserve all existing manager username/password login behavior and current mini-program manager pages.
- Follow TDD: every production change starts with a failing focused regression test.

---

## File Structure

### Backend files to create

- `src/services/wechat-mini.service.js`: WeChat `code2Session`, access-token cache, and phone-number exchange.
- `src/services/employee-auth.service.js`: employee login tickets, employee matching, phone binding, code binding, and employee session issuance.
- `src/controllers/employee-auth.controller.js`: employee login/binding HTTP handlers.
- `src/routes/employee-auth.routes.js`: public employee login routes and authenticated employee profile route.
- `sql/migrate-employee-wechat-login-20260814.mysql.sql`: account type, WeChat binding, binding code, and login audit schema.
- `test/wechat-mini-service.test.js`: WeChat client success/failure and secret-redaction tests.
- `test/employee-auth-flow.test.js`: phone binding and login behavior.
- `test/employee-bind-code.test.js`: one-time code creation, scope, expiry, attempt, and reuse behavior.
- `test/employee-account-isolation.test.js`: manager/employee token and API isolation.
- `test/miniprogram-dual-login.test.js`: mini-program dual-entry contract.
- `test/miniprogram-employee-shell.test.js`: employee home/profile/tab-bar contract.

### Backend files to modify

- `src/config/env.js`: WeChat and binding-secret configuration.
- `.env.production.example`: production variable documentation.
- `sql/schema.mysql.sql`: canonical schema alignment.
- `src/services/auth.service.js`: return `accountType`, preserve employee scope, invalidate departed employee sessions.
- `src/middlewares/auth.middleware.js`: add manager/employee account-type guards.
- `src/routes/auth.routes.js`: keep manager login unchanged.
- `src/routes/employee.routes.js`: add manager-side binding-code endpoint.
- `src/controllers/employee.controller.js`: expose manager-side binding-code handler.
- `src/routes/index.js`: mount employee auth routes.
- `scripts/deploy-production.sh`: execute the new idempotent migration.
- `scripts/verify-release-package.sh`: require and audit the new migration.
- `package.json`: add focused regression tests to `npm run check`.

### Mini-program files to create

- `wechat-miniprogram/miniprogram/pages/employee-bind/index.js`
- `wechat-miniprogram/miniprogram/pages/employee-bind/index.wxml`
- `wechat-miniprogram/miniprogram/pages/employee-bind/index.wxss`
- `wechat-miniprogram/miniprogram/components/employee-home-panel/index.js`
- `wechat-miniprogram/miniprogram/components/employee-home-panel/index.json`
- `wechat-miniprogram/miniprogram/components/employee-home-panel/index.wxml`
- `wechat-miniprogram/miniprogram/components/employee-home-panel/index.wxss`
- `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.js`
- `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.json`
- `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.wxml`
- `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.wxss`
- `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.js`
- `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.json`
- `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.wxml`
- `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.wxss`

### Mini-program files to modify

- `wechat-miniprogram/miniprogram/pages/login/index.js`: employee/manager login modes.
- `wechat-miniprogram/miniprogram/pages/login/index.wxml`: dual-entry interface.
- `wechat-miniprogram/miniprogram/pages/login/index.wxss`: employee binding UI.
- `wechat-miniprogram/miniprogram/utils/auth.js`: account type helpers and entry routing.
- `wechat-miniprogram/miniprogram/utils/request.js`: route expired employee sessions back to the common login page.
- `wechat-miniprogram/miniprogram/custom-tab-bar/index.js`: account-type-specific tab lists.
- `wechat-miniprogram/miniprogram/pages/home/*`: render the employee home component for employee sessions.
- `wechat-miniprogram/miniprogram/pages/payroll/*`: render the Phase 1 employee wage-entry placeholder for employee sessions.
- `wechat-miniprogram/miniprogram/pages/advances/*`: render the Phase 1 employee message placeholder for employee sessions.
- `wechat-miniprogram/miniprogram/pages/profile/*`: render the employee profile component for employee sessions.
- `wechat-miniprogram/miniprogram/app.json`: register the employee binding page and component declarations without adding extra tab roots.
- `wechat-miniprogram/miniprogram/app.js`: session-aware initial route selection.

---

### Task 1: Add Employee Account and WeChat Binding Schema

**Files:**
- Create: `sql/migrate-employee-wechat-login-20260814.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Test: `test/employee-wechat-schema.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `sys_user.account_type`, `employee_wechat_binding`, `employee_bind_code`, `employee_login_audit`.
- Consumes: existing `sys_user`, `hr_employee`, `token_version`, and operation-log conventions.

- [ ] **Step 1: Write the failing schema contract test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('sql/migrate-employee-wechat-login-20260814.mysql.sql', 'utf8');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const deploy = fs.readFileSync('scripts/deploy-production.sh', 'utf8');

for (const source of [migration, schema]) {
  assert.match(source, /account_type VARCHAR\(20\).*MANAGER/s);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_wechat_binding/);
  assert.match(source, /active_employee_id BIGINT GENERATED ALWAYS AS/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_bind_code/);
  assert.match(source, /failed_attempts TINYINT NOT NULL DEFAULT 0/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?employee_login_audit/);
}
assert.match(deploy, /migrate-employee-wechat-login-20260814\.mysql\.sql/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM/i);
console.log('employee-wechat-schema-tests-ok');
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `node test/employee-wechat-schema.test.js`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create the idempotent migration**

Use `information_schema.COLUMNS` plus prepared `ALTER TABLE` statements, following existing migration style. Add:

```sql
ALTER TABLE sys_user
  ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT 'MANAGER'
  COMMENT 'MANAGER管理账号 EMPLOYEE员工账号';

CREATE TABLE IF NOT EXISTS employee_wechat_binding (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  openid VARCHAR(128) NOT NULL,
  unionid VARCHAR(128) DEFAULT NULL,
  phone VARCHAR(20) NOT NULL,
  binding_status TINYINT NOT NULL DEFAULT 1,
  token_version INT NOT NULL DEFAULT 0,
  active_employee_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN binding_status=1 THEN employee_id ELSE NULL END
  ) STORED,
  active_openid VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN binding_status=1 THEN openid ELSE NULL END
  ) STORED,
  bound_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME DEFAULT NULL,
  unbound_at DATETIME DEFAULT NULL,
  unbound_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_employee_active (company_id,active_employee_id),
  UNIQUE KEY uk_company_openid_active (company_id,active_openid),
  KEY idx_user (company_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Create `employee_bind_code` exactly as the spec, plus `employee_login_audit` with `company_id`, nullable `employee_id`, nullable `user_id`, nullable unique `ticket_nonce_hash CHAR(64)`, `action_type`, `result_code`, masked `phone_tail`, `ip_address`, `device_info`, and `created_at`. The nonce hash is inserted when a bind ticket is issued and marked with a successful result in the same transaction that consumes the ticket.

- [ ] **Step 4: Update canonical schema and release scripts**

Add the same tables to `sql/schema.mysql.sql`. Add this exact deployment line after token-version migration:

```bash
run_migration "$STAGE_DIR/sql/migrate-employee-wechat-login-20260814.mysql.sql"
```

Add the file to `REQUIRED`, migration variables, migration loop, and destructive-keyword audit in `scripts/verify-release-package.sh`.

- [ ] **Step 5: Add the schema test to the check script**

Insert `node test/employee-wechat-schema.test.js` immediately after syntax checks in `package.json` `check`.

- [ ] **Step 6: Run focused and release migration tests**

Run:

```bash
node test/employee-wechat-schema.test.js
node test/release-migration-consistency.test.js
node test/release-candidate-manifest.test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add hr-roster-system/sql/schema.mysql.sql \
  hr-roster-system/sql/migrate-employee-wechat-login-20260814.mysql.sql \
  hr-roster-system/scripts/deploy-production.sh \
  hr-roster-system/scripts/verify-release-package.sh \
  hr-roster-system/test/employee-wechat-schema.test.js \
  hr-roster-system/package.json
git commit -m "feat: add employee WeChat binding schema"
```

---

### Task 2: Add Production WeChat and Binding Security Configuration

**Files:**
- Modify: `src/config/env.js`
- Modify: `.env.production.example`
- Test: `test/employee-auth-config.test.js`

**Interfaces:**
- Produces: `env.wechatMini.appId`, `env.wechatMini.appSecret`, `env.employeeBinding.hmacSecret`, `env.employeeBinding.ticketTtlSeconds`.
- Consumes: `process.env.WECHAT_MINIPROGRAM_APPID`, `WECHAT_MINIPROGRAM_SECRET`, `EMPLOYEE_BIND_HMAC_SECRET`.

- [ ] **Step 1: Write the failing configuration test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/config/env.js', 'utf8');
const example = fs.readFileSync('.env.production.example', 'utf8');

assert.match(source, /wechatMini:\s*\{/);
assert.match(source, /WECHAT_MINIPROGRAM_APPID/);
assert.match(source, /WECHAT_MINIPROGRAM_SECRET/);
assert.match(source, /EMPLOYEE_BIND_HMAC_SECRET/);
assert.match(source, /EMPLOYEE_BIND_HMAC_SECRET.*32/s);
for (const name of ['WECHAT_MINIPROGRAM_APPID','WECHAT_MINIPROGRAM_SECRET','EMPLOYEE_BIND_HMAC_SECRET']) {
  assert.match(example, new RegExp(`^${name}=`, 'm'));
}
console.log('employee-auth-config-tests-ok');
```

- [ ] **Step 2: Run the configuration test and verify RED**

Run: `node test/employee-auth-config.test.js`

Expected: FAIL because the configuration objects are missing.

- [ ] **Step 3: Add configuration parsing and production validation**

Add to `env`:

```js
wechatMini: {
  appId: process.env.WECHAT_MINIPROGRAM_APPID || '',
  appSecret: process.env.WECHAT_MINIPROGRAM_SECRET || ''
},
employeeBinding: {
  hmacSecret: process.env.EMPLOYEE_BIND_HMAC_SECRET || '',
  ticketTtlSeconds: 5 * 60,
  codeTtlSeconds: 10 * 60,
  maxAttempts: 5
}
```

Production validation must reject missing AppID/secret and binding HMAC secrets shorter than 32 bytes. Do not print secret values.

- [ ] **Step 4: Document production variables**

Add empty examples and Chinese comments to `.env.production.example`. Never place real secrets in the repository.

- [ ] **Step 5: Run focused security configuration tests**

Run:

```bash
node test/employee-auth-config.test.js
node test/security-hardening.test.js
```

Expected: both PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add hr-roster-system/src/config/env.js \
  hr-roster-system/.env.production.example \
  hr-roster-system/test/employee-auth-config.test.js
git commit -m "feat: configure employee WeChat authentication"
```

---

### Task 3: Implement the WeChat Mini-Program API Client

**Files:**
- Create: `src/services/wechat-mini.service.js`
- Test: `test/wechat-mini-service.test.js`

**Interfaces:**
- Produces: `codeToSession(loginCode): Promise<{openid:string, unionid:string}>`.
- Produces: `getPhoneNumber(phoneCode): Promise<{phoneNumber:string}>`.
- Consumes: `env.wechatMini`, built-in `fetch`, WeChat endpoints `jscode2session`, `cgi-bin/token`, and `wxa/business/getuserphonenumber`.

- [ ] **Step 1: Write failing WeChat client tests**

```js
const assert = require('node:assert/strict');
const service = require('../src/services/wechat-mini.service');

async function main() {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('jscode2session')) {
      return { ok: true, json: async () => ({ openid: 'openid-1', unionid: 'union-1' }) };
    }
    if (String(url).includes('/cgi-bin/token')) {
      return { ok: true, json: async () => ({ access_token: 'access-token', expires_in: 7200 }) };
    }
    return { ok: true, json: async () => ({ phone_info: { purePhoneNumber: '13800000000' } }) };
  };
  const session = await service.codeToSession('login-code');
  const phone = await service.getPhoneNumber('phone-code');
  assert.deepEqual(session, { openid: 'openid-1', unionid: 'union-1' });
  assert.equal(phone.phoneNumber, '13800000000');
  assert.ok(calls.every(call => !JSON.stringify(call).includes('session_key')));
  global.fetch = originalFetch;
}
main().then(() => console.log('wechat-mini-service-tests-ok'));
```

- [ ] **Step 2: Run the WeChat client test and verify RED**

Run: `node test/wechat-mini-service.test.js`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement request, timeout, and error helpers**

Implement a private `wechatRequest(url, options)` with an `AbortController` 10-second timeout. Convert WeChat `errcode` responses to generic business errors such as `微信登录凭证无效，请重新授权`; never include AppSecret, access token, phone code, `session_key`, or full upstream body in logs.

- [ ] **Step 4: Implement access-token caching**

Cache only the application access token in module memory until `expires_in - 300` seconds. Never cache `session_key`.

- [ ] **Step 5: Implement exported functions**

```js
async function codeToSession(loginCode) {
  if (!String(loginCode || '').trim()) throw createError('缺少微信登录凭证');
  // GET jscode2session and return openid/unionid only.
}

async function getPhoneNumber(phoneCode) {
  if (!String(phoneCode || '').trim()) throw createError('请授权获取微信手机号');
  // POST phone code using cached application access token.
}
```

- [ ] **Step 6: Test upstream failures and secret redaction**

Add cases for invalid codes, network timeout, expired access token retry once, missing phone info, and error messages not containing configured secrets.

- [ ] **Step 7: Run focused tests**

Run: `node test/wechat-mini-service.test.js`

Expected: PASS with `wechat-mini-service-tests-ok`.

- [ ] **Step 8: Commit Task 3**

```bash
git add hr-roster-system/src/services/wechat-mini.service.js \
  hr-roster-system/test/wechat-mini-service.test.js
git commit -m "feat: add WeChat mini-program auth client"
```

---

### Task 4: Add Employee Account-Type Isolation

**Files:**
- Modify: `src/services/auth.service.js`
- Modify: `src/middlewares/auth.middleware.js`
- Modify: `src/utils/token.js`
- Test: `test/employee-account-isolation.test.js`

**Interfaces:**
- Produces: authenticated user property `accountType: 'MANAGER' | 'EMPLOYEE'`.
- Produces: middleware `requireManagerAccount` and `requireEmployeeAccount`.
- Consumes: `sys_user.account_type`, `sys_user.employee_id`, `hr_employee.employee_status`.

- [ ] **Step 1: Write failing account isolation tests**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const auth = fs.readFileSync('src/services/auth.service.js', 'utf8');
const middleware = fs.readFileSync('src/middlewares/auth.middleware.js', 'utf8');

assert.match(auth, /accountType:\s*user\.account_type/);
assert.match(auth, /account_type='EMPLOYEE'[\s\S]*employee_status=2/);
assert.match(middleware, /function requireManagerAccount/);
assert.match(middleware, /function requireEmployeeAccount/);
assert.match(middleware, /req\.user\.accountType/);
console.log('employee-account-isolation-tests-ok');
```

- [ ] **Step 2: Run the isolation test and verify RED**

Run: `node test/employee-account-isolation.test.js`

Expected: FAIL because account-type fields and guards are missing.

- [ ] **Step 3: Return account type from manager login and session refresh**

Manager username/password login must return `accountType: 'MANAGER'`. `getUserById` must return the stored type and, for `EMPLOYEE`, join `hr_employee` and reject users whose employee record is no longer active.

- [ ] **Step 4: Sign account type into employee tokens**

Employee token payload:

```js
{
  userId,
  companyId,
  employeeId,
  accountType: 'EMPLOYEE',
  tokenVersion
}
```

`requireAuth` must trust the current database user type, not only the token claim.

- [ ] **Step 5: Add fixed account guards**

```js
function requireEmployeeAccount(req, _res, next) {
  if (req.user?.accountType !== 'EMPLOYEE' || !Number(req.user?.employeeId)) {
    return next(createError('仅员工本人可以访问', 403));
  }
  next();
}

function requireManagerAccount(req, _res, next) {
  if (req.user?.accountType !== 'MANAGER') {
    return next(createError('员工账号不能访问管理功能', 403));
  }
  next();
}
```

Apply `requireManagerAccount` centrally to existing manager route groups without breaking `/me/payslips` and the new employee routes.

- [ ] **Step 6: Add dynamic tests**

Test that employee accounts have no manager permissions, manager accounts cannot pass `requireEmployeeAccount`, employee accounts cannot pass `requireManagerAccount`, and a departed employee causes `getUserById` to return null.

- [ ] **Step 7: Run focused and role tests**

Run:

```bash
node test/employee-account-isolation.test.js
node test/role-permission-matrix.test.js
node test/high-risk-security.test.js
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add hr-roster-system/src/services/auth.service.js \
  hr-roster-system/src/middlewares/auth.middleware.js \
  hr-roster-system/src/utils/token.js \
  hr-roster-system/test/employee-account-isolation.test.js
git commit -m "feat: isolate employee and manager accounts"
```

---

### Task 5: Implement Employee Phone and One-Time-Code Binding

**Files:**
- Create: `src/services/employee-auth.service.js`
- Create: `src/controllers/employee-auth.controller.js`
- Create: `src/routes/employee-auth.routes.js`
- Modify: `src/routes/index.js`
- Modify: `src/routes/employee.routes.js`
- Modify: `src/controllers/employee.controller.js`
- Test: `test/employee-auth-flow.test.js`
- Test: `test/employee-bind-code.test.js`

**Interfaces:**
- Produces: `startWechatLogin(companyId, body, requestMeta)`.
- Produces: `bindByPhone(companyId, body, requestMeta)`.
- Produces: `createBindCode(companyId, employeeId, operatorId, user)`.
- Produces: `bindByCode(companyId, body, requestMeta)`.
- Produces endpoints listed in the approved spec.
- Consumes: Task 3 WeChat functions and Task 4 account-type session functions.

- [ ] **Step 1: Write failing phone-binding service tests**

Test these behaviors with database and WeChat adapters stubbed at module boundaries:

```js
assert.equal(result.needIdentityVerify, true);
assert.match(result.maskedName, /^.\*$/);
assert.ok(result.bindTicket);
assert.equal(JSON.stringify(result).includes('13800000000'), false);
```

Add rejection cases for zero matches, duplicate phone matches, inactive employee, wrong ID suffix, reused ticket, and existing binding owned by another employee.

- [ ] **Step 2: Run the phone-binding tests and verify RED**

Run: `node test/employee-auth-flow.test.js`

Expected: FAIL because `employee-auth.service.js` does not exist.

- [ ] **Step 3: Implement short-lived signed bind tickets**

Ticket payload:

```js
{
  purpose: 'EMPLOYEE_PHONE_BIND',
  companyId,
  employeeId,
  openid,
  unionid,
  phone,
  nonce,
  exp
}
```

Sign with `env.employeeBinding.hmacSecret`. Persist a SHA-256 nonce hash in `employee_login_audit` or a dedicated consumed-ticket record so a successful ticket cannot be replayed.

- [ ] **Step 4: Implement phone matching and ID-suffix verification**

Phone matching query must require exactly one active employee. Decrypt the ID card only in memory, compare uppercase last six characters with `crypto.timingSafeEqual`, then discard plaintext variables.

- [ ] **Step 5: Create employee account and binding atomically**

Within one transaction:

1. Lock the employee row.
2. Confirm active status.
3. Confirm no active employee or OpenID binding.
4. Create or reactivate a `sys_user` with `account_type='EMPLOYEE'` and `employee_id`.
5. Insert active `employee_wechat_binding`.
6. Mark ticket consumed.
7. Insert `employee_login_audit` with masked phone tail only.
8. Sign and return employee session.

- [ ] **Step 6: Write failing one-time binding-code tests**

Test generation produces six digits, the database receives only `codeHash`, valid codes bind once, expired codes fail, fifth failure locks the code, and a successful code cannot be reused.

- [ ] **Step 7: Run binding-code tests and verify RED**

Run: `node test/employee-bind-code.test.js`

Expected: FAIL because code methods and routes are missing.

- [ ] **Step 8: Implement manager-side code generation**

Generate using `crypto.randomInt(0, 1000000)` and `padStart(6, '0')`. Store:

```js
const codeHash = crypto
  .createHmac('sha256', env.employeeBinding.hmacSecret)
  .update(`${companyId}|${employeeId}|${salt}|${plainCode}`)
  .digest('hex');
```

Invalidate older unused codes for the same employee in the same transaction. Return the plaintext code only in the creation response.

- [ ] **Step 9: Enforce manager data scope for code generation**

Call existing `assertEmployeeScope(companyId, employeeId, user, connection)`. Permit users only when their permissions include `employee:update`; do not add a new manager role.

- [ ] **Step 10: Add routes and rate limits**

```js
router.post('/auth/employee/wechat-login', loginLimiter, controller.startWechatLogin);
router.post('/auth/employee/bind-phone', loginLimiter, controller.bindByPhone);
router.post('/auth/employee/bind-code', loginLimiter, controller.bindByCode);
router.get('/me/profile', requireAuth, requireEmployeeAccount, controller.profile);
```

Manager endpoint:

```js
router.post('/employees/:id/bind-code', sensitiveLimiter,
  requirePermission('employee:update'), controller.createBindCode);
```

- [ ] **Step 11: Run focused API and security tests**

Run:

```bash
node test/employee-auth-flow.test.js
node test/employee-bind-code.test.js
node test/employee-account-isolation.test.js
node test/security-hardening.test.js
```

Expected: all PASS.

- [ ] **Step 12: Commit Task 5**

```bash
git add hr-roster-system/src/services/employee-auth.service.js \
  hr-roster-system/src/controllers/employee-auth.controller.js \
  hr-roster-system/src/routes/employee-auth.routes.js \
  hr-roster-system/src/routes/index.js \
  hr-roster-system/src/routes/employee.routes.js \
  hr-roster-system/src/controllers/employee.controller.js \
  hr-roster-system/test/employee-auth-flow.test.js \
  hr-roster-system/test/employee-bind-code.test.js
git commit -m "feat: add secure employee WeChat binding"
```

---

### Task 6: Redesign the Mini-Program Login as a Dual Entry

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/login/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/login/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/login/index.wxss`
- Create: `wechat-miniprogram/miniprogram/pages/employee-bind/index.js`
- Create: `wechat-miniprogram/miniprogram/pages/employee-bind/index.wxml`
- Create: `wechat-miniprogram/miniprogram/pages/employee-bind/index.wxss`
- Modify: `wechat-miniprogram/miniprogram/app.json`
- Test: `test/miniprogram-dual-login.test.js`

**Interfaces:**
- Produces mini-program calls to `/auth/employee/wechat-login`, `/auth/employee/bind-phone`, and `/auth/employee/bind-code`.
- Produces a saved session containing `user.accountType`; both account types enter the existing tab root `/pages/home/index`, whose content is selected by account type in Task 8.
- Consumes: Task 5 API response shapes.

- [ ] **Step 1: Write the failing mini-program login contract test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const js = fs.readFileSync('wechat-miniprogram/miniprogram/pages/login/index.js', 'utf8');
const wxml = fs.readFileSync('wechat-miniprogram/miniprogram/pages/login/index.wxml', 'utf8');

assert.match(wxml, /员工登录/);
assert.match(wxml, /管理端登录/);
assert.match(wxml, /open-type="getPhoneNumber"/);
assert.match(js, /wx\.login/);
assert.match(js, /\/auth\/employee\/wechat-login/);
assert.match(js, /accountType === 'EMPLOYEE'/);
assert.match(js, /pages\/home\/index/);
console.log('miniprogram-dual-login-tests-ok');
```

- [ ] **Step 2: Run the dual-login test and verify RED**

Run: `node test/miniprogram-dual-login.test.js`

Expected: FAIL because employee controls are absent.

- [ ] **Step 3: Add login mode state without changing manager submission**

Use data state:

```js
loginMode: 'employee',
employeeStep: 'phone',
employeeLoading: false,
bindTicket: '',
idCardLast6: '',
bindCode: ''
```

Keep current `submit()` manager login implementation in a renamed `submitManagerLogin()` function with the same API body.

- [ ] **Step 4: Implement WeChat phone login**

Call `wx.login`, receive `event.detail.code` from `getPhoneNumber`, send both codes to the backend, then navigate to the bind page when identity verification is required.

- [ ] **Step 5: Build the employee binding page**

Provide two modes:

- Phone matched: show masked employee name and ask for ID-card last six characters.
- Binding code: ask for name, ID-card last six, and six-digit binding code.

Never display a full phone number or full identity number.

- [ ] **Step 6: Add explicit errors and disabled states**

Prevent duplicate taps while requests are in flight. Display backend business errors inline; do not expose raw WeChat errors or tokens.

- [ ] **Step 7: Run mini-program login tests and syntax checks**

Run:

```bash
node test/miniprogram-dual-login.test.js
node --check wechat-miniprogram/miniprogram/pages/login/index.js
node --check wechat-miniprogram/miniprogram/pages/employee-bind/index.js
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add hr-roster-system/wechat-miniprogram/miniprogram/pages/login \
  hr-roster-system/wechat-miniprogram/miniprogram/pages/employee-bind \
  hr-roster-system/wechat-miniprogram/miniprogram/app.json \
  hr-roster-system/test/miniprogram-dual-login.test.js
git commit -m "feat: add employee mini-program login entry"
```

---

### Task 7: Add Employee Session Routing and Employee Tab Bar

**Files:**
- Modify: `wechat-miniprogram/miniprogram/utils/auth.js`
- Modify: `wechat-miniprogram/miniprogram/utils/request.js`
- Modify: `wechat-miniprogram/miniprogram/app.js`
- Modify: `wechat-miniprogram/miniprogram/custom-tab-bar/index.js`
- Modify: `wechat-miniprogram/miniprogram/custom-tab-bar/index.wxml`
- Test: `test/miniprogram-employee-shell.test.js`

**Interfaces:**
- Produces: `isEmployeeSession(session)` and account-aware custom-tab configuration.
- Produces employee tab list `首页 | 工资条 | 消息 | 我的` by reusing four existing static tab roots.
- Consumes: session `user.accountType` created by Task 4 and Task 5.

- [ ] **Step 1: Write the failing employee shell contract test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const auth = fs.readFileSync('wechat-miniprogram/miniprogram/utils/auth.js', 'utf8');
const tabs = fs.readFileSync('wechat-miniprogram/miniprogram/custom-tab-bar/index.js', 'utf8');

assert.match(auth, /function isEmployeeSession/);
assert.match(auth, /accountType === 'EMPLOYEE'/);
for (const label of ['首页','工资条','消息','我的']) assert.match(tabs, new RegExp(label));
assert.match(tabs, /pages\/home\/index/);
assert.match(tabs, /pages\/payroll\/index/);
assert.match(tabs, /pages\/advances\/index/);
assert.match(tabs, /pages\/profile\/index/);
console.log('miniprogram-employee-shell-tests-ok');
```

- [ ] **Step 2: Run the employee shell test and verify RED**

Run: `node test/miniprogram-employee-shell.test.js`

Expected: FAIL because account-aware routing is missing.

- [ ] **Step 3: Implement session helpers**

```js
function isEmployeeSession(session) {
  return session?.user?.accountType === 'EMPLOYEE' && Number(session?.user?.employeeId) > 0;
}
```

- [ ] **Step 4: Route authenticated users to the shared home root**

Update login `onLoad`, successful login handlers, and application launch logic to enter `/pages/home/index`. Task 8 makes that root account-aware before it loads any manager API, so employee accounts never call manager dashboard endpoints.

- [ ] **Step 5: Switch custom tab data by account type**

Keep manager tabs unchanged. Employee tabs:

```js
[
  { pagePath: '/pages/home/index', text: '首页', mark: '首' },
  { pagePath: '/pages/payroll/index', text: '工资条', mark: '薪' },
  { pagePath: '/pages/advances/index', text: '消息', mark: '信' },
  { pagePath: '/pages/profile/index', text: '我的', mark: '我' }
]
```

These paths already exist in the static five-item `app.json` tab list. The employee custom tab omits `/pages/employees/index`; do not add more tab roots because WeChat limits a tab bar to five static pages.

- [ ] **Step 6: Preserve logout and expired-session behavior**

Both account types return to `/pages/login/index`; clear token and user storage before navigation.

- [ ] **Step 7: Run shell and existing tab-bar regressions**

Run:

```bash
node test/miniprogram-employee-shell.test.js
node test/miniprogram-custom-tabbar.test.js
node test/miniprogram-tabbar-regression.test.js
node test/miniprogram-tabbar-follow.test.js
```

Expected: all PASS and manager tab behavior unchanged.

- [ ] **Step 8: Commit Task 7**

```bash
git add hr-roster-system/wechat-miniprogram/miniprogram/utils/auth.js \
  hr-roster-system/wechat-miniprogram/miniprogram/utils/request.js \
  hr-roster-system/wechat-miniprogram/miniprogram/app.js \
  hr-roster-system/wechat-miniprogram/miniprogram/custom-tab-bar \
  hr-roster-system/test/miniprogram-employee-shell.test.js
git commit -m "feat: add employee mini-program navigation shell"
```

---

### Task 8: Add Employee Home and Profile

**Files:**
- Create: `wechat-miniprogram/miniprogram/components/employee-home-panel/index.js`
- Create: `wechat-miniprogram/miniprogram/components/employee-home-panel/index.json`
- Create: `wechat-miniprogram/miniprogram/components/employee-home-panel/index.wxml`
- Create: `wechat-miniprogram/miniprogram/components/employee-home-panel/index.wxss`
- Create: `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.js`
- Create: `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.json`
- Create: `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.wxml`
- Create: `wechat-miniprogram/miniprogram/components/employee-profile-panel/index.wxss`
- Create: `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.js`
- Create: `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.json`
- Create: `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.wxml`
- Create: `wechat-miniprogram/miniprogram/components/employee-empty-panel/index.wxss`
- Modify: `wechat-miniprogram/miniprogram/pages/home/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/home/index.json`
- Modify: `wechat-miniprogram/miniprogram/pages/home/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/payroll/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/payroll/index.json`
- Modify: `wechat-miniprogram/miniprogram/pages/payroll/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/advances/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/advances/index.json`
- Modify: `wechat-miniprogram/miniprogram/pages/advances/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/profile/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/profile/index.json`
- Modify: `wechat-miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `src/services/employee-auth.service.js`
- Modify: `src/controllers/employee-auth.controller.js`
- Test: `test/employee-profile-api.test.js`
- Test: `test/miniprogram-employee-home.test.js`

**Interfaces:**
- Produces: `getMyEmployeeProfile(companyId, user)`.
- Produces: `GET /api/me/profile` response with masked ID, current customer, project, position, active status, WeChat binding state, and `latestPayslip` status only.
- Consumes: existing salary tables but does not expose salary amounts on employee home.

- [ ] **Step 1: Write the failing profile API test**

```js
assert.equal(result.employeeId, 1001);
assert.equal(result.idCardMasked, '320***********1234');
assert.equal(result.customerName, '甲客户');
assert.equal(result.latestPayslip.salaryMonth, '2026-08');
assert.equal(Object.hasOwn(result.latestPayslip, 'netAmount'), false);
```

Also assert that service SQL binds `companyId` and `user.employeeId` and ignores any request employee ID.

- [ ] **Step 2: Run profile API test and verify RED**

Run: `node test/employee-profile-api.test.js`

Expected: FAIL because profile service is absent.

- [ ] **Step 3: Implement profile service**

Use the current job first and latest historical job only for display fallback. Require active employee status. Return:

```js
{
  employeeId,
  name,
  idCardMasked,
  phoneMasked,
  customerName,
  projectName,
  positionName,
  employeeStatus: 2,
  employeeStatusName: '在职',
  wechatBound: true,
  latestPayslip: { id, salaryMonth, receiptStatus, receiptStatusName }
}
```

- [ ] **Step 4: Write failing employee-home component and root-page test**

Assert the employee home component calls `/me/profile`, contains `查看工资条`, and does not render `netAmount`. Assert the shared home, payroll, advances, and profile roots check `isEmployeeSession` before calling manager APIs and render employee components/placeholders when the account type is `EMPLOYEE`.

- [ ] **Step 5: Run employee-home test and verify RED**

Run: `node test/miniprogram-employee-home.test.js`

Expected: FAIL because employee pages are absent.

- [ ] **Step 6: Build employee home component and account-aware home root**

Layout:

```text
员工姓名 + 在职状态
客户单位 / 项目 / 岗位
最新工资条月份 + 待签收状态
[查看工资条]
消息提醒占位卡片
```

Do not place salary amounts on the home page.

- [ ] **Step 7: Build employee profile component and Phase 1 placeholders**

Display masked ID card and phone, customer/project/position, WeChat bound state, version/environment, and logout. Do not offer manager permission counts or manager data-scope labels. In the shared payroll root, render an employee panel stating that the wage list is the next phase and provide no manager batch APIs. In the shared advances root, render an employee message empty state and do not call `/advances`.

Each shared root must determine the account type before its normal manager `load` method. Employee sessions must return early after rendering the employee component so no manager endpoint is requested.

- [ ] **Step 8: Run focused UI and API tests**

Run:

```bash
node test/employee-profile-api.test.js
node test/miniprogram-employee-home.test.js
node test/miniprogram-large-layout.test.js
node test/high-risk-security.test.js
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 8**

```bash
git add hr-roster-system/src/services/employee-auth.service.js \
  hr-roster-system/src/controllers/employee-auth.controller.js \
  hr-roster-system/wechat-miniprogram/miniprogram/components/employee-home-panel \
  hr-roster-system/wechat-miniprogram/miniprogram/components/employee-profile-panel \
  hr-roster-system/wechat-miniprogram/miniprogram/components/employee-empty-panel \
  hr-roster-system/wechat-miniprogram/miniprogram/pages/home \
  hr-roster-system/wechat-miniprogram/miniprogram/pages/payroll \
  hr-roster-system/wechat-miniprogram/miniprogram/pages/advances \
  hr-roster-system/wechat-miniprogram/miniprogram/pages/profile \
  hr-roster-system/test/employee-profile-api.test.js \
  hr-roster-system/test/miniprogram-employee-home.test.js
git commit -m "feat: add employee home and profile"
```

---

### Task 9: Add Security Regression and End-to-End Contract Coverage

**Files:**
- Create: `test/employee-login-security.test.js`
- Modify: `test/high-risk-security.test.js`
- Modify: `test/cross-client-data-alignment.test.js`
- Modify: `test/api-smoke.js`
- Modify: `package.json`

**Interfaces:**
- Consumes all prior task endpoints and session shapes.
- Produces final regression coverage required before Phase 2 begins.

- [ ] **Step 1: Write the security regression test before any security cleanup**

Cover:

```js
assert.rejects(() => managerCallsEmployeeProfile(), /仅员工本人可以访问/);
assert.rejects(() => employeeCallsManagerBootstrap(), /员工账号不能访问管理功能/);
assert.rejects(() => departedEmployeeRefreshesSession(), /用户不存在或已停用/);
assert.rejects(() => reuseBindTicket(), /绑定凭证已失效/);
assert.rejects(() => sixthCodeAttempt(), /尝试次数过多/);
```

Inspect captured logs and responses to ensure they do not contain full phone, ID card, AppSecret, access token, binding code, or JWT.

- [ ] **Step 2: Run security regression and verify RED**

Run: `node test/employee-login-security.test.js`

Expected: FAIL on any missing isolation or redaction behavior.

- [ ] **Step 3: Apply the smallest fixes identified by the failing test**

Do not broaden the feature. Fix only account-type guards, replay protection, rate limits, masking, or log redaction proven missing by Step 2.

- [ ] **Step 4: Update smoke and alignment contracts**

Add authenticated employee-only smoke hooks behind `EMPLOYEE_SMOKE_USER_ID`; do not embed real employee credentials. Confirm manager smoke remains unchanged.

- [ ] **Step 5: Add all new tests to `npm run check`**

Order them after syntax and mini-program contract checks, before the broader historical suite.

- [ ] **Step 6: Run the full local quality gate**

Run:

```bash
npm run lint
npm run check
npm run postcheck
npm audit --audit-level=high
git diff --check
git -C wechat-miniprogram diff --check
```

Expected:

- Syntax/lint exit code 0.
- All regression tests pass.
- `npm audit` reports 0 high or critical vulnerabilities.
- Both diff checks return no whitespace errors.

- [ ] **Step 7: Run local API smoke without production writes**

Start the existing service against the approved local/test database, then run `npm run smoke`. Do not create or modify production employee records during verification.

- [ ] **Step 8: Commit Task 9**

```bash
git add hr-roster-system/test/employee-login-security.test.js \
  hr-roster-system/test/high-risk-security.test.js \
  hr-roster-system/test/cross-client-data-alignment.test.js \
  hr-roster-system/test/api-smoke.js \
  hr-roster-system/package.json
git commit -m "test: verify employee login security"
```

---

## Phase 1 Acceptance Checklist

- [ ] Existing manager login still accepts company ID, username, and password.
- [ ] Employee login offers WeChat phone authorization and one-time-code fallback.
- [ ] Phone matching never returns employee candidate lists.
- [ ] ID-card suffix verification runs only on the server.
- [ ] A code expires in 10 minutes, locks after 5 failures, and cannot be reused.
- [ ] Employee and OpenID active bindings are unique while historical unbound records remain.
- [ ] Employee accounts cannot access manager APIs or manager tabs.
- [ ] Manager accounts cannot call employee-personal APIs.
- [ ] Departed employees lose access on the next request even if a token has not expired.
- [ ] Employee home shows status and latest payslip state but no salary amount.
- [ ] Employee profile displays only masked sensitive data.
- [ ] Existing manager mini-program tab behavior and page navigation remain unchanged.
- [ ] All new secrets exist only in production environment configuration.
- [ ] Full lint, check, postcheck, audit, and diff validation pass.

## Follow-Up Plans After Phase 1

1. `employee-payslip-view-signature-dispute`: employee payslip list/detail, Canvas signature, receipt transaction, and dispute workflow.
2. `payroll-admin-import-receipt-dashboard`: Excel preview, row validation, batch detail, receipt progress, reminders, and evidence export.
3. `payroll-sms-notification`: Tencent Cloud SMS publication notice, reminder, retry, throttling, and delivery logs.
