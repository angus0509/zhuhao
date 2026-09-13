# Flexible XLSX Payslip Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import project-specific CSV/XLSX payroll files without a fixed template, preserve every selected payroll item, and show the same items on the employee mini-program payslip.

**Architecture:** Extend the existing browser-side `PayrollImport` parser with deterministic column mapping and dynamic item snapshots. Persist reusable mappings per company/project/header signature, keep existing normalized salary columns for summaries and compatibility, and add an optional JSON snapshot to each salary detail. Existing payslips with no snapshot continue through the current fixed-field renderer.

**Tech Stack:** Browser JavaScript, ExcelJS 4.4, Node.js 18+ / Express, MySQL 8 JSON columns, WeChat Mini Program, Node assert-based tests.

**Spec:** `docs/superpowers/specs/2026-08-18-flexible-xlsx-payslip-import-design.md`

## Global Constraints

- Support `.xlsx` and `.csv`; reject `.xls`; file limit remains 10 MB.
- Limit each batch to 500 employee rows, 100 source columns, 80 displayed items per employee, and 50 characters per item label.
- At least one employee identity mapping and exactly one `netAmount` mapping are required.
- Never place full ID card numbers, phone numbers, bank card numbers, or formulas in `itemSnapshot`, logs, or user-visible errors.
- Preserve existing payroll publish, withdraw, signature, receipt, dispute, project scope, and tenant isolation behavior.
- Historical `salary_detail.item_snapshot IS NULL` rows must retain the current fixed-field display.
- Do not deploy, upload, push, or create a Git commit without explicit user authorization; commit commands below are handoff checkpoints only.

---

## File Structure

- `public/js/core/payroll-import.js`: detect headers, build/validate column mappings, parse rows, create safe dynamic item snapshots.
- `public/js/core/payroll-column-mapping.js`: pure mapping-state helpers used by the Web mapping panel.
- `public/app.js`: read CSV/XLSX, fetch reusable mappings, render mapping/preview, submit snapshots.
- `public/index.html`, `public/styles.css`: mapping panel and separate CSV/XLSX example buttons.
- `src/services/payroll-import-profile.service.js`: project-scoped mapping lookup and transaction-safe upsert.
- `src/services/operations.service.js`: server-side snapshot validation, preview, batch persistence.
- `src/controllers/operations.controller.js`, `src/routes/operations.routes.js`: mapping lookup endpoint.
- `src/services/payslip.service.js`: safe JSON parsing and employee-only dynamic item response.
- `wechat-miniprogram/miniprogram/pages/my-payslips/detail/*`: dynamic item rendering with fixed-field fallback.
- `sql/schema.mysql.sql`, `sql/migrate-flexible-payslip-items-20260818.mysql.sql`: additive schema.
- `scripts/deploy-production.sh`, `scripts/verify-release-package.sh`: migration packaging and production verification.

---

### Task 1: Add Additive Payroll Import Schema

**Files:**
- Create: `sql/migrate-flexible-payslip-items-20260818.mysql.sql`
- Modify: `sql/schema.mysql.sql:689-732`
- Modify: `scripts/deploy-production.sh:124-180`
- Modify: `scripts/verify-release-package.sh:110-140,236-270`
- Modify: `test/release-migration-consistency.test.js`
- Create: `test/payroll-dynamic-schema.test.js`

**Interfaces:**
- Produces: `salary_import_profile`, `salary_batch.import_profile_id`, `salary_batch.source_sheet_name`, `salary_detail.item_snapshot`, `salary_detail.source_row_no`.
- Consumes: existing `salary_batch`, `salary_detail`, `labor_project`, `sys_user_project` tables.

