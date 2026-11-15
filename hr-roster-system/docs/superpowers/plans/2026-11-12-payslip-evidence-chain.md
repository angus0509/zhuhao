# 工资条自有证据链 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 每个任务完成后必须进行规格复核和代码质量复核，复核通过后才能进入下一任务。

**Goal:** 在现有工资条查看、手写签名和签收流程上增加内容快照、一次性签收挑战、链式证据日志和可下载 PDF 回执，形成可验证且保留员工异议权的低成本电子证据链。

**Architecture:** 复核发放事务生成确定性工资条快照及 SHA-256；员工签名前由服务端签发与工资条、员工和登录账号绑定的 5 分钟一次性挑战；签名与签收绑定快照摘要、挑战记录及声明版本 `2.0`；证据事件以独立 HMAC 密钥形成链，签收后生成企业隔离的私有 PDF 回执。历史已完成工资条不回填，已发布待签收工资条只通过独立受控命令处理。

**Tech Stack:** Node.js 18+、Express 4、MySQL 8.4 / mysql2、Node `crypto`、`pdf-lib`、`@pdf-lib/fontkit`、原生微信小程序、Node `assert` 测试。

**Spec:** `docs/superpowers/specs/2026-11-12-payslip-evidence-chain-design.md`

## Global Constraints

- 不接第三方电子签、CA、区块链、人脸识别或 AI 笔迹识别。
- 固定签收声明版本为 `2.0`，签收只证明送达和本人操作，不表示员工放弃工资异议权。
- 新发布工资条必须使用不可变 `evidence_snapshot`；员工查看、签名、签收和回执不得临时从业务表重组内容。
- `PAYSLIP_EVIDENCE_HMAC_SECRET` 与 `JWT_SECRET`、`SMS_CODE_HMAC_SECRET` 分离，生产值至少 32 字节。
- 原始挑战凭证、手机号、身份证号、银行卡号、工资明细、Token 不进入日志；原始挑战凭证不落库或持久化客户端存储。
- 一次性挑战只用于防止请求重放，不宣传为短信实名验证、双因素认证或第三方身份认证。
- 所有 SQL 使用命名参数；迁移禁止 `DELETE`、`DROP`、`TRUNCATE`，`ALTER` 前查询 `information_schema`。
- 私有签名和回执目录权限为 `0700`，文件权限为 `0600`，下载必须经过员工本人或 `payroll:view` 加数据范围校验。
- 历史已签收、拒签或撤回工资条不回填；待签收历史数据的处理命令默认只读预演，`--apply` 和生产执行需单独确认。
- 当前工作区已有未提交工资条改动；修改 `src/services/operations.service.js` 前先运行 `git diff -- src/services/operations.service.js`，只追加本计划所需最小补丁，不还原或格式化无关内容。
- 本计划中的提交步骤是实施边界说明，不代表当前已获得提交、推送、生产迁移、部署或小程序上传授权。

---

### Task 1: 证据快照工具与数据库迁移

**Files:**
- Create: `src/services/payslip-evidence-snapshot.service.js`
- Create: `sql/migrate-payslip-evidence-chain-20261112.mysql.sql`
- Create: `test/payslip-evidence-snapshot.test.js`
- Create: `test/payslip-evidence-schema.test.js`
- Modify: `sql/schema.mysql.sql`

**Interfaces:**
- Produces: `canonicalStringify(value: unknown): string`
- Produces: `buildPayslipEvidenceSnapshot(row: object): object`
- Produces: `hashPayslipEvidenceSnapshot(snapshot: object): string`
- Snapshot shape: `{ schemaVersion, companyId, salaryDetailId, salaryMonth, employeeId, employeeName, customerName, projectName, items }`

- [x] **Step 1: Write failing snapshot tests**

```js
const assert = require('node:assert/strict');
const {
  canonicalStringify,
  buildPayslipEvidenceSnapshot,
  hashPayslipEvidenceSnapshot
} = require('../src/services/payslip-evidence-snapshot.service');

const row = {
  companyId: 1, salaryDetailId: 901, salaryMonth: '2026-10', employeeId: 88,
  employeeName: '张三', customerName: '某制造公司', projectName: '装配项目',
  itemSnapshot: [
    { label: '基本工资', value: 5000, category: 'income', sortOrder: 1 },
    { label: '备注', value: '夜班', category: 'display', sortOrder: 2 }
  ]
};
const snapshot = buildPayslipEvidenceSnapshot(row);
assert.deepEqual(snapshot.items, [
  { name: '基本工资', value: '5000.00' },
  { name: '备注', value: '夜班' }
]);
assert.equal(canonicalStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
assert.match(hashPayslipEvidenceSnapshot(snapshot), /^[a-f0-9]{64}$/);
assert.equal(hashPayslipEvidenceSnapshot(snapshot), hashPayslipEvidenceSnapshot(JSON.parse(JSON.stringify(snapshot))));
assert.doesNotMatch(canonicalStringify(snapshot), /身份证|银行卡|手机号|token/i);
```

- [x] **Step 2: Write failing schema tests**

