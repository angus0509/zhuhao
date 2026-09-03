# 个人基金与 A 股分析助手实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个本地运行、云端获取公开行情的个人基金与 A 股分析助手，支持持仓导入、截图确认、每日分析和可追溯简报。

**Architecture:** 使用 Node.js 提供本地 API 和定时任务，Vue 3 提供响应式网页，SQLite 保存本地持仓、行情快照和报告。行情适配器只请求公开数据；分析引擎在本地计算指标并输出带依据和数据日期的建议。

**Tech Stack:** Node.js 20+, Express, Vue 3, Vite, better-sqlite3, Vitest, TypeScript。

**Spec:** `docs/superpowers/specs/2026-09-03-personal-fund-analyst-design.md`

## Global Constraints

- 持仓与截图默认只保存在本地，不保存支付宝账号、密码或 Cookie。
- OCR 结果必须人工确认后才写入持仓。
- 数据源失败或覆盖不完整时不得生成伪造结论。
- 不自动交易、不承诺收益；建议必须显示数据日期、来源、依据和不确定性。
- SQL 使用参数化查询；敏感数据不明文回显。
- 第一阶段不实现云端账户体系、自动通知、复杂回测和自动交易。

### Task 1: 创建 Node/Vue/SQLite 基础工程

**Files:**
- Create: `fund-analyst/package.json`
- Create: `fund-analyst/server/index.ts`
- Create: `fund-analyst/server/db.ts`
- Create: `fund-analyst/src/main.ts`
- Create: `fund-analyst/src/App.vue`
- Create: `fund-analyst/vite.config.ts`
- Test: `fund-analyst/test/health.test.ts`

**Interfaces:**
- Produces `GET /api/health -> { ok: boolean, db: string }` and a Vue app shell.

- [ ] **Step 1: Write the failing health test**

```ts
it('reports local service and database health', async () => {
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ ok: true, db: 'sqlite' });
});
```

- [ ] **Step 2: Run `cd fund-analyst && npm test -- health.test.ts` and verify it fails because the app is missing.**
- [ ] **Step 3: Add the Express app, SQLite connection, schema migration runner, Vue shell, and Vite proxy.**
- [ ] **Step 4: Run `npm test -- health.test.ts` and `npm run typecheck`; expect PASS.**
- [ ] **Step 5: Commit with `git add fund-analyst && git commit -m "feat: scaffold fund analyst app"`.**

### Task 2: 持仓数据模型与手动/CSV 导入

**Files:**
- Create: `fund-analyst/server/schema.sql`
- Create: `fund-analyst/server/holdings.ts`
- Create: `fund-analyst/src/views/ImportHoldings.vue`
- Create: `fund-analyst/src/lib/csv.ts`
- Test: `fund-analyst/test/holdings.test.ts`

**Interfaces:**
- `POST /api/holdings` accepts `{ fundCode, fundName, shares, costAmount, purchasedAt }`.
- `POST /api/holdings/import` accepts CSV text with columns `基金代码,基金名称,持有份额,持有成本,买入日期` and returns `{ imported, errors[] }`.

- [ ] **Step 1: Test valid insertion, numeric validation, and duplicate fund/date rejection.**
- [ ] **Step 2: Run the focused Vitest test and verify failure.**
- [ ] **Step 3: Implement parameterized SQLite table and import parser with field-level errors.**
- [ ] **Step 4: Add form/upload UI with preview before confirmation; run tests and typecheck.**
- [ ] **Step 5: Commit `feat: add holdings entry and csv import`.**

### Task 3: 截图 OCR 草稿与人工确认

**Files:**
- Create: `fund-analyst/server/ocr.ts`
- Create: `fund-analyst/server/ocr-routes.ts`
- Create: `fund-analyst/src/components/OcrReview.vue`
- Modify: `fund-analyst/src/views/ImportHoldings.vue`
- Test: `fund-analyst/test/ocr-review.test.ts`

**Interfaces:**
- `POST /api/holdings/ocr-draft` accepts a local image multipart upload and returns `{ draftId, fields, confidence }` without writing holdings.
- `POST /api/holdings/ocr-confirm` accepts corrected fields and writes only confirmed values.

- [ ] **Step 1: Test that OCR draft never creates a holding and confirmation does.**
- [ ] **Step 2: Run test to verify failure.**
- [ ] **Step 3: Implement an OCR adapter boundary with a deterministic development adapter; reject unsupported files and discard temporary files after processing.**
- [ ] **Step 4: Build field-by-field review UI requiring explicit confirmation; run focused tests.**
- [ ] **Step 5: Commit `feat: add reviewed ocr holding import`.**