- [ ] **Step 1: Write failing schema and release-chain tests**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const schema = fs.readFileSync('sql/schema.mysql.sql', 'utf8');
const migration = fs.readFileSync('sql/migrate-flexible-payslip-items-20260818.mysql.sql', 'utf8');
assert.match(schema, /CREATE TABLE salary_import_profile/);
assert.match(schema, /item_snapshot JSON DEFAULT NULL/);
assert.match(migration, /information_schema\.COLUMNS/);
assert.doesNotMatch(migration, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
```

- [ ] **Step 2: Run tests and verify the migration is missing**

Run: `node test/payroll-dynamic-schema.test.js`

Expected: FAIL because the migration file/table/columns do not exist.

- [ ] **Step 3: Add idempotent schema and deployment wiring**

Create the mapping table with `UNIQUE KEY uk_company_project_signature (company_id,project_id,header_signature)` and the two specified indexes. Use `information_schema.COLUMNS` plus prepared `ALTER TABLE` statements for each additive column, matching the repository's existing idempotent migration style. Add this migration to the release manifest, migration audit list, deployment sequence, and post-migration checks:

```bash
PAYROLL_PROFILE_READY="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='salary_import_profile'")"
PAYROLL_ITEMS_READY="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='salary_detail' AND COLUMN_NAME='item_snapshot'")"
test "$PAYROLL_PROFILE_READY" = "1" && test "$PAYROLL_ITEMS_READY" = "1"
```

- [ ] **Step 4: Run schema and release tests**

Run: `node test/payroll-dynamic-schema.test.js && node test/release-migration-consistency.test.js`

Expected: both print their `*-tests-ok` messages.

- [ ] **Step 5: Commit checkpoint after authorization**

```bash
git add sql/schema.mysql.sql sql/migrate-flexible-payslip-items-20260818.mysql.sql scripts/deploy-production.sh scripts/verify-release-package.sh test/payroll-dynamic-schema.test.js test/release-migration-consistency.test.js
git commit -m "feat: add flexible payslip import schema"
```

---

### Task 2: Parse Dynamic Columns and Build Safe Item Snapshots

**Files:**
- Modify: `public/js/core/payroll-import.js`
- Create: `test/payroll-dynamic-import-parser.test.js`
- Modify: `test/payroll-flexible-import-parser.test.js`

**Interfaces:**
- Produces: `buildSuggestedMapping(headers)`, `validateColumnMapping(mapping)`, `parseMappedPayrollRows(rows, header, mapping)`.
- Produces row shape: `{ employeeName, employeeNo, idCardNo, phone, grossAmount, netAmount, itemSnapshot, sourceRowNo, errors, warnings }`.
- Consumes: existing `normalizeHeader`, `detectHeaderRow`, alias definitions, amount parsing rules.

- [ ] **Step 1: Write failing parser tests for unknown project fields**

```js
const parser = require('../public/js/core/payroll-import');
const parsed = parser.parseFlexiblePayrollRows([
  ['姓名', '底薪', '夜班奖', '住宿扣款', '实发工资', '班组'],
  ['张三', '4500', '380', '150', '4730', 'A组']
]);
assert.deepEqual(parsed.rows[0].itemSnapshot, [
  { label: '底薪', value: 4500, category: 'income', sortOrder: 1 },
  { label: '夜班奖', value: 380, category: 'income', sortOrder: 2 },
  { label: '住宿扣款', value: 150, category: 'deduction', sortOrder: 3 },
  { label: '实发工资', value: 4730, category: 'summary', sortOrder: 4 },
  { label: '班组', value: 'A组', category: 'display', sortOrder: 5 }
]);
```

Also assert that identity columns are absent from the snapshot, formulas fail, labels over 50 characters fail, more than 80 selected items fail, and a mapping without exactly one `netAmount` fails.

- [ ] **Step 2: Run parser tests and verify dynamic items are absent**

Run: `node test/payroll-dynamic-import-parser.test.js`

Expected: FAIL because `itemSnapshot` and mapping APIs do not exist.

- [ ] **Step 3: Implement mapping suggestions and snapshot parsing**

Use mapping entries with this stable interface:

```js
{
  columnIndex: 2,
  sourceHeader: '夜班奖',
  target: 'custom',
  category: 'income',
  includeInPayslip: true
}
```

Known identity fields map to `employeeName|employeeNo|idCardNo|phone` with `includeInPayslip:false`. Known totals map to `grossAmount|netAmount`; unknown numeric columns use keyword suggestions (`扣|税|罚|水电|住宿|预支` => `deduction`, otherwise `income`), while unknown text columns default to `display`. Preserve source order in `sortOrder`.

- [ ] **Step 4: Run new and existing parser tests**

Run: `node test/payroll-dynamic-import-parser.test.js && node test/payroll-flexible-import-parser.test.js`

Expected: both pass; existing normalized amount assertions remain unchanged.

- [ ] **Step 5: Commit checkpoint after authorization**

```bash
git add public/js/core/payroll-import.js test/payroll-dynamic-import-parser.test.js test/payroll-flexible-import-parser.test.js
git commit -m "feat: preserve dynamic payroll columns"
```

---

### Task 3: Persist and Reuse Project Column Mappings

**Files:**
- Create: `src/services/payroll-import-profile.service.js`
- Modify: `src/controllers/operations.controller.js`
- Modify: `src/routes/operations.routes.js`
- Create: `test/payroll-import-profile.test.js`
- Modify: `test/data-isolation-regression.test.js`

**Interfaces:**
- Produces: `findProfile(companyId, projectId, headerSignature, user)`.
- Produces: `upsertProfile(connection, { companyId, projectId, headerSignature, sourceHeaders, mapping, operatorId })`.
- HTTP: `GET /api/payroll/import-profiles?projectId=<id>&headerSignature=<64 hex>`.
- Consumes: `projectScope(user, params, 'p')`, `payroll:manage` permission, MySQL JSON fields.

- [ ] **Step 1: Write failing project-scope and validation tests**

Test that a 64-character lowercase SHA-256 is required, project scope is present in the SQL, mapping JSON excludes source row values, a missing profile returns `null`, and upsert uses `(company_id,project_id,header_signature)` without cross-tenant fallback.

- [ ] **Step 2: Run the profile test**

Run: `node test/payroll-import-profile.test.js`

Expected: FAIL because the service and route do not exist.

- [ ] **Step 3: Implement service, controller, and route**

Register before parameterized payroll batch routes:

```js
router.get('/payroll/import-profiles', requirePermission('payroll:manage'), controller.getPayrollImportProfile);
```

Return `null` when no mapping matches. Validate `sourceHeaders` as at most 100 strings of 50 characters and `mapping` as at most 100 entries using the Task 2 target/category catalog.

- [ ] **Step 4: Run profile and tenant-isolation tests**

Run: `node test/payroll-import-profile.test.js && node test/data-isolation-regression.test.js`

Expected: both pass.

- [ ] **Step 5: Commit checkpoint after authorization**

```bash
git add src/services/payroll-import-profile.service.js src/controllers/operations.controller.js src/routes/operations.routes.js test/payroll-import-profile.test.js test/data-isolation-regression.test.js
git commit -m "feat: reuse project payroll mappings"
```

---

### Task 4: Validate and Store Dynamic Payslip Items Server-Side

**Files:**
- Modify: `src/services/operations.service.js:1140-1360`
- Create: `src/services/payroll-item-snapshot.service.js`
- Create: `test/payroll-dynamic-persistence.test.js`
- Modify: `test/payroll-import-preview.test.js`

**Interfaces:**
- Produces: `normalizeItemSnapshot(items)` returning validated `{ label, value, category, sortOrder }[]`.
- Consumes: Task 3 `upsertProfile(...)` and Task 2 request shape.
- Persists: `salary_detail.item_snapshot`, `salary_detail.source_row_no`, `salary_batch.import_profile_id`, `salary_batch.source_sheet_name`.

- [ ] **Step 1: Write failing snapshot and transaction tests**

Assert that server validation rejects identity labels (`身份证号`, `手机号`, `银行卡号`), formulas, invalid categories, negative income/deduction amounts, duplicate `sortOrder`, more than 80 items, and serialized snapshots over 64 KB. Assert that preview returns sanitized `itemSnapshot`, and create inserts `JSON.stringify(snapshot)` with the source row number.

- [ ] **Step 2: Run persistence tests**

Run: `node test/payroll-dynamic-persistence.test.js`

Expected: FAIL because snapshot validation and insert columns are missing.

- [ ] **Step 3: Implement server-side validation and transaction writes**

Do not trust browser-calculated gross/net values. Recalculate/validate totals from mapped summary fields and standard amounts. Upsert the profile inside the existing batch transaction, then insert:

```sql
INSERT INTO salary_detail (..., item_snapshot, source_row_no, receipt_status)
VALUES (..., :itemSnapshot, :sourceRowNo, 0)
```

The operation log records `batchNo`, `salaryMonth`, `projectId`, `employeeCount`, `profileId`, and `headerSignature`; it must not record item values or identity data.

- [ ] **Step 4: Run preview, persistence, and security tests**

Run: `node test/payroll-dynamic-persistence.test.js && node test/payroll-import-preview.test.js && node test/high-risk-security.test.js`

Expected: all pass.

- [ ] **Step 5: Commit checkpoint after authorization**

```bash
git add src/services/operations.service.js src/services/payroll-item-snapshot.service.js test/payroll-dynamic-persistence.test.js test/payroll-import-preview.test.js
git commit -m "feat: persist dynamic payslip items"
```

---

### Task 5: Add Web Mapping and XLSX Example Workflow

**Files:**
- Create: `public/js/core/payroll-column-mapping.js`
- Modify: `public/index.html:821-853,1095-1110`
- Modify: `public/app.js:2082-2260,2696-2701`
- Modify: `public/styles.css`
- Create: `test/web-payroll-column-mapping.test.js`
- Modify: `test/web-payroll-flexible-import.test.js`

**Interfaces:**
- Consumes: Task 2 `PayrollImport.buildSuggestedMapping` and `parseMappedPayrollRows`.
- Consumes: Task 3 `GET /api/payroll/import-profiles`.
- Produces UI state: `{ headers, headerSignature, mapping, mappingRequired, parsedRows, preview, fileName, sheetName }`.

- [ ] **Step 1: Write failing Web workflow tests**

Assert that the page has `payrollMappingPanel`, one selector per source column, options for all approved targets/categories, separate `payrollCsvExampleButton` and `payrollXlsxExampleButton`, and no copy saying extra columns are ignored. Test the pure mapping helper so a saved profile is used only when its header signature and column count match.

- [ ] **Step 2: Run Web tests**

Run: `node test/web-payroll-column-mapping.test.js && node test/web-payroll-flexible-import.test.js`

Expected: FAIL because the mapping panel and XLSX example button do not exist.

- [ ] **Step 3: Implement mapping UI and profile reuse**

On file load:

1. Detect the header and compute SHA-256 with `crypto.subtle.digest('SHA-256', ...)` over normalized ordered headers.
2. Fetch the project profile.
3. Use the exact profile or suggested mapping.
4. Show the mapping panel only when required fields are unresolved/ambiguous.
5. Reparse the source rows after mapping changes.
6. Keep `确认创建工资批次` disabled until API preview has zero errors.

Use existing `downloadXlsxTemplate` for the XLSX example and retain CSV as an optional example. Change guidance to “未识别列将原名保留，可在预览中调整用途”.

- [ ] **Step 4: Run Web and local ExcelJS tests**

Run: `node test/web-payroll-column-mapping.test.js && node test/web-payroll-flexible-import.test.js && node test/browser-exceljs-local.test.js`

Expected: all pass.

- [ ] **Step 5: Commit checkpoint after authorization**

```bash
git add public/js/core/payroll-column-mapping.js public/index.html public/app.js public/styles.css test/web-payroll-column-mapping.test.js test/web-payroll-flexible-import.test.js
git commit -m "feat: add payroll column mapping UI"
```

---

### Task 6: Return Dynamic Items Only to the Payslip Owner

**Files:**
- Modify: `src/services/payslip.service.js:33-96`
- Create: `test/payslip-dynamic-items-security.test.js`
- Modify: `test/employee-payslip-query.test.js`

**Interfaces:**
- Produces API property: `items: Array<{ label: string, value: number|string, category: 'income'|'deduction'|'summary'|'display', sortOrder: number }>`.
- Consumes: `salary_detail.item_snapshot`; preserves `assertActiveEmployee` and `d.employee_id=:employeeId` query ownership checks.

- [ ] **Step 1: Write failing ownership and fallback tests**

Test valid JSON, MySQL-returned JSON objects, malformed JSON fallback, `NULL` fallback, and filtering of any identity-like item that bypassed old validation. Assert that list/detail SQL still includes company ID, employee ID, published batch status, and receipt status restrictions.

- [ ] **Step 2: Run employee payslip tests**

Run: `node test/payslip-dynamic-items-security.test.js && node test/employee-payslip-query.test.js`

Expected: FAIL because `DETAIL_SELECT` and `formatPayslip` do not expose `items`.

- [ ] **Step 3: Implement safe item parsing**

Select `d.item_snapshot itemSnapshot`. Return a sanitized sorted `items` array when non-empty; return `items: []` for historical rows. Do not remove existing fixed fields because the mini-program needs them for fallback and existing clients depend on them.

- [ ] **Step 4: Run payslip and access-isolation tests**

Run: `node test/payslip-dynamic-items-security.test.js && node test/employee-payslip-query.test.js && node test/employee-account-isolation.test.js`

Expected: all pass.

- [ ] **Step 5: Commit checkpoint after authorization**

```bash
git add src/services/payslip.service.js test/payslip-dynamic-items-security.test.js test/employee-payslip-query.test.js
git commit -m "feat: expose owner-scoped dynamic payslip items"
```

---

### Task 7: Render Exact Dynamic Items in the Employee Mini Program

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxss`
- Create: `test/miniprogram-dynamic-payslip.test.js`
- Modify: `test/miniprogram-employee-payslips.test.js`