```js
for (const source of [migration, schema]) {
  assert.match(source, /evidence_snapshot JSON/);
  assert.match(source, /evidence_content_sha256 CHAR\(64\)/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?salary_sign_challenge/);
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?salary_evidence_receipt/);
  assert.match(source, /previous_evidence_hash CHAR\(64\)/);
  assert.match(source, /challenge_id BIGINT/);
  assert.match(source, /UNIQUE KEY uk_salary_evidence_receipt_detail \(company_id,salary_detail_id\)/);
}
assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/i);
assert.match(migration, /information_schema\.COLUMNS/);
```

- [x] **Step 3: Run tests and verify RED**

Run: `node test/payslip-evidence-snapshot.test.js && node test/payslip-evidence-schema.test.js`

Expected: FAIL because the snapshot module and evidence migration do not exist.

- [x] **Step 4: Implement canonical snapshot functions**

```js
const crypto = require('crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function normalizeItemValue(item) {
  return ['income', 'deduction', 'summary'].includes(String(item.category))
    ? Number(item.value || 0).toFixed(2)
    : String(item.value ?? '');
}

function hashPayslipEvidenceSnapshot(snapshot) {
  return crypto.createHash('sha256').update(canonicalStringify(snapshot), 'utf8').digest('hex');
}
```

`buildPayslipEvidenceSnapshot` 必须按 `sortOrder` 排序、最多保留 80 项、把金额格式化为两位小数字符串，并只复制白名单字段。

- [x] **Step 5: Add idempotent migration and schema definitions**

迁移必须用 `information_schema.COLUMNS` + 动态 `ALTER TABLE ... ADD COLUMN` 增加 `salary_detail`、`salary_receipt_log` 字段及 `salary_signature.challenge_id BIGINT NULL`；使用 `CREATE TABLE IF NOT EXISTS` 创建 `salary_sign_challenge`、`salary_evidence_receipt`，字段、主键和索引与设计文档第 5—8 节完全一致。`salary_signature.challenge_id` 用于证明签名与一次性挑战记录的绑定，并增加普通索引；不得写业务数据回填语句。当前本地未提交的 `salary_sign_verification`、`verification_id` 必须在 Task 3 中替换，不产生第二份迁移。

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `node test/payslip-evidence-snapshot.test.js && node test/payslip-evidence-schema.test.js`

Expected: both print their `*-tests-ok` marker and exit 0.

- [ ] **Step 7: Commit this task only after explicit commit authorization**

```bash
git add src/services/payslip-evidence-snapshot.service.js sql/migrate-payslip-evidence-chain-20261112.mysql.sql sql/schema.mysql.sql test/payslip-evidence-snapshot.test.js test/payslip-evidence-schema.test.js
git commit -m "feat: add payslip evidence schema and snapshot"
```

---

### Task 2: 发布事务生成工资条快照

**Files:**
- Modify: `src/services/operations.service.js`
- Create: `test/payroll-evidence-publication.test.js`
- Create: `scripts/backfill-payslip-evidence-snapshots.js`
- Create: `test/payslip-evidence-backfill.test.js`
- Modify: `test/payroll-publish-sms-isolation.test.js`

**Interfaces:**
- Consumes: `buildPayslipEvidenceSnapshot(row)` and `hashPayslipEvidenceSnapshot(snapshot)` from Task 1.
- Produces: `createEvidenceSnapshotsForBatch(connection, { companyId, batchId }): Promise<{ count: number }>`
- Produces CLI: `node scripts/backfill-payslip-evidence-snapshots.js [--apply] [--company-id N]`

- [x] **Step 1: Inspect and preserve existing local modifications**

Run: `git diff -- src/services/operations.service.js`

Expected: review and record the existing diff; no file is reset, checked out, reformatted or replaced.

- [x] **Step 2: Write failing publication tests**

```js
const result = await createEvidenceSnapshotsForBatch(connection, { companyId: 1, batchId: 44 });
assert.equal(result.count, 2);
assert.equal(state.updates.length, 2);
assert.match(state.updates[0].params.evidenceContentSha256, /^[a-f0-9]{64}$/);
assert.equal(JSON.parse(state.updates[0].params.evidenceSnapshot).salaryDetailId, 901);
assert.ok(state.events.indexOf('snapshot-update') < state.events.indexOf('publish-status-update'));
```

The harness must also assert that a row with a non-null snapshot is not overwritten and a missing employee-visible item causes publication to fail before status `5` is written.

- [x] **Step 3: Write failing backfill command tests**

Spawn the command with a fake dependency adapter and assert:

```js
assert.match(dryRun.stdout, /mode=dry-run/);
assert.equal(state.updates, 0);
assert.match(apply.stdout, /eligible=3 applied=2 skipped=1/);
assert.equal(state.completedPayslipsChanged, 0);
```

- [x] **Step 4: Run tests and verify RED**

Run: `node test/payroll-evidence-publication.test.js && node test/payslip-evidence-backfill.test.js`

Expected: FAIL because publication snapshot integration and the controlled command do not exist.

- [x] **Step 5: Implement publication snapshot integration**

Inside `finalizePayrollPublication(...)`, before updating the batch to status `5`, query the batch detail rows with employee, customer, project and `item_snapshot`, lock them with `FOR UPDATE`, then call:

```js
const snapshot = buildPayslipEvidenceSnapshot(row);
await connection.execute(
  `UPDATE salary_detail
   SET evidence_schema_version='1.0',evidence_snapshot=:evidenceSnapshot,
       evidence_content_sha256=:evidenceContentSha256,evidence_created_at=NOW(),updated_at=NOW()
   WHERE company_id=:companyId AND id=:salaryDetailId AND evidence_snapshot IS NULL`,
  {
    companyId,
    salaryDetailId: Number(row.salaryDetailId),
    evidenceSnapshot: JSON.stringify(snapshot),
    evidenceContentSha256: hashPayslipEvidenceSnapshot(snapshot)
  }
);
```

If any detail cannot produce a complete snapshot, throw before changing publication status. Existing non-null snapshots must be treated as immutable.

- [x] **Step 6: Implement the controlled pending-payslip command**

The command selects only `batch_status=5 AND receipt_status=1 AND evidence_snapshot IS NULL`; default mode prints company-level counts only, never employee names or amounts. `--apply` processes each company in transactions, skips completed/rejected/withdrawn records, and prints `eligible/applied/skipped/failed` counts. It must not be called by the migration or deployment script.

- [x] **Step 7: Run focused tests and verify GREEN**

Run: `node test/payroll-evidence-publication.test.js && node test/payslip-evidence-backfill.test.js && node test/payroll-overview-consistency.test.js && node test/payroll-publish-sms-isolation.test.js`

Expected: all exit 0; publication behavior outside evidence snapshot creation remains unchanged.

- [ ] **Step 8: Commit this task only after explicit commit authorization**

```bash
git add src/services/operations.service.js scripts/backfill-payslip-evidence-snapshots.js test/payroll-evidence-publication.test.js test/payslip-evidence-backfill.test.js
git commit -m "feat: snapshot payslips during publication"
```

---

### Task 3: 一次性签收挑战与未部署结构修订

**Files:**
- Create: `src/services/payslip-sign-challenge.service.js`
- Create: `test/payslip-sign-challenge.test.js`
- Create: `test/payslip-evidence-config.test.js`
- Modify: `src/config/env.js`
- Modify: `src/controllers/payslip.controller.js`
- Modify: `src/routes/payslip.routes.js`
- Modify: `sql/migrate-payslip-evidence-chain-20261112.mysql.sql`
- Modify: `sql/schema.mysql.sql`
- Modify: `test/payslip-evidence-schema.test.js`

**Interfaces:**
- Produces: `createPayslipSignChallengeService(dependencies)`
- Produces: `issueChallenge(companyId, payslipId, user): Promise<{ challengeId, challengeToken, expiresIn }>`
- Produces: `consumeChallenge(connection, { companyId, payslipId, employeeId, userId, challengeId, challengeToken }): Promise<{ consumed: true, id, consumedAt } | { consumed: false, reason: 'INVALID_CHALLENGE' }>`
- Produces API: `POST /api/me/payslips/:id/sign-challenge` with `{}` request body.
- Replaces all unshipped `salary_sign_verification` and `verification_id` definitions with `salary_sign_challenge` and `challenge_id` in the existing migration; no second migration is created.

- [x] **Step 1: Write failing schema and configuration tests**

```js
for (const source of [migration, schema]) {
  assert.match(source, /CREATE TABLE (?:IF NOT EXISTS )?salary_sign_challenge/);
  assert.match(source, /challenge_hash CHAR\(64\) NOT NULL/);
  assert.match(source, /challenge_id BIGINT DEFAULT NULL/);
  assert.doesNotMatch(source, /salary_sign_verification|verification_id|phone_hash|code_hash/);
}
assert.equal(env.payslipEvidence.challengeTtlSeconds, 300);
assert.equal(env.payslipEvidence.keyVersion, 'v1');
```

Production configuration tests must reject `PAYSLIP_EVIDENCE_HMAC_SECRET` values shorter than 32 bytes and must not require any new Tencent SMS template.

- [x] **Step 2: Write failing challenge service and route tests**

```js
const result = await service.issueChallenge(1, 901, employeeUser);
assert.equal(result.challengeId, 1201);
assert.match(result.challengeToken, /^[A-Za-z0-9_-]{43}$/);
assert.equal(result.expiresIn, 300);
assert.doesNotMatch(JSON.stringify(state.queries), new RegExp(result.challengeToken));
assert.match(state.insert.challengeHash, /^[a-f0-9]{64}$/);
```

Add explicit cases for foreign payslip, absent snapshot, completed receipt, open dispute, account mismatch, expired challenge, wrong token invalidation, cross-payslip reuse, duplicate consumption and successful one-time consumption. Assert the route uses `sensitiveLimiter` and the response never includes `challenge_hash`.

- [x] **Step 3: Run tests and verify RED**

Run: `node test/payslip-evidence-schema.test.js && node test/payslip-evidence-config.test.js && node test/payslip-sign-challenge.test.js`

Expected: FAIL because the current local schema still contains verification fields and the challenge service/route do not exist.

- [x] **Step 4: Replace the unshipped verification schema**