### Task 4: 公开行情适配器与每日快照

**Files:**
- Create: `fund-analyst/server/market-data.ts`
- Create: `fund-analyst/server/market-routes.ts`
- Create: `fund-analyst/server/scheduler.ts`
- Test: `fund-analyst/test/market-data.test.ts`

**Interfaces:**
- `MarketDataProvider.fetchIndices(date) -> Promise<IndexQuote[]>`.
- `MarketDataProvider.fetchFundNav(codes, date) -> Promise<FundNav[]>`.
- `POST /api/market/sync` returns `{ status: 'complete'|'partial'|'failed', asOf, sources, errors[] }`.

- [ ] **Step 1: Test successful, partial, and failed provider responses using a mocked provider.**
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement provider interface, timeout, cache tables, source timestamps, and no-data status handling.**
- [ ] **Step 4: Add a post-close scheduler entry point and manual sync endpoint; run tests/typecheck.**
- [ ] **Step 5: Commit `feat: add market data snapshots`.**

### Task 5: 指标计算与建议引擎

**Files:**
- Create: `fund-analyst/server/analytics.ts`
- Create: `fund-analyst/server/advisor.ts`
- Create: `fund-analyst/server/settings.ts`
- Test: `fund-analyst/test/analytics.test.ts`
- Test: `fund-analyst/test/advisor.test.ts`

**Interfaces:**
- `calculatePortfolio(holdings, navs, settings) -> PortfolioMetrics`.
- `buildAdvice(metrics, marketState, settings) -> Advice[]` where each advice has `action`, `reasons[]`, `risks[]`, `asOf`, `confidence`.

- [ ] **Step 1: Add fixtures and tests for return, allocation, drawdown, volatility, and each advice state.**
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Implement pure deterministic calculations and threshold rules from the approved spec; missing inputs produce `insufficient_data`, never guessed values.**
- [ ] **Step 4: Test boundary cases (zero cost, one holding, stale quote, over-allocation); run full unit suite.**
- [ ] **Step 5: Commit `feat: add explainable portfolio advisor`.**

### Task 6: 仪表盘、市场页、每日简报与历史记录

**Files:**
- Create: `fund-analyst/server/report-routes.ts`
- Create: `fund-analyst/src/views/Dashboard.vue`
- Create: `fund-analyst/src/views/Market.vue`
- Create: `fund-analyst/src/views/DailyReport.vue`
- Create: `fund-analyst/src/views/Settings.vue`
- Create: `fund-analyst/src/router.ts`
- Test: `fund-analyst/test/report-api.test.ts`

**Interfaces:**
- `GET /api/dashboard` returns portfolio summary, market state, advice, and data coverage.
- `GET /api/reports?from=YYYY-MM-DD&to=YYYY-MM-DD` returns at least 30 days of stored reports.
- `POST /api/settings` validates risk tolerance, max drawdown, horizon, monthly budget, and max fund weight.

- [ ] **Step 1: Test report payload, 30-day filtering, and settings validation.**
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement report persistence and API composition with source/as-of metadata.**
- [ ] **Step 4: Build responsive pages showing reasons, risks, stale-data banners, and no automatic trade controls.**
- [ ] **Step 5: Commit `feat: add dashboard and daily reports`.**

### Task 7: 端到端验收与安全检查

**Files:**
- Create: `fund-analyst/test/e2e/first-run.spec.ts`
- Create: `fund-analyst/README.md`
- Create: `fund-analyst/.env.example`

- [ ] **Step 1: Write an E2E flow covering manual import, OCR draft/confirm, market sync mock, dashboard, and report history.**
- [ ] **Step 2: Run E2E and capture failures.**
- [ ] **Step 3: Fix only issues found in the approved first-phase scope; add checks for file type limits, SQL parameterization, local-only storage, and redacted error messages.**
- [ ] **Step 4: Run `npm run check` (tests, typecheck, lint, build) and confirm all pass.**
- [ ] **Step 5: Commit `test: verify personal fund analyst first phase`.**

## Self-review

- Spec coverage: architecture and privacy are covered by Tasks 1, 3, 4, and 7; import/OCR by Tasks 2–3; metrics/advice by Task 5; pages/history by Task 6; failure handling and 30-day retention by Tasks 4, 6, and 7.
- Placeholder scan: no TBD/TODO steps; interfaces and expected statuses are explicit.
- Type consistency: `PortfolioMetrics`, `Advice`, `IndexQuote`, and `FundNav` are produced by Tasks 4–5 and consumed by Task 6; route payloads are specified before UI work.
