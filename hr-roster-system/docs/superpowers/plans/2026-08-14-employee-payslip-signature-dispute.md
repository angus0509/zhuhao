# Employee Payslip Signature and Dispute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and complete each checkbox with TDD. Do not commit, deploy, or upload unless the user separately authorizes it.

**Goal:** Complete the employee mini-program payslip list, detail, handwritten PNG signature, atomic receipt, and salary dispute flow while preserving the existing manager payroll workflow.

**Architecture:** Reuse the existing employee-only `/me/payslips` API and static payroll Tab root. Add durable signature/dispute tables, a strict PNG parser and private file storage, then make receipt acceptance require an active signature owned by the authenticated employee. The mini-program payroll root renders the employee list and opens non-Tab detail/signature pages; manager payroll pages remain unchanged.

**Tech Stack:** Node.js 22, Express 4, MySQL 8, multer memory upload, native WeChat mini-program Canvas, existing JWT/account guards and receipt audit log.

**Spec:** `docs/superpowers/specs/2026-08-14-employee-payslip-portal-design.md`

## Global Constraints

- All employee IDs come from the authenticated `EMPLOYEE` session; never accept an employee ID from request input.
- Only `salary_batch.batch_status=5` and receipt states `1/2/3` are visible to employees.
- Signature files must be real PNG images, at most 1 MB, with bounded dimensions and decompressed size.
- A successful accept operation requires `confirmed=true` and an active signature for the same company, employee, and salary detail.
- Signature row, receipt status, and evidence log must be committed atomically; failed database work deletes the stored file.
- Signed payslips are immutable. Recalculation creates a new salary detail/version outside this plan.
- Dispute reasons are 10-500 Chinese/English characters after trimming and only one open dispute may exist per payslip.
- Existing manager payroll batch creation, review, publication, and mobile pages must not change behavior.
- Follow TDD. Preserve the dirty worktree. Do not reset, overwrite unrelated edits, commit, deploy, or upload.

---

### Task 1: Add Signature and Dispute Schema