In both schema files, create `salary_sign_challenge` with the exact fields from the design and change `salary_signature`, `salary_receipt_log`, and `salary_evidence_receipt` to `challenge_id`. Remove every unshipped phone/code/verification field. Keep the migration idempotent, additive relative to production, and free of data backfill or destructive SQL.

- [x] **Step 5: Implement challenge issuance**

```js
const challengeToken = crypto.randomBytes(32).toString('base64url');
const challengeHash = crypto.createHmac('sha256', evidenceSecret)
  .update(['payslip-sign-challenge', companyId, payslipId, employeeId, userId, challengeToken].join('|'))
  .digest('hex');
```

Within a transaction, lock the employee/payslip row, require published status, `receipt_status=1`, no open dispute and a valid evidence snapshot/hash, deactivate any previous unconsumed challenge for the same company/payslip/employee/user, insert only the HMAC, and return the raw token once. The raw token must not enter logs or persistent client storage.

- [x] **Step 6: Implement atomic challenge consumption and route**

`consumeChallenge` selects by company, payslip, employee, user and challenge ID with `FOR UPDATE`; rejects inactive, expired or consumed records; compares fixed-length hashes with `crypto.timingSafeEqual`; and sets `status=0,consumed_at=:consumedAt` for a correct token in the caller's signature transaction. A wrong token is set to `status=0` and returned as `{ consumed: false, reason: 'INVALID_CHALLENGE' }` rather than thrown, so Task 4 can commit the invalidation without inserting a signature. A successful consumption returns `{ consumed: true, id, consumedAt }`.

Add `env.payslipEvidence`, production validation, `controller.issueSignChallengeMine`, and:

```js
router.post('/me/payslips/:id/sign-challenge', sensitiveLimiter, controller.issueSignChallengeMine);
```

The controller must whitelist only `challengeId`, `challengeToken`, and `expiresIn` in the response, even if the service object later gains internal hash fields.

- [x] **Step 7: Run focused tests and verify GREEN**

Run: `node test/payslip-evidence-schema.test.js && node test/payslip-evidence-config.test.js && node test/payslip-sign-challenge.test.js && node test/employee-account-isolation.test.js`

Expected: all exit 0; no source or captured query contains an original challenge token, SMS template requirement or verification column.

- [ ] **Step 8: Commit this task only after explicit commit authorization**

```bash
git add src/services/payslip-sign-challenge.service.js src/config/env.js src/controllers/payslip.controller.js src/routes/payslip.routes.js sql/migrate-payslip-evidence-chain-20261112.mysql.sql sql/schema.mysql.sql test/payslip-sign-challenge.test.js test/payslip-evidence-config.test.js test/payslip-evidence-schema.test.js
git commit -m "feat: add one-time payslip signing challenge"
```

---

### Task 4: 签名上传绑定一次性挑战与声明 2.0

**Files:**
- Modify: `src/services/payslip-signature.service.js`
- Modify: `test/payslip-signature-upload.test.js`
- Modify: `test/payslip-signature-security.test.js`

**Interfaces:**
- Consumes: `consumeChallenge(connection, context)` from Task 3.
- Changes `uploadMySignature(...)` body contract to require `statementVersion: '2.0'`, positive integer `challengeId`, and the Base64URL `challengeToken`.
- Returns: `{ signatureId, signedName, signedAt, statementVersion: '2.0' }` without hashes, paths or challenge tokens.

- [x] **Step 1: Extend tests to require statement 2.0 and challenge binding**

```js
await assert.rejects(
  () => service.uploadMySignature(1, 901, file, {
    signedName: '张三', statementVersion: '1.0', challengeId: 1201, challengeToken: 'a'.repeat(43)
  }, user, {}),
  /声明版本/
);
const result = await service.uploadMySignature(1, 901, file, {
  signedName: '张三', statementVersion: '2.0', challengeId: 1201, challengeToken: 'a'.repeat(43)
}, user, {});
assert.equal(result.statementVersion, '2.0');
assert.equal(state.challengeConsumed, 1);
assert.equal(state.signatureInsert.challengeId, 1201);
```

Add assertions that an invalid or expired challenge does not write a signature, a database failure removes the PNG and rolls back challenge consumption, and response/error text never contains the raw challenge token.

Also assert that an old client request without `challengeId` and `challengeToken` receives `请更新小程序后签收`, while a malformed or expired challenge receives the generic challenge error.

- [x] **Step 2: Run tests and verify RED**

Run: `node test/payslip-signature-upload.test.js && node test/payslip-signature-security.test.js`

Expected: FAIL because the current service accepts `1.0` and does not bind a challenge.

- [x] **Step 3: Implement minimal transactional binding**

Validate request shape before writing the file. In the existing transaction, select both `evidence_snapshot` and `evidence_content_sha256`, recompute `hashPayslipEvidenceSnapshot(evidence_snapshot)` using Task 1 and reject a mismatch without overwriting either value. Then invoke `consumeChallenge(...)`. For `{ consumed: true, ... }`, insert the signature with `statement_version='2.0'` and `challenge_id`; for `{ consumed: false, reason: 'INVALID_CHALLENGE' }`, do not insert a signature, allow the transaction to commit the challenge invalidation, delete the uploaded PNG outside the transaction, and only then throw the generic challenge error. Keep existing PNG validation, employee-name equality, open-dispute check, file cleanup and `0600` permissions unchanged. If PNG cleanup fails, emit a security warning containing only the event, company/payslip IDs, internal relative path and system error code; never include the employee name, pay data, challenge token, image content or raw error message.