**Interfaces:**
- Consumes: Task 6 `payslip.items`.
- Produces page groups: `incomeItems`, `deductionItems`, `summaryItems`, `displayItems`, and `usesDynamicItems`.
- Fallback: existing fixed 8 income and 4 deduction entries when `items.length === 0`.

- [ ] **Step 1: Write failing mini-program rendering tests**

Assert that dynamic items keep API order, `0` remains visible when present in the snapshot, deduction values use a minus display prefix without changing the stored value, text display items do not get currency formatting, and historical rows still build fixed fields.

- [ ] **Step 2: Run mini-program tests**

Run: `node test/miniprogram-dynamic-payslip.test.js && node test/miniprogram-employee-payslips.test.js`

Expected: FAIL because the detail page ignores `item.items`.

- [ ] **Step 3: Implement dynamic groups and vertical layout**

Map item values with:

```js
function displayItem(item) {
  const monetary = ['income', 'deduction', 'summary'].includes(item.category);
  return {
    ...item,
    valueText: monetary ? moneyText(item.value) : String(item.value ?? '-')
  };
}
```

Render only non-empty groups, preserve current amount hero and action dock, and keep all lists vertical with no horizontal scrolling.

- [ ] **Step 4: Run mini-program contract and layout tests**

Run: `node test/miniprogram-dynamic-payslip.test.js && node test/miniprogram-employee-payslips.test.js && node scripts/check-miniprogram-contracts.js`