**Files:**
- Create: `sql/migrate-payslip-signature-dispute-20260814.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Test: `test/payslip-signature-schema.test.js`

**Interfaces:**
- Produces `salary_signature` and `salary_dispute` with generated-column unique indexes that preserve history.
- Consumes `salary_detail`, `hr_attachment`, and existing release migration conventions.

- [ ] Write a failing schema test that requires both tables, active unique indexes, non-destructive SQL, deploy inclusion, and release-package inclusion.
- [ ] Run `node test/payslip-signature-schema.test.js`; verify failure because the migration is absent.
- [ ] Add the idempotent migration and canonical schema definitions exactly matching the approved design.
- [ ] Add the migration to deployment order and release verification.
- [ ] Run the focused schema and release migration tests until green.

### Task 2: Add Employee Payslip List and Detail State

**Files:**
- Modify: `src/services/payslip.service.js`
- Modify: `src/controllers/payslip.controller.js`
- Test: `test/employee-payslip-query.test.js`

**Interfaces:**
- `listMyPayslips(companyId,user,{year,page,pageSize}) -> {list,total,page,pageSize}`
- `getMyPayslip(companyId,payslipId,user,meta) -> PayslipDetail`
- `PayslipDetail` includes amount breakdown, `displayStatus`, active signature summary, and open dispute summary.

- [ ] Write a failing behavior test with two enterprises and two employees; assert only the token employee's published rows are returned.
- [ ] Assert year filtering and pagination use bounded integer parameters.
- [ ] Assert `待查看` before a VIEW log, `待签字` after VIEW, `已签收` after receipt, and `有异议` when an open dispute exists.
- [ ] Implement the minimal SQL and formatting changes; keep amount fields out of the home API but present in detail.
- [ ] Run the focused test plus existing payslip/security tests.

### Task 3: Validate and Store Handwritten PNG Signatures

**Files:**
- Create: `src/utils/png-validator.js`
- Create: `src/services/payslip-signature.service.js`
- Modify: `src/middlewares/upload.middleware.js`
- Modify: `src/controllers/payslip.controller.js`
- Modify: `src/routes/payslip.routes.js`
- Test: `test/payslip-signature-upload.test.js`

**Interfaces:**
- `validatePng(buffer,{maxBytes,maxWidth,maxHeight,maxPixels}) -> {width,height,sha256}`
- `uploadMySignature(companyId,payslipId,file,body,user,meta) -> {signatureId,signedName,signedAt}`
- `POST /api/me/payslips/:id/signature`, multipart field `signature`.

- [ ] Write failing tests for valid Canvas PNG, wrong extension/MIME, forged magic bytes, truncated chunks, oversized file, oversized dimensions, and cross-employee payslip ID.
- [ ] Add a dedicated 1 MB multer handler accepting only `.png` and `image/png`.
- [ ] Parse PNG signature/IHDR/chunk boundaries, bound decompressed output, and calculate SHA-256 without logging file bytes.
- [ ] Store the file under a company-scoped random path with mode `0600`; create `hr_attachment` and `salary_signature` rows in one transaction; unlink on failure.
- [ ] Reject a second active signature for an already signed or disputed payslip.
- [ ] Run focused upload, attachment security, and high-risk security tests.

### Task 4: Require Signature for Atomic Receipt

**Files:**
- Modify: `src/services/payslip.service.js`
- Modify: `src/controllers/payslip.controller.js`
- Test: `test/payslip-signed-receipt.test.js`

**Interfaces:**
- `receiptMyPayslip(...,{action:'accept',signatureId,confirmed:true},...)`
- Produces one `ACCEPT` receipt log and receipt status `2`.

- [ ] Write a failing test showing acceptance without confirmation or signature is rejected.
- [ ] Write a failing transaction test showing a signature belonging to another employee/payslip/company is rejected.
- [ ] Require an active signature row inside the same `FOR UPDATE` transaction before updating `salary_detail`.
- [ ] Keep duplicate identical acceptance idempotent and never create a second receipt log.
- [ ] Run focused receipt and account-isolation tests.

### Task 5: Add Employee Salary Disputes

**Files:**
- Modify: `src/services/payslip.service.js`
- Modify: `src/controllers/payslip.controller.js`
- Modify: `src/routes/payslip.routes.js`
- Test: `test/employee-payslip-dispute.test.js`

**Interfaces:**
- `POST /api/me/payslips/:id/dispute {reason}`
- Produces `{disputeId,handleStatus:0,handleStatusName:'待处理'}` and receipt status `3`.

- [ ] Write failing tests for reasons shorter than 10 or longer than 500 characters.
- [ ] Write failing tests for unpublished, foreign-employee, already-signed, and duplicate-open-dispute cases.
- [ ] Insert the dispute, update receipt status, and write a `DISPUTE` evidence log in one transaction.
- [ ] Return the existing open dispute on exact duplicate submission without creating a second row.
- [ ] Run focused dispute and security tests.

### Task 6: Build Employee Payslip List and Detail Pages

**Files:**
- Create: `wechat-miniprogram/miniprogram/components/employee-payslip-list/*`
- Create: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/*`
- Modify: `wechat-miniprogram/miniprogram/pages/payroll/*`
- Modify: `wechat-miniprogram/miniprogram/app.json`
- Test: `test/miniprogram-employee-payslips.test.js`

**Interfaces:**
- Payroll Tab employee branch calls `GET /me/payslips` and never calls `/payroll/overview`.
- Detail page calls `GET /me/payslips/:id` and shows all wage additions/deductions vertically without horizontal scrolling.

- [ ] Write a failing component/page behavior test using an employee session and real page/component methods.
- [ ] Implement year filter, status cards, empty/error/retry states, and list-to-detail navigation.
- [ ] Implement detail sections for basic/position/performance/allowance/piece/overtime, deductions, gross, and net.
- [ ] Add `确认并签收` and `工资有异议` actions only when the backend status permits them.
- [ ] Run focused page, large-layout, premium-theme, tab-bar, and interaction-performance tests.

### Task 7: Build Canvas Signature and Dispute Interaction

**Files:**
- Create: `wechat-miniprogram/miniprogram/pages/my-payslips/sign/*`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/*`
- Modify: `wechat-miniprogram/miniprogram/app.json`
- Test: `test/miniprogram-payslip-signature.test.js`

**Interfaces:**
- Canvas exports PNG using `wx.canvasToTempFilePath`.
- Upload uses `wx.uploadFile` with the employee Bearer token, then calls the receipt API with `confirmed=true`.
- Dispute submits 10-500 trimmed characters to `/me/payslips/:id/dispute`.

- [ ] Write failing tests for blank signature, clear/re-sign, duplicate taps, upload failure, receipt failure, and invalid dispute length.
- [ ] Build a portrait signature page with touch start/move/end, clear, confirmation checkbox, signed-name display, upload progress, and retry-safe state.
- [ ] Never put Token, signature bytes, or employee ID in page URL/logs; only the payslip ID is passed.
- [ ] Add the dispute modal/form to detail and refresh list/home dirty state after success.
- [ ] Run focused tests and all mini-program navigation regressions.

### Task 8: Integrate Release and Security Regression

**Files:**
- Modify: `package.json`
- Modify: `test/high-risk-security.test.js`
- Modify: `test/api-smoke.js`
- Test: `test/payslip-signature-security.test.js`

- [ ] Add new tests to `npm run check` before historical suites.
- [ ] Verify manager tokens cannot upload/sign/dispute and employee A cannot act on employee B.
- [ ] Verify logs/responses exclude signature bytes, full identity data, token, and file storage paths.
- [ ] Run `npm run lint`, `npm run check`, `npm run postcheck`, `npm audit --audit-level=high`, and both Git diff checks.
- [ ] Do not run production migration, commit, deploy, or upload in this plan.

## Acceptance

- Employee can filter and open only their own published payslips.
- Each detail view creates a VIEW evidence record.
- A valid handwritten PNG is required before acceptance.
- Signature file hash, attachment row, signature row, receipt update, and ACCEPT evidence are consistent.
- Employee can submit one open dispute with a 10-500 character reason.
- Signed records remain immutable and duplicate requests are idempotent.
- Manager payroll functions and manager TabBar behavior remain unchanged.
- Full local quality gates pass without high/critical dependency vulnerabilities.