```js
const challengeId = Number(body.challengeId || 0);
const challengeToken = String(body.challengeToken || '').trim();
if (statementVersion !== '2.0') throw createError('签收声明版本无效，请刷新后重试');
if (body.challengeId == null && body.challengeToken == null) {
  throw createError('请更新小程序后签收', 409, 'MINIPROGRAM_UPDATE_REQUIRED');
}
if (!Number.isSafeInteger(challengeId) || challengeId <= 0 || !/^[A-Za-z0-9_-]{43}$/.test(challengeToken)) {
  throw createError('签收挑战无效，请刷新后重试');
}
```

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node test/payslip-signature-upload.test.js && node test/payslip-signature-security.test.js && node test/png-signature-validator.test.js`

Expected: all exit 0; previous signature security properties remain intact.

- [ ] **Step 5: Commit this task only after explicit commit authorization**

```bash
git add src/services/payslip-signature.service.js test/payslip-signature-upload.test.js test/payslip-signature-security.test.js
git commit -m "feat: bind payslip signature to one-time challenge"
```

---

### Task 5: 链式证据日志与完整性验证

**Files:**
- Create: `src/services/payslip-evidence-log.service.js`
- Create: `scripts/verify-payslip-evidence-chain.js`
- Create: `test/payslip-evidence-log.test.js`
- Modify: `src/services/payslip.service.js`
- Modify: `test/payslip-signed-receipt.test.js`
- Modify: `test/employee-payslip-query.test.js`
- Modify: `test/employee-payslip-dispute.test.js`

**Interfaces:**
- Produces: `appendEvidenceLog(connection, context): Promise<{ id, evidenceHash, previousEvidenceHash }>`
- Produces: `verifyEvidenceRows(rows, secretResolver): { valid, checked, errors, chainHead }`
- Context fields: `companyId, payslipId, employeeId, userId, actionType, resultStatus, eventAt, contentSha256, signatureSha256, challengeId, statementVersion, keyVersion, ipAddress, userAgent`.
- CLI: `node scripts/verify-payslip-evidence-chain.js --company-id N --payslip-id N` returns exit 0 only for a valid chain.

- [x] **Step 1: Write failing chain tests**

```js
const first = await appendEvidenceLog(connection, viewContext);
const second = await appendEvidenceLog(connection, acceptContext);
assert.equal(second.previousEvidenceHash, first.evidenceHash);
assert.equal(verifyEvidenceRows(state.rows, () => secret).valid, true);
const tampered = structuredClone(state.rows);
tampered[0].resultStatus = 9;
assert.equal(verifyEvidenceRows(tampered, () => secret).valid, false);
```

Assert the append query locks the previous row using `ORDER BY id DESC LIMIT 1 FOR UPDATE`, ACCEPT requires content/signature/challenge/statement fields, and VIEW never exposes snapshot contents in logs.

- [x] **Step 2: Run tests and verify RED**

Run: `node test/payslip-evidence-log.test.js && node test/payslip-signed-receipt.test.js`

Expected: FAIL because current HMAC reuses `JWT_SECRET` and has no chain fields.

- [x] **Step 3: Implement versioned chain hashing**

```js
const payload = [
  companyId, payslipId, employeeId, userId, actionType, resultStatus,
  eventAt.toISOString(), contentSha256 || '', signatureSha256 || '',
  challengeId || '', statementVersion || '', previousEvidenceHash || '', keyVersion
].join('|');
const evidenceHash = crypto.createHmac('sha256', evidenceSecret).update(payload).digest('hex');
```

Use `PAYSLIP_EVIDENCE_HMAC_SECRET` and key version `v1`. Preserve verification of legacy rows that have null `evidence_key_version` by using the old JWT-based formula only in the read-only verifier; never rewrite legacy hashes. Because the old formula hashed JavaScript milliseconds while MySQL `DATETIME` retained only seconds, try milliseconds `000` through `999` only for legacy verification. Treat an empty row set as missing evidence, not as a valid chain.

- [x] **Step 4: Replace receipt log writes**

Update VIEW, ACCEPT, REJECT and DISPUTE paths to call `appendEvidenceLog`. The SELECT used by signature/receipt must include the immutable snapshot and content hash; recompute the snapshot hash before ACCEPT and reject any mismatch. ACCEPT must bind active signature SHA-256, its `challenge_id`, and statement `2.0`. Do not include raw snapshot JSON in log rows.

Change `disputeMyPayslip` so an employee may submit an evidence-preserving dispute after `receipt_status=2`; do not deactivate the signature, alter the receipt, change the ACCEPT log or rewrite `receipt_status`. For a signed payslip, insert the dispute and append a DISPUTE event whose `result_status` remains `2`. Preserve the existing behavior for an unsigned pending payslip. Add tests proving signed evidence remains unchanged and the duplicate-open-dispute rule still applies.

- [x] **Step 5: Implement read-only verifier CLI**

The CLI requires both numeric IDs, queries one company/payslip in `id ASC` order, prints only IDs, counts, hashes and error positions, and sets `process.exitCode=1` on missing secret, gap, mismatch or tamper. It must contain no update/insert/delete statements.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `node test/payslip-evidence-log.test.js && node test/payslip-signed-receipt.test.js && node test/employee-payslip-query.test.js && node test/employee-payslip-dispute.test.js`

Expected: all exit 0; tamper test reports invalid and the existing receipt idempotency test still passes.

- [ ] **Step 7: Commit this task only after explicit commit authorization**

```bash
git add src/services/payslip-evidence-log.service.js src/services/payslip.service.js scripts/verify-payslip-evidence-chain.js test/payslip-evidence-log.test.js test/payslip-signed-receipt.test.js test/employee-payslip-query.test.js test/employee-payslip-dispute.test.js
git commit -m "feat: chain payslip evidence events"
```

---

### Task 6: PDF 电子回执与双端鉴权下载

**Files:**
- Create: `src/services/payslip-evidence-receipt.service.js`
- Create: `test/payslip-evidence-receipt.test.js`
- Modify: `src/services/payslip.service.js`
- Modify: `src/controllers/payslip.controller.js`
- Modify: `src/routes/payslip.routes.js`
- Modify: `src/services/operations.service.js`
- Modify: `src/controllers/operations.controller.js`
- Modify: `src/routes/operations.routes.js`
- Modify: `test/payslip-signed-receipt.test.js`
- Create: `test/payroll-evidence-receipt-access.test.js`

**Interfaces:**
- Produces: `createPayslipEvidenceReceiptService(dependencies)`
- Produces: `renderReceiptPdf(payload, signatureBuffer): Promise<Buffer>`
- Produces: `createReceipt(connection, context): Promise<{ receiptNo, storagePath, receiptSha256 }>`
- Produces: `resolveEmployeeReceipt(companyId, payslipId, user)` and `resolvePayrollReceipt(companyId, payslipId, user)` returning `{ file, receiptNo, receiptSha256 }`.
- Produces employee API: `GET /api/me/payslips/:id/evidence-receipt`.
- Produces manager API: `GET /api/payroll/payslips/:id/evidence-receipt` guarded by `payroll:view` plus project/customer/employee scope.
- Changes employee payslip detail: signed rows include `evidenceReceipt: { receiptNo, receiptUrl }`; unsigned rows return `evidenceReceipt: null`.

- [x] **Step 1: Write failing PDF and access tests**

```js
const created = await service.createReceipt(connection, context);
assert.match(created.receiptNo, /^PSR-20261112-[A-Z0-9]{12}$/);
assert.match(created.receiptSha256, /^[a-f0-9]{64}$/);
assert.equal(state.writeFile.mode, 0o600);
assert.match(state.writeFile.path, /company-1\/payslip-receipts\//);
assert.doesNotMatch(JSON.stringify(state.insertParams), /challengeToken|一次性Base64URL随机凭证/);
```

Render the buffer and inspect extracted strings or stable PDF metadata for company, month, project, employee, full snapshot items, statement `2.0`, signed account ID, challenge record ID, content/signature/chain hashes and the bank-payment disclaimer. Add access tests for employee ownership, `payroll:view`, project/customer data scope, cross-company denial and `X-Receipt-SHA256`.

- [x] **Step 2: Run tests and verify RED**

Run: `node test/payslip-evidence-receipt.test.js && node test/payroll-evidence-receipt-access.test.js && node test/payslip-signed-receipt.test.js`

Expected: FAIL because the receipt service and routes do not exist.

- [x] **Step 3: Implement deterministic receipt payload and PDF rendering**

Use only the persisted snapshot, signature attachment, consumed challenge record and ACCEPT chain head. Embed `src/assets/fonts/NotoSansSC-Regular.ttf` through `@pdf-lib/fontkit`; do not load network resources. The fixed payload is:

```js
{
  schemaVersion: '1.0', receiptNo, generatedAt, companyName,
  payslip: evidenceSnapshot, signedName, signedAt, signedUserId, challengeId,
  statementVersion: '2.0', statementText: PAYSLIP_RECEIPT_STATEMENT_V2,
  payslipContentSha256, signatureSha256, evidenceChainHead,
  disclaimer: '本回执证明工资条送达和签收，不单独证明银行款项已实际到账。'
}
```

The PDF body must not include `receipt_sha256`; calculate SHA-256 after PDF generation and return it in the download header.

- [x] **Step 4: Generate receipt in the first successful ACCEPT transaction**

After appending ACCEPT and obtaining its chain head, call `createReceipt` before the transaction completes. Make `receiptMyPayslip` return `{ payslipId, receiptStatus, receiptStatusName, receiptNo, receiptUrl }`. For an idempotent repeated ACCEPT, return the existing receipt without writing another log, file or row. If the transaction rejects after a file was written, unlink that newly written file; never delete an existing receipt.

Extend `DETAIL_SELECT` and `formatPayslip` with the active receipt number and expose only the authenticated API URL, never `storage_path`. This allows a later detail reload to recover the same receipt after navigation or network interruption.

- [x] **Step 5: Add authenticated download controllers**

Both controllers set:

```js
res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `attachment; filename="${receipt.receiptNo}.pdf"`);
res.setHeader('Cache-Control', 'private, no-store');
res.setHeader('X-Receipt-SHA256', receipt.receiptSha256);
return res.sendFile(receipt.file);
```

Before either resolver returns a file, read it and recompute SHA-256; reject with an integrity error if it differs from `salary_evidence_receipt.receipt_sha256`. The manager resolver must reuse existing payroll scope predicates and must not authorize access based on `payroll:view` alone.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `node test/payslip-evidence-receipt.test.js && node test/payroll-evidence-receipt-access.test.js && node test/payslip-signed-receipt.test.js && node test/data-isolation-regression.test.js && node test/payroll-signature-preview.test.js`

Expected: all exit 0; cross-company and out-of-scope downloads remain denied.

- [ ] **Step 7: Commit this task only after explicit commit authorization**

```bash
git add src/services/payslip-evidence-receipt.service.js src/services/payslip.service.js src/controllers/payslip.controller.js src/routes/payslip.routes.js src/services/operations.service.js src/controllers/operations.controller.js src/routes/operations.routes.js test/payslip-evidence-receipt.test.js test/payroll-evidence-receipt-access.test.js test/payslip-signed-receipt.test.js
git commit -m "feat: generate authenticated payslip receipts"
```

---

### Task 7: 微信小程序一次性挑战、声明和回执入口

**Files:**
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.wxss`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.js`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxml`
- Modify: `wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxss`
- Modify: `test/miniprogram-payslip-signature.test.js`
- Create: `test/miniprogram-payslip-evidence-receipt.test.js`