Expected: all pass.

- [ ] **Step 5: Commit checkpoint after authorization**

```bash
git add wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.js wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxml wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxss test/miniprogram-dynamic-payslip.test.js test/miniprogram-employee-payslips.test.js
git commit -m "feat: render dynamic employee payslips"
```

---

### Task 8: Cross-Client Regression and Final Verification

**Files:**
- Modify: `test/cross-client-data-alignment.test.js`
- Modify: `package.json`
- Review: all files changed in Tasks 1-7 plus the employee batch/recruitment channel changes already in the worktree.

**Interfaces:**
- Consumes: Web preview payload, persisted snapshot, employee API `items`, mini-program rendered groups.
- Produces: a single regression contract proving header label/order/value consistency across clients.

- [ ] **Step 1: Write the failing cross-client contract**

Assert the chain `PayrollImport itemSnapshot -> operations.service item_snapshot -> payslip.service items -> mini detail item.items` and add all new tests to `npm run check` or its automatically invoked `precheck`.

- [ ] **Step 2: Run the cross-client test**

Run: `node test/cross-client-data-alignment.test.js`

Expected: PASS only when the full dynamic-item chain is present.

- [ ] **Step 3: Run focused verification**

```bash
node test/employee-batch-import.test.js
node test/recruitment-channel-management.test.js
node test/payroll-dynamic-import-parser.test.js
node test/payroll-dynamic-persistence.test.js
node test/web-payroll-column-mapping.test.js
node test/payslip-dynamic-items-security.test.js
node test/miniprogram-dynamic-payslip.test.js
```

Expected: every command exits 0 with its `*-tests-ok` message.

- [ ] **Step 4: Run full project validation**

```bash
npm run lint
npm run check
npm run postcheck
npm audit --audit-level=high
```

Expected: all commands exit 0; audit reports no high or critical vulnerabilities.

- [ ] **Step 5: Inspect the final scoped diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; unrelated pre-existing worktree changes remain untouched and are reported separately.

- [ ] **Step 6: Commit checkpoint after authorization**

```bash
git add package.json test/cross-client-data-alignment.test.js
git commit -m "test: verify flexible payslip import flow"
```

