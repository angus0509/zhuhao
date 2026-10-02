# Attendance Exception Workbench and Daily Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an exception-first attendance workbench, project-day attendance confirmation, and a separate payroll-only daily settlement workspace with automatic calculation, atomic batch confirmation, revocation history, and strict permission isolation.

**Architecture:** Deliver two dependency-ordered phases. Phase A adds an append-only attendance closure event trail, closure commands, and a read-only exception workbench. Phase B gates the existing wage calculator on the confirmed closure version, adds a focused daily settlement service/API, and exposes a payroll-only SPA view. Existing attendance, wage calculation, payroll upload, and payslip display flows remain intact.

**Tech Stack:** Node.js 24, Express 4.21, MySQL 8.4 with `mysql2/promise`, Vanilla JavaScript SPA, Node `assert` contract tests, Docker Compose deployment scripts.

**Spec:** `docs/superpowers/specs/2026-09-28-attendance-exception-daily-settlement-design.md`

## Global Constraints

- Before implementation, refresh GitHub and start from the latest `origin/main`; the design branch was created from last-verified commit `abc9db3` while GitHub was unavailable.
- Preserve the dirty primary checkout `/Users/zhuhao/Documents/moluo`; execute only in an isolated `codex/` worktree/branch.
- Do not deploy production, run production migrations, upload the mini-program, or write test employee/payroll records to production without separate authorization.
- All SQL uses named parameters; never concatenate company, project, employee, date, limit, or offset values.
- Every query scopes by `company_id` and applies `projectScope` before returning or mutating project data.
- Attendance-only responses must not include `hourlyRate`, allowance amounts, earned amounts, or payment amounts.
- Normal approved minutes and approved overtime minutes use the same day/night shift hourly rate; do not add overtime multipliers.
- Daily settlement records payment state only; do not call a bank/payment provider, publish a payslip, or create a salary batch.
- Preserve append-only raw punches and append-only closure/payment events.
- Success envelopes use `{code:0,message,data}`; business failures use HTTP status plus `{code:<status>,message,data:null,businessCode}`.
- All write endpoints use a transaction, an 8–64 character `clientRequestId`, and deterministic idempotent replay.
- Each task follows red → green TDD, runs its focused tests, runs `git diff --check`, and commits only its listed files.

## Execution Preflight

Run before Task 1:

```bash
git status --short --branch
GIT_TERMINAL_PROMPT=0 git fetch --prune origin
git rebase origin/main
git merge-base --is-ancestor origin/main HEAD
npm ci
npm run check
```

Expected: worktree clean before rebase; `merge-base` exits `0`; dependency install succeeds; the untouched baseline passes `npm run check`. If GitHub remains unreachable, stop before business implementation and report the network blocker instead of claiming a current base.

## File Responsibility Map

| File | Responsibility |
| --- | --- |
| `src/services/attendance-closure.service.js` | Confirm/reopen project attendance days, closure versioning, idempotency, paid-day guard |
| `src/services/attendance-workbench.service.js` | Read-only exception-first aggregate/list with no payroll fields |
| `src/services/wage-calculation.service.js` | Existing monthly preview; add closure-version gating only |
| `src/services/daily-settlement.service.js` | Date-filtered settlement preview/list, atomic batch payment, revoke, event history |
| `src/controllers/attendance.controller.js` | Thin adapters for attendance workbench and closure commands |
| `src/controllers/daily-settlement.controller.js` | Thin adapters for payroll-only settlement endpoints |
| `src/routes/attendance.routes.js` | Attendance view/review routes |
| `src/routes/daily-settlement.routes.js` | Payroll view/manage routes with sensitive/batch rate limits |
| `public/js/views/attendance.js` | Exception-first attendance rendering and closure actions |
| `public/js/views/daily-settlement.js` | Independent payroll-only settlement state, rendering, and actions |
| `public/index.html` | Attendance workbench markup, settlement view markup, script registration |
| `public/js/core/router.js` | Register and load `dailySettlement` view |
| `public/js/core/navigation-groups.js` | Add payroll-only 日结薪资 navigation item |

---

### Task 1: Attendance Closure Schema and Release Contract

**Files:**
- Create: `sql/migrate-attendance-daily-closure-20260929.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Modify: `test/release-migration-consistency.test.js`
- Create: `test/attendance-daily-closure-schema.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `hr_operation_log`, `labor_project`, and project/day semantics.
- Produces: tables `attendance_daily_closures`, `attendance_daily_closure_events`, and `attendance_daily_review_events` with the exact columns and indexes from the spec.

- [ ] **Step 1: Write the failing schema contract test**

Create `test/attendance-daily-closure-schema.test.js`:

```js
const fs = require('node:fs');
const assert = require('node:assert/strict');

const migrationPath = 'sql/migrate-attendance-daily-closure-20260929.mysql.sql';
assert.equal(fs.existsSync(migrationPath), true, 'missing attendance closure migration');
const migration = fs.readFileSync(migrationPath, 'utf8');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const deploy = fs.readFileSync('scripts/deploy-production.sh', 'utf8');

for (const table of ['attendance_daily_closures', 'attendance_daily_closure_events', 'attendance_daily_review_events']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(schema, new RegExp(`CREATE TABLE ${table}`));
}
assert.match(migration, /UNIQUE KEY uk_attendance_daily_closure \(company_id, project_id, shift_date\)/);
assert.match(migration, /UNIQUE KEY uk_attendance_closure_request \(company_id, client_request_id\)/);
assert.match(migration, /UNIQUE KEY uk_attendance_daily_review_request \(company_id, client_request_id\)/);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.match(deploy, /migrate-attendance-daily-closure-20260929\.mysql\.sql/);
console.log('attendance-daily-closure-schema-tests-ok');
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `node test/attendance-daily-closure-schema.test.js`

Expected: FAIL with `missing attendance closure migration`.

- [ ] **Step 3: Add the idempotent migration and canonical schema**

The migration must contain these full table shapes:

```sql
CREATE TABLE IF NOT EXISTS attendance_daily_closures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  version_no INT UNSIGNED NOT NULL DEFAULT 0,
  confirmed_by BIGINT DEFAULT NULL,
  confirmed_at DATETIME DEFAULT NULL,
  reopened_by BIGINT DEFAULT NULL,
  reopened_at DATETIME DEFAULT NULL,
  reopen_reason VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_daily_closure (company_id, project_id, shift_date),
  KEY idx_attendance_daily_closure_status (company_id, project_id, status, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目考勤日确认状态';

CREATE TABLE IF NOT EXISTS attendance_daily_closure_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  action_type VARCHAR(20) NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  reason VARCHAR(255) DEFAULT NULL,
  operated_by BIGINT NOT NULL,
  operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_closure_request (company_id, client_request_id),
  KEY idx_attendance_closure_event_lookup (company_id, project_id, shift_date, operated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目考勤日确认事件';

CREATE TABLE IF NOT EXISTS attendance_daily_review_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  daily_result_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  action_type VARCHAR(30) NOT NULL,
  result_status VARCHAR(30) NOT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  review_comment VARCHAR(255) NOT NULL,
  operated_by BIGINT NOT NULL,
  operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_daily_review_request (company_id, client_request_id),
  KEY idx_attendance_daily_review_lookup (company_id, project_id, shift_date, daily_result_id, operated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤每日异常核实事件';
```

Add equivalent non-`IF NOT EXISTS` definitions to `sql/schema.mysql.sql`. Add the migration to `scripts/deploy-production.sh` immediately after the existing hourly-wage migration, then add a post-migration `information_schema.TABLES` count for all three tables. Add the migration path to the `REQUIRED` array in `scripts/verify-release-package.sh` so a release archive cannot omit it.

- [ ] **Step 4: Register the test in `npm run check`**

Add `node test/attendance-daily-closure-schema.test.js` next to the existing attendance schema tests in `package.json`; do not reorder unrelated tests.

- [ ] **Step 5: Run focused release checks**

Run:

```bash
node test/attendance-daily-closure-schema.test.js
node test/release-migration-consistency.test.js
bash -n scripts/deploy-production.sh
bash -n scripts/verify-release-package.sh
git diff --check
```

Expected: all commands exit `0` and print their success markers.

- [ ] **Step 6: Commit the schema slice**

```bash
git add sql/migrate-attendance-daily-closure-20260929.mysql.sql sql/schema.mysql.sql scripts/deploy-production.sh scripts/verify-release-package.sh test/attendance-daily-closure-schema.test.js test/release-migration-consistency.test.js package.json
git commit -m "feat: add attendance day closure schema"
```

---

### Task 2: Attendance Closure Command Service

**Files:**
- Create: `src/services/attendance-closure.service.js`
- Modify: `src/services/attendance.service.js`
- Create: `test/attendance-daily-closure.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `db.transaction`, `projectScope(user, params, 'p')`, `createError`, closure tables from Task 1.
- Produces:
  - `confirmDailyClosure(companyId, user, operatorId, body) -> {projectId, shiftDate, status, versionNo}`
  - `reopenDailyClosure(companyId, user, operatorId, body) -> {projectId, shiftDate, status, versionNo}`
  - `reviewDailyException(companyId, user, operatorId, resultId, body) -> {id, resultStatus, reviewStatus}`
  - `getClosure(client, companyId, projectId, shiftDate, {forUpdate=false}) -> closure|null`

- [ ] **Step 1: Write failing command tests**

Create a transaction/query stub following `test/wage-daily-payment.test.js`. Cover these exact cases:

```js
await assert.rejects(
  () => service.confirmDailyClosure(3, user, 9, {
    projectId: 12,
    shiftDate: '2026-09-29',
    clientRequestId: 'closure-confirm-12-20260929-v1'
  }),
  error => error.businessCode === 'ATTENDANCE_PENDING'
);

assert.deepEqual(await service.confirmDailyClosure(3, user, 9, {
  projectId: 12,
  shiftDate: '2026-09-29',
  clientRequestId: 'closure-confirm-12-20260929-v1'
}), { projectId: 12, shiftDate: '2026-09-29', status: 'CONFIRMED', versionNo: 1 });

await assert.rejects(
  () => service.reopenDailyClosure(3, user, 9, {
    projectId: 12,
    shiftDate: '2026-09-29',
    reason: '员工补交下班卡',
    clientRequestId: 'closure-reopen-12-20260929-v1'
  }),
  error => error.businessCode === 'DAILY_PAYMENT_ACTIVE'
);
```

Also assert that replaying the same request returns the saved event version without updating the closure or inserting a second operation log.

Add a daily-result review case that keeps `result_status='MISSING_PUNCH'`, changes only `review_status='APPROVED'`, and rejects a result outside `projectScope`. Add a recalculation case proving any new punch/recalculation resets `review_status='NONE'`, `reviewed_by=NULL`, and `reviewed_at=NULL`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node test/attendance-daily-closure.test.js`

Expected: FAIL with `Cannot find module '../src/services/attendance-closure.service'`.

- [ ] **Step 3: Implement validation and project scope**

Implement these validators exactly:

```js
function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validRequestId(value) {
  return /^[A-Za-z0-9:_-]{8,64}$/.test(String(value || ''));
}
```

`assertProject` must select `labor_project p` by `company_id` and `id`, append `projectScope(user, params, 'p')`, and use `FOR UPDATE` for writes.

- [ ] **Step 4: Implement idempotent confirm/reopen transactions**

Within a fixed lock order:

1. Read `attendance_daily_closure_events` by `(company_id, client_request_id)`; return its saved action result on replay.
2. Lock the project.
3. Lock or create the closure row.
4. For confirm, count pending corrections, `MISSING_PUNCH`/abnormal-geofence daily results whose `review_status<>'APPROVED'`, and schedules whose effective end time has not passed; throw `ATTENDANCE_PENDING` when nonzero.
5. For reopen, require a non-empty reason and count `wage_daily_payments.status='PAID'`; throw `DAILY_PAYMENT_ACTIVE` when nonzero.
6. Increment `version_no`, update current closure state, append one event, cancel current project wage previews, and append one sanitized `hr_operation_log` row.

Do not include employee names, coordinates, phone numbers, or request bodies in `hr_operation_log.after_data`.

`reviewDailyException` accepts only `CONFIRM_EXCEPTION`, a non-empty review comment, and an 8–64 character request ID. It first replays an existing `attendance_daily_review_events` row with the same company/request ID. Otherwise it locks the scoped daily result, verifies `MISSING_PUNCH` or an associated punch with `geofence_status IN ('OUTSIDE','LOW_ACCURACY','LOCATION_FAILED')`, updates only review fields, appends the review event, and logs IDs/statuses. Update `recalculateDaily`'s duplicate-key clause to reset all current review fields whenever punch-derived attendance changes; never delete review events.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node test/attendance-daily-closure.test.js
node test/data-scope.test.js
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Add the test to `npm run check` and commit**

```bash
git add src/services/attendance-closure.service.js src/services/attendance.service.js test/attendance-daily-closure.test.js package.json
git commit -m "feat: confirm and reopen attendance days"
```

---

### Task 3: Exception-First Attendance Read Model and API

**Files:**
- Create: `src/services/attendance-workbench.service.js`
- Modify: `src/controllers/attendance.controller.js`
- Modify: `src/routes/attendance.routes.js`
- Create: `test/attendance-workbench.test.js`
- Create: `test/attendance-workbench-api.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `attendance_daily_results`, correction requests, punches, closure state, `projectScope`.
- Produces:
  - `getWorkbench(companyId, user, query) -> {closure, summary, list}`
  - `GET /api/attendance/workbench`
  - `POST /api/attendance/daily-close`
  - `PUT /api/attendance/daily-results/:id/review`
  - `POST /api/attendance/daily-reopen`

- [ ] **Step 1: Write failing service tests for aggregate and privacy**

Test one project/day fixture containing normal, late, missing punch, absent, and pending correction rows. Assert:

```js
const result = await service.getWorkbench(3, user, {
  projectId: 12,
  date: '2026-09-29',
  status: 'PENDING',
  keyword: '张'
});
assert.deepEqual(result.summary, {
  scheduled: 5,
  present: 3,
  normal: 1,
  late: 1,
  earlyLeave: 0,
  missingPunch: 1,
  absent: 1,
  geofenceException: 1,
  pendingReview: 1
});
assert.equal(JSON.stringify(result).includes('hourlyRate'), false);
assert.equal(JSON.stringify(result).includes('earnedAmount'), false);
```

- [ ] **Step 2: Run service test and verify failure**

Run: `node test/attendance-workbench.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement a bounded read model**

Validate `projectId`, exact `YYYY-MM-DD` date, optional status in `ALL|PENDING|NORMAL|LATE|EARLY_LEAVE|MISSING_PUNCH|ABSENT|GEOFENCE`, and keyword length at most 50. Use one aggregate query and one pageless project-day detail query; the maximum list is the active project workforce for one day, so do not add arbitrary cross-project pagination.

Return only:

```js
{
  closure: { status: 'OPEN', versionNo: 0, confirmedAt: null },
  summary: { scheduled, present, normal, late, earlyLeave, missingPunch, absent, geofenceException, pendingReview },
  list: [{ employeeId, name, firstInAt, lastOutAt, workedMinutes, approvedMinutes, resultStatus, geofenceStatus, pendingReason }]
}
```

Do not select any wage/profile/allowance table.

- [ ] **Step 4: Write and run failing route contracts**

In `test/attendance-workbench-api.test.js`, load route/controller source and assert the route order and middleware:

```js
assert.match(routes, /router\.get\('\/attendance\/workbench', requireAuth, requirePermission\('attendance:view'\), controller\.workbench\)/);
assert.match(routes, /router\.post\('\/attendance\/daily-close', sensitiveLimiter, requireAuth, requirePermission\('attendance:review'\), controller\.confirmDailyClosure\)/);
assert.match(routes, /router\.put\('\/attendance\/daily-results\/:id\/review', sensitiveLimiter, requireAuth, requirePermission\('attendance:review'\), controller\.reviewDailyException\)/);
assert.match(routes, /router\.post\('\/attendance\/daily-reopen', sensitiveLimiter, requireAuth, requirePermission\('attendance:review'\), controller\.reopenDailyClosure\)/);
```

Run: `node test/attendance-workbench-api.test.js`

Expected: FAIL because routes/controllers are absent.

- [ ] **Step 5: Add thin controller adapters and routes**

Import `sensitiveLimiter` in `attendance.routes.js`. Controller methods must pass only trusted context and explicit body/query objects:

```js
exports.workbench = asyncHandler(async (req, res) =>
  success(res, await workbenchService.getWorkbench(req.companyId, req.user, req.query)));
exports.confirmDailyClosure = asyncHandler(async (req, res) =>
  success(res, await closureService.confirmDailyClosure(req.companyId, req.user, req.operatorId, req.body), '考勤日已确认'));
exports.reviewDailyException = asyncHandler(async (req, res) =>
  success(res, await closureService.reviewDailyException(req.companyId, req.user, req.operatorId, Number(req.params.id), req.body), '考勤异常已确认'));
exports.reopenDailyClosure = asyncHandler(async (req, res) =>
  success(res, await closureService.reopenDailyClosure(req.companyId, req.user, req.operatorId, req.body), '考勤日已重新打开'));
```

- [ ] **Step 6: Run focused API checks and commit**

```bash
node test/attendance-workbench.test.js
node test/attendance-workbench-api.test.js
node test/attendance-security-regression.test.js
node -e "require('./src/app'); console.log('express-route-load-ok')"
git diff --check
git add src/services/attendance-workbench.service.js src/controllers/attendance.controller.js src/routes/attendance.routes.js test/attendance-workbench.test.js test/attendance-workbench-api.test.js package.json
git commit -m "feat: add attendance exception workbench API"
```

---

### Task 4: Attendance Exception Workbench UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/js/views/attendance.js`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Create: `test/web-attendance-exception-workbench.test.js`
- Modify: `test/web-project-attendance-ui.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 3 workbench/closure APIs and existing `attendanceState`, request gate, project/date selectors.
- Produces: exception summary cards, filters, closure status/action, and payroll-safe shortcut state.

- [ ] **Step 1: Write the failing UI contract**

Assert exact IDs and behavior markers:

```js
for (const id of [
  'attendanceExceptionSummary', 'attendanceExceptionStatusFilter', 'attendanceEmployeeKeyword',
  'attendanceExceptionBody', 'attendanceClosureStatus', 'attendanceConfirmDay',
  'attendanceReopenDay', 'attendanceDailySettlementLink'
]) assert.match(html, new RegExp(`id="${id}"`));
assert.match(js, /async function loadAttendanceWorkbench\(/);
assert.match(js, /async function confirmAttendanceDay\(/);
assert.match(js, /async function reopenAttendanceDay\(/);
assert.match(js, /\/api\/attendance\/workbench/);
assert.doesNotMatch(html, /attendanceExceptionBody[^]*时薪|attendanceExceptionBody[^]*应结金额/);
```

- [ ] **Step 2: Run the UI test and verify failure**

Run: `node test/web-attendance-exception-workbench.test.js`

Expected: FAIL with the first missing ID.

- [ ] **Step 3: Add the exception-first markup**

Keep existing daily/monthly/settings/geofence panels. Replace the daily panel's first content block with:

1. Closure status and actions.
2. Eight summary cards.
3. `PENDING`-default status select and 50-character keyword input.
4. Exception table with employee, punch times, worked/approved hours, result, geofence status, pending reason, and existing review actions.
5. A shortcut button with `data-action-perm="payroll:view"`; it contains only status text, never amount.

- [ ] **Step 4: Implement request-safe rendering and closure actions**

Add a dedicated request-gate key `workbench`. `loadAttendanceWorkbench(projectId, date)` must discard stale project/date responses. Generate request IDs without personal data:

```js
function attendanceClientRequestId(action, projectId, date) {
  return `${action}:${projectId}:${date}:${Date.now().toString(36)}`;
}
```

`confirmAttendanceDay` uses `withSubmitLock`, a confirmation dialog, then POSTs `projectId`, `shiftDate`, and request ID. `reopenAttendanceDay` requires a non-empty reason before sending. On success reload workbench, daily report, and corrections; on `409` retain filters and show the server message.

Add `reviewAttendanceDailyException(resultId)` for missing-punch or abnormal-geofence rows. It requires a review comment, uses `withSubmitLock`, calls `PUT /api/attendance/daily-results/:id/review`, and reloads the workbench without changing the displayed result status.

- [ ] **Step 5: Keep existing contracts and responsive layout green**

Add CSS using the existing `.attendance-*` tokens. At `max-width: 760px`, summary cards wrap to two columns, filters stack, and the table remains horizontally scrollable without hiding actions.

Update `public/app.js` only if the current monolithic fallback still duplicates attendance view behavior; do not add a second API call path.

- [ ] **Step 6: Run browser contracts and commit Phase A**

```bash
node test/web-attendance-exception-workbench.test.js
node test/web-project-attendance-ui.test.js
node test/frontend-operation-feedback.test.js
node test/web-submit-lock.test.js
node test/web-action-permission-alignment.test.js
git diff --check
git add public/index.html public/js/views/attendance.js public/styles.css public/app.js test/web-attendance-exception-workbench.test.js test/web-project-attendance-ui.test.js package.json
git commit -m "feat: prioritize attendance exceptions on web"
```

Phase A acceptance: an attendance reviewer can resolve pending items, confirm a project day, reopen it with a reason, and never receive payroll amounts.

---

### Task 5: Daily Settlement Event Schema and Closure-Version Wage Gating

**Files:**
- Create: `sql/migrate-wage-daily-settlement-events-20260929.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Modify: `src/services/wage-calculation.service.js`
- Create: `test/wage-daily-settlement-schema.test.js`
- Create: `test/wage-daily-settlement-preview.test.js`
- Modify: `test/release-migration-consistency.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: confirmed closures and the existing `createPreview/getPreview` service.
- Produces: `wage_daily_payment_events`, closure snapshot columns on daily wage lines, and `BLOCKED` results for unconfirmed/stale attendance days.

- [ ] **Step 1: Write failing schema and preview tests**

Schema assertions:

```js
assert.match(migration, /CREATE TABLE IF NOT EXISTS wage_daily_payment_events/);
assert.match(migration, /UNIQUE KEY uk_wage_daily_payment_event_request \(company_id, client_request_id, employee_id\)/);
assert.match(migration, /attendance_closure_id BIGINT DEFAULT NULL/);
assert.match(migration, /attendance_closure_version INT UNSIGNED DEFAULT NULL/);
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
```

Preview fixture assertions:

```js
assert.equal(openDay.days[0].calculationStatus, 'BLOCKED');
assert.equal(openDay.days[0].blockedReason, '考勤日未确认');
assert.equal(confirmedDay.days[0].calculationStatus, 'READY');
assert.equal(confirmedDay.days[0].payableMinutes, 510);
assert.equal(confirmedDay.days[0].earnedAmount, '180.00');
```

The fixture uses 480 normal + 30 approved overtime minutes at `20.00/hour` plus `10.00` shift allowance, proving all approved minutes use the same rate.

- [ ] **Step 2: Run tests and verify failure**

```bash
node test/wage-daily-settlement-schema.test.js
node test/wage-daily-settlement-preview.test.js
```

Expected: schema test fails on missing migration; preview test fails because closure status is not loaded.

- [ ] **Step 3: Add the event migration and snapshot columns safely**

Create `wage_daily_payment_events` exactly as specified. Add each column to `wage_calculation_daily_lines` only after an `information_schema.COLUMNS` check using the migration repository's prepared-statement pattern; do not use `DROP` or destructive backfill. Old lines remain `NULL`.

Add the migration after the closure migration in deployment order. Add it to the `REQUIRED` array in `scripts/verify-release-package.sh`. Extend release verification to require the event table and both columns.

- [ ] **Step 4: Gate wage calculations on closure state/version**

Extend `loadAttendanceRows` with a left join to `attendance_daily_closures` and aliases `attendanceClosureId`, `attendanceClosureStatus`, `attendanceClosureVersion`. Before existing wage validation:

```js
if (row.attendanceClosureStatus !== 'CONFIRMED') {
  return blockedResult('考勤日未确认', dailyPaidAmount);
}
```

Persist closure ID/version in `insertDailyLine`. Do not change `roundPayableMinutes` or introduce overtime multipliers.

- [ ] **Step 5: Run focused regression and commit**

```bash
node test/wage-daily-settlement-schema.test.js
node test/wage-daily-settlement-preview.test.js
node test/hourly-wage-calculator.test.js
node test/wage-calculation-preview.test.js
node test/release-migration-consistency.test.js
bash -n scripts/deploy-production.sh
bash -n scripts/verify-release-package.sh
git diff --check
git add sql/migrate-wage-daily-settlement-events-20260929.mysql.sql sql/schema.mysql.sql scripts/deploy-production.sh scripts/verify-release-package.sh src/services/wage-calculation.service.js test/wage-daily-settlement-schema.test.js test/wage-daily-settlement-preview.test.js test/release-migration-consistency.test.js package.json
git commit -m "feat: gate daily wages on confirmed attendance"
```

---

### Task 6: Atomic Daily Settlement Service and Payroll API

**Files:**
- Create: `src/services/daily-settlement.service.js`
- Create: `src/controllers/daily-settlement.controller.js`
- Create: `src/routes/daily-settlement.routes.js`
- Modify: `src/routes/index.js`
- Create: `test/wage-daily-settlement-batch.test.js`
- Create: `test/wage-daily-settlement-api.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: latest preview/daily lines, closure version, current payment row, payment event table, project scope.
- Produces:
  - `createDailyPreview(companyId, user, operatorId, body)`
  - `listDailySettlements(companyId, user, query)`
  - `confirmBatch(companyId, user, operatorId, body)`
  - `revokePayment(companyId, user, operatorId, paymentId, body)`
  - `listPaymentEvents(companyId, user, paymentId)`

- [ ] **Step 1: Write failing batch/idempotency/concurrency tests**

Test an all-ready two-employee batch:

```js
const result = await service.confirmBatch(3, user, 9, {
  projectId: 12,
  shiftDate: '2026-09-29',
  runId: 81,
  closureVersion: 3,
  employeeIds: [101, 102],
  remark: '现金日结已核对',
  clientRequestId: 'daily-pay-12-20260929-batch-1'
});
assert.deepEqual(result, { status: 'PAID', paidCount: 2, totalAmount: '360.00' });
```

Also assert:

- duplicate request returns the same result and writes no new payment/event/log rows;
- one selected row changing to `BLOCKED` rolls back all writes with `DAILY_WAGE_BLOCKED`;
- closure version mismatch returns `WAGE_PREVIEW_STALE`;
- more than 500 employee IDs returns `INVALID_DAILY_PAYMENT`;
- revoke without reason returns `DAILY_PAYMENT_REMARK_REQUIRED`;
- revoke appends an event and retains the original `paid_by`, `paid_at`, and amount in event history.

- [ ] **Step 2: Run tests and verify failure**

Run: `node test/wage-daily-settlement-batch.test.js`

Expected: FAIL because `daily-settlement.service.js` does not exist.

- [ ] **Step 3: Implement read/preview functions**

`createDailyPreview` validates exact date, calls existing `wageCalculation.createPreview` with `salaryMonth = shiftDate.slice(0, 7)`, then returns only selected-date lines. It must not call `confirmPreview` or create a salary batch.

`listDailySettlements` reads the latest non-confirmed calculation run for the month, filters one date, joins current payments, and derives statuses:

```js
function settlementStatus(line, payment) {
  if (payment?.status === 'PAID') return 'PAID';
  if (line.calculationStatus === 'BLOCKED') return 'BLOCKED';
  if (line.calculationStatus === 'ZERO') return 'NO_PAYMENT';
  return 'READY';
}
```

Only `payroll:view` routes expose the returned monetary fields.

- [ ] **Step 4: Implement atomic confirm and revoke commands**

`confirmBatch` validates unique positive employee IDs, sorts them numerically for deterministic locking, and enforces a maximum of 500. In one transaction:

1. Return saved events for a complete idempotent replay.
2. Lock project, closure, run, selected daily lines, then payment rows in that order.
3. Verify run is the latest usable revision, every line matches project/date/closure version, settlement mode is `DAILY_PAID`, and status is `READY`.
4. Upsert current `wage_daily_payments`, append one payment event per employee, and write one batch operation log with only IDs/count/total.
5. Return count and total; any mismatch throws and rolls back the entire transaction.

`revokePayment` locks the scoped payment row, requires `PAID`, updates current status to `REVOKED`, appends a `REVOKE` event, invalidates project previews, and writes a sanitized log.

- [ ] **Step 5: Write failing route contracts, then expose payroll-only routes**

Required routes:

```js
router.post('/wage-daily-settlements/preview', sensitiveLimiter, requireAuth, requirePermission('payroll:manage'), controller.createPreview);
router.get('/wage-daily-settlements', requireAuth, requirePermission('payroll:view'), controller.list);
router.post('/wage-daily-settlements/batch-confirm', batchLimiter, requireAuth, requirePermission('payroll:manage'), controller.confirmBatch);
router.post('/wage-daily-settlements/:id/revoke', sensitiveLimiter, requireAuth, requirePermission('payroll:manage'), controller.revoke);
router.get('/wage-daily-settlements/:id/events', requireAuth, requirePermission('payroll:view'), controller.events);
```

Register `dailySettlementRoutes` in `src/routes/index.js` after attendance routes. Controllers pass `req.companyId`, `req.user`, `req.operatorId`, explicit path IDs, and body/query only.

- [ ] **Step 6: Run focused backend checks and commit**

```bash
node test/wage-daily-settlement-batch.test.js
node test/wage-daily-settlement-api.test.js
node test/wage-calculation-isolation.test.js
node test/data-isolation-regression.test.js
node -e "require('./src/app'); console.log('express-route-load-ok')"
git diff --check
git add src/services/daily-settlement.service.js src/controllers/daily-settlement.controller.js src/routes/daily-settlement.routes.js src/routes/index.js test/wage-daily-settlement-batch.test.js test/wage-daily-settlement-api.test.js package.json
git commit -m "feat: add atomic daily settlement API"
```

---

### Task 7: Independent Daily Settlement Web Workspace

**Files:**
- Create: `public/js/views/daily-settlement.js`
- Modify: `public/index.html`
- Modify: `public/js/core/router.js`
- Modify: `public/js/core/navigation-groups.js`
- Modify: `public/js/views/attendance.js`
- Modify: `public/styles.css`
- Create: `test/web-daily-settlement.test.js`
- Modify: `test/web-navigation-groups.test.js`
- Modify: `test/web-action-permission-alignment.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 6 APIs, existing project selector data, `api`, `withSubmitLock`, `createRequestGate`, `escapeHtml`, `toast`.
- Produces: `loadDailySettlement()`, payroll navigation entry, batch/single confirm, revoke, event history, and attendance shortcut navigation.

- [ ] **Step 1: Write failing navigation and page contracts**

```js
assert.match(navigation, /view: 'dailySettlement', label: '日结薪资', permissions: \['payroll:view'\]/);
assert.match(router, /dailySettlement: \(\) => loadDailySettlement\(\)/);
assert.match(router, /dailySettlement: '#dailySettlementView'/);
for (const id of [
  'dailySettlementView', 'dailySettlementProject', 'dailySettlementDate',
  'dailySettlementStatus', 'dailySettlementKeyword', 'dailySettlementSummary',
  'dailySettlementBody', 'dailySettlementRefresh', 'dailySettlementBatchConfirm'
]) assert.match(html, new RegExp(`id="${id}"`));
assert.match(js, /async function loadDailySettlement\(/);
assert.match(js, /async function confirmDailySettlementBatch\(/);
assert.match(js, /async function revokeDailySettlement\(/);
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node test/web-daily-settlement.test.js`

Expected: FAIL on the missing navigation item.

- [ ] **Step 3: Add permission-scoped navigation and markup**

Add `{ view: 'dailySettlement', label: '日结薪资', permissions: ['payroll:view'] }` under the existing payroll group. Add a separate `#dailySettlementView`; do not place monetary columns inside `#attendanceView`.

The settlement table columns are: checkbox, employee, shift, actual hours, approved hours, hourly rate, base amount, allowance, earned amount, status, action. Add a hidden detail row/dialog for punch summary, formula, allowance items, and events.

- [ ] **Step 4: Implement isolated page state and stale-request protection**

Use a page-local state object and request gate:

```js
const dailySettlementState = {
  projects: [], projectId: 0, shiftDate: '', runId: 0, closureVersion: 0,
  rows: [], selectedEmployeeIds: new Set(), listenersBound: false
};
const dailySettlementRequestGate = createRequestGate();
```

Loading a project/date calls POST preview only when the user has `payroll:manage`; read-only payroll users call GET list and see the latest available preview. Render `BLOCKED` and `NO_PAYMENT` as disabled checkboxes. Escape every dynamic label/reason.

- [ ] **Step 5: Implement batch, single, revoke, and attendance shortcut**

Batch confirmation sends selected ready IDs, run ID, closure version, remark, and a fresh request ID through `withSubmitLock`. Single confirmation calls the same function with one ID. Revoke requires non-empty reason. A `409` clears the current selection, retains filters, and reloads the list.

The attendance shortcut calls `switchView('dailySettlement')` only when `attendanceCan('payroll:view')`; it copies project/date as navigation context but does not copy or expose amounts in attendance state.

- [ ] **Step 6: Add responsive styles and run UI regression**

At desktop width keep filters in one row and summary cards in four columns. At `max-width: 760px`, stack filters and actions, allow horizontal table scroll, and keep batch confirmation visible after selection.

Run:

```bash
node test/web-daily-settlement.test.js
node test/web-navigation-groups.test.js
node test/web-action-permission-alignment.test.js
node test/web-submit-lock.test.js
node test/frontend-core-split.test.js
git diff --check
```

- [ ] **Step 7: Commit the web workspace**

```bash
git add public/js/views/daily-settlement.js public/index.html public/js/core/router.js public/js/core/navigation-groups.js public/js/views/attendance.js public/styles.css test/web-daily-settlement.test.js test/web-navigation-groups.test.js test/web-action-permission-alignment.test.js package.json
git commit -m "feat: add daily settlement web workspace"
```

---

### Task 8: Cross-Role Security Regression and Complete Verification

**Files:**
- Create: `test/attendance-payroll-permission-isolation.test.js`
- Modify: `src/services/attendance-project.service.js`
- Modify: `test/attendance-project-wage-rules.test.js`
- Modify: `scripts/post-deploy-verify.sh`
- Modify: `test/post-deploy-verification-contract.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: all Phase A/B APIs and frontend permissions.
- Produces: release-blocking proof that attendance users cannot access payroll amounts and payroll writes cannot bypass confirmed attendance.

- [ ] **Step 1: Write the failing cross-role regression**

The test must exercise or source-contract these cases:

```js
assert.equal(JSON.stringify(attendanceResponse).includes('hourlyRate'), false);
assert.equal(JSON.stringify(attendanceResponse).includes('earnedAmount'), false);
assert.equal(JSON.stringify(attendanceProjectSettings).includes('unitAmount'), false);
await assert.rejects(() => callSettlementList(attendanceOnlyUser), /无权限/);
await assert.rejects(() => callBatchConfirm(payrollViewOnlyUser), /无权限/);
await assert.rejects(() => callBatchConfirm(payrollManager, { closureStatus: 'OPEN' }),
  error => error.businessCode === 'DAILY_WAGE_BLOCKED');
```

Also verify customer/project A cannot read or mutate project B even when employee IDs overlap in fixtures.

Extend `test/attendance-project-wage-rules.test.js` with two users: an attendance-only user receives day/night time fields but no `hourlyRate` or allowances; a user submitting `shifts[].hourlyRate` or `allowances` without `payroll:manage` receives `PAYROLL_PERMISSION_REQUIRED`.

- [ ] **Step 2: Run the test and verify it fails before final wiring**

Run: `node test/attendance-payroll-permission-isolation.test.js`

Expected: FAIL until all middleware/response projections are correct.

- [ ] **Step 3: Make only the minimal permission/projection fixes**

Do not add UI-only guards as the fix. Correct route middleware, service project scope, or selected response fields. In `getProjectSettings`, derive `canViewPayroll = user.permissions.includes('payroll:view')`; when false, omit `hourlyRate` and return no allowance amount/list while retaining non-monetary shift times. In `saveProjectSettings`, detect submitted `hourlyRate`/allowance fields and require `user.permissions.includes('payroll:manage')`, otherwise throw `createError('无薪资配置权限', 403, 'PAYROLL_PERMISSION_REQUIRED')`. Add the new regression to `npm run check`.

- [ ] **Step 4: Extend post-deploy read-only contract**

Extend the existing public-resource step in `scripts/post-deploy-verify.sh` to download `/js/views/daily-settlement.js`, require the marker `loadDailySettlement`, and check unauthenticated `GET /api/attendance/workbench` plus `GET /api/wage-daily-settlements` both return `401`. Add the new temporary file to the existing cleanup trap. Do not call preview, close, reopen, confirm, or revoke endpoints. Production write acceptance remains manual and separately authorized.

- [ ] **Step 5: Run the complete verification gate**

```bash
node test/attendance-payroll-permission-isolation.test.js
npm run check
npm audit --audit-level=high
git diff --check
bash -n scripts/deploy-production.sh
PACKAGE_OUTPUT="$(bash scripts/build-release-package.sh)"
PACKAGE_PATH="$(printf '%s\n' "$PACKAGE_OUTPUT" | sed -n 's/^  路径:[[:space:]]*//p')"
test -n "$PACKAGE_PATH" && test -f "$PACKAGE_PATH"
bash scripts/verify-release-package.sh "$PACKAGE_PATH"
git status --short --branch
```

Expected:

- focused regression exits `0`;
- complete check exits `0` with no failed test;
- audit reports `0 vulnerabilities` at high threshold;
- no whitespace errors;
- shell syntax valid;
- release package verification reports success and does not include `.env` files;
- worktree contains only intentional commits and no generated release archive.

- [ ] **Step 6: Commit final security coverage**

```bash
git add src/services/attendance-project.service.js test/attendance-project-wage-rules.test.js test/attendance-payroll-permission-isolation.test.js scripts/post-deploy-verify.sh test/post-deploy-verification-contract.test.js package.json
git commit -m "test: secure attendance daily settlement boundary"
```

## Final Acceptance Checklist

- [ ] Attendance reviewer sees exception-first counts/list and no wage fields.
- [ ] Pending exceptions or active shift windows block day confirmation.
- [ ] Paid daily wages block reopening until payroll revokes them.
- [ ] Reopen reason, closure versions, payment/revoke/repay events remain auditable.
- [ ] Daily wage uses approved normal + approved overtime minutes at the same shift hourly rate, plus configured allowances.
- [ ] Batch confirmation is atomic, idempotent, limited to 500 employees, and project-scoped.
- [ ] Daily settlement does not publish payslips, create salary batches, or invoke a payment provider.
- [ ] Desktop/tablet/mobile layouts keep critical actions reachable.
- [ ] Full local verification passes before any push, PR, migration, or deployment request.