**Interfaces:**
- Consumes API `POST /me/payslips/:id/sign-challenge`.
- Signature upload form includes `statementVersion=2.0`, `challengeId`, `challengeToken`.
- Receipt confirmation consumes `receiptUrl`; signed detail exposes an authenticated “下载电子签收回执” action.

- [x] **Step 1: Extend mini-program tests for the complete interaction**

```js
assert.equal(challengeRequest.url.endsWith('/me/payslips/31/sign-challenge'), true);
assert.equal(upload.formData.statementVersion, '2.0');
assert.equal(upload.formData.challengeId, '1201');
assert.equal(upload.formData.challengeToken, 'a'.repeat(43));
assert.match(signWxml, /不代表本人放弃/);
assert.doesNotMatch(signWxml, /金额无误|全部正确|已核对工资条内容/);
```

Cover automatic challenge request, challenge expiration and one automatic refresh, failed signing without receipt request, successful receipt URL, signed detail download, authentication header, PDF open/share failure, retained “工资有异议” entry after signing, and absence of any challenge token in storage or logs.

- [x] **Step 2: Run tests and verify RED**

Run: `node test/miniprogram-payslip-signature.test.js && node test/miniprogram-payslip-evidence-receipt.test.js`

Expected: FAIL because the page still uses statement `1.0`, does not request a challenge and has no receipt download.

- [x] **Step 3: Implement automatic one-time challenge flow**

Keep `challengeId` and `challengeToken` only in page-memory instance properties, not reactive page data, storage or logs. `requestSignChallenge()` calls the new API immediately before signature upload. If the server reports challenge expiration before any signature is saved, clear the in-memory values, request one fresh challenge and retry once; other failures require an explicit new submit action.

- [x] **Step 4: Replace declaration copy and upload payload**

Show this exact statement with an unchecked box by default:

> 本人确认已查看并收到本期工资条。本次签收仅证明工资条已送达本人，不代表本人放弃对工资计算、考勤、扣款及实际支付情况提出异议的权利。本人同意使用当前登录账号和本次手写签名完成电子签收。

Change the validation toast to “请阅读并同意电子签收声明”. After obtaining a challenge, upload:

```js
formData: {
  signedName,
  statementVersion: '2.0',
  challengeId: String(challengeId),
  challengeToken
}
```

Clear the in-memory challenge immediately after a successful signature upload or any server response that says it is invalid/consumed. Keep the hand-drawn canvas available when challenge acquisition fails so the employee can retry without redrawing.

- [x] **Step 5: Add authenticated receipt download**

Use `wx.downloadFile` with the employee Bearer token, verify HTTP 2xx and `.pdf` temp path, then call `wx.openDocument({ filePath, fileType: 'pdf', showMenu: true })`. The detail page shows this action only when `receiptStatus===2` and a receipt exists. Keep the “工资有异议” entry available after signing; Task 5 provides the matching backend behavior.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `node test/miniprogram-payslip-signature.test.js && node test/miniprogram-payslip-evidence-receipt.test.js && node test/miniprogram-employee-payslips.test.js && node scripts/check-miniprogram-contracts.js`

Expected: all exit 0; tests confirm no authentication or challenge token appears in a URL, page data, storage or logs.

- [ ] **Step 7: Commit this task only after explicit commit authorization**

```bash
git add wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.js wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.wxml wechat-miniprogram/miniprogram/pages/my-payslips/sign/index.wxss wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.js wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxml wechat-miniprogram/miniprogram/pages/my-payslips/detail/index.wxss test/miniprogram-payslip-signature.test.js test/miniprogram-payslip-evidence-receipt.test.js
git commit -m "feat: complete payslip evidence signing flow"
```

---

### Task 8: 发布接入、环境示例和完整回归

**Files:**
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `package.json`
- Modify: `scripts/deploy-production.sh`
- Modify: `scripts/verify-release-package.sh`
- Modify: `test/release-migration-consistency.test.js`
- Modify: `test/post-deploy-verification-contract.test.js`
- Modify: `test/payslip-evidence-schema.test.js`

**Interfaces:**
- Adds environment key `PAYSLIP_EVIDENCE_HMAC_SECRET`; no new SMS template is required.
- Adds migration `sql/migrate-payslip-evidence-chain-20261112.mysql.sql` to package audit and production migration order.
- Adds all new evidence tests to `npm run check`.

- [x] **Step 1: Write failing release-contract assertions**

```js
assert.match(deploy, /run_migration "\$STAGE_DIR\/sql\/migrate-payslip-evidence-chain-20261112\.mysql\.sql"/);
assert.ok(verify.includes('sql/migrate-payslip-evidence-chain-20261112.mysql.sql'));
assert.match(envExample, /PAYSLIP_EVIDENCE_HMAC_SECRET=/);
assert.doesNotMatch(envProductionExample, /TENCENT_SMS_TEMPLATE_PAYSLIP_SIGN_CODE/);
assert.match(packageJson.scripts.check, /payslip-evidence-snapshot\.test\.js/);
assert.match(packageJson.scripts.check, /payslip-evidence-receipt\.test\.js/);
```

- [x] **Step 2: Run release tests and verify RED**

Run: `node test/release-migration-consistency.test.js && node test/post-deploy-verification-contract.test.js && node test/payslip-evidence-schema.test.js`

Expected: FAIL because release scripts and environment examples do not include the new evidence chain.

- [x] **Step 3: Update release and configuration contracts**

Add a blank evidence-secret example only; never write a real secret. Add the migration to `verify-release-package.sh` before extraction and to `deploy-production.sh` after the existing payslip migrations. Keep the migration idempotent and do not invoke the historical snapshot command automatically.

- [x] **Step 4: Add focused tests to `npm run check`**

Insert the following tests after the current payslip signature tests and before unrelated employee tests:

```text
test/payslip-evidence-snapshot.test.js
test/payslip-evidence-schema.test.js
test/payroll-evidence-publication.test.js
test/payslip-evidence-backfill.test.js
test/payslip-evidence-config.test.js
test/payslip-sign-challenge.test.js
test/payslip-evidence-log.test.js
test/payslip-evidence-receipt.test.js
test/payroll-evidence-receipt-access.test.js
test/miniprogram-payslip-evidence-receipt.test.js
```

- [x] **Step 5: Run script and migration safety checks and verify GREEN**

Run: `bash -n scripts/build-release-package.sh scripts/verify-release-package.sh scripts/deploy-production.sh scripts/post-deploy-verify.sh`

Expected: exit 0 with no output.

Run: `node test/release-migration-consistency.test.js && node test/post-deploy-verification-contract.test.js && node test/payslip-evidence-schema.test.js`

Expected: all exit 0.

- [x] **Step 6: Run complete verification**

Run: `npm run check`

Expected: exit 0; every test prints its success marker and route load prints `express-route-load-ok`.

Run: `npm audit --audit-level=high`

Expected: exit 0 with zero high or critical vulnerabilities.

Run: `node scripts/check-miniprogram-contracts.js`

Expected: exit 0.

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

- [x] **Step 7: Perform a final no-secret and scope review**

Run: `git diff -- . ':!.env' ':!.env.production' | grep -E "challengeToken[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9_-]{43}|PAYSLIP_EVIDENCE_HMAC_SECRET=.+"`

Expected: no real challenge token or populated evidence secret. Test fixtures using explicit non-production dummy values must be identifiable as fixtures.

Review routes and queries to confirm employee download uses employee ownership and manager download combines `payroll:view` with project/customer/employee data scope.

- [ ] **Step 8: Commit release integration only after explicit commit authorization**

```bash
git add .env.example .env.production.example package.json scripts/deploy-production.sh scripts/verify-release-package.sh test/release-migration-consistency.test.js test/post-deploy-verification-contract.test.js test/payslip-evidence-schema.test.js
git commit -m "chore: integrate payslip evidence release checks"
```

## Production Readiness Gate

The following remain separate user-confirmed actions after all local tasks and reviews pass:

1. `PAYSLIP_EVIDENCE_HMAC_SECRET` is generated and configured without entering source control.
2. Code and database backups are created and verified.
3. The new migration is applied through the approved deployment workflow.
4. The pending-payslip snapshot command is first run in dry-run mode; its `--apply` production run requires separate confirmation.
5. Web/API deployment, post-deploy verification, mini-program upload, WeChat review and release each require their own authorization.
