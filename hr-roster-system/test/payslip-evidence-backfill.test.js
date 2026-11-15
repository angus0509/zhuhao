const assert = require('node:assert/strict');
const {
  createPayslipEvidenceBackfill,
  parseArgs,
  exitCodeForSummary
} = require('../scripts/backfill-payslip-evidence-snapshots');

async function main() {
  assert.deepEqual(parseArgs([]), { apply: false, companyId: null });
  assert.deepEqual(parseArgs(['--apply', '--company-id', '7']), { apply: true, companyId: 7 });
  assert.throws(() => parseArgs(['--company-id', '0']), /企业ID/);
  assert.throws(() => parseArgs(['--unknown']), /参数/);
  assert.equal(exitCodeForSummary({ failed: 0 }), 0);
  assert.equal(exitCodeForSummary({ failed: 1 }), 1, '处理失败时命令必须返回非零退出码');

  const candidateRows = [
    { companyId: 1, batchId: 44, eligibleCount: 2 },
    { companyId: 2, batchId: 55, eligibleCount: 1 }
  ];
  const state = { querySql: '', transactions: 0, snapshots: [], output: [] };
  const database = {
    async query(sql, params) {
      state.querySql = sql;
      state.queryParams = params;
      return candidateRows;
    },
    async transaction(handler) {
      state.transactions += 1;
      return handler({ companyTransaction: state.transactions });
    }
  };
  const createSnapshots = async (connection, input) => {
    state.snapshots.push({ connection, input });
    return { count: input.batchId === 44 ? 2 : 0 };
  };
  const output = line => state.output.push(line);
  const runner = createPayslipEvidenceBackfill({ database, createSnapshots, output });

  const dryRun = await runner.run({ apply: false, companyId: null });
  assert.deepEqual(dryRun, { mode: 'dry-run', eligible: 3, applied: 0, skipped: 0, failed: 0 });
  assert.equal(state.transactions, 0);
  assert.equal(state.snapshots.length, 0);
  assert.match(state.querySql, /b\.batch_status=5/);
  assert.match(state.querySql, /d\.receipt_status=1/);
  assert.match(state.querySql, /d\.evidence_snapshot IS NULL/);
  assert.equal(state.output.some(line => line === 'company_id=1 eligible=2 applied=0 skipped=0 failed=0'), true);
  assert.equal(state.output.some(line => line === 'company_id=2 eligible=1 applied=0 skipped=0 failed=0'), true);
  assert.doesNotMatch(state.output.at(-1), /员工|工资|金额|employeeName|itemSnapshot/);

  const applied = await runner.run({ apply: true, companyId: null });
  assert.deepEqual(applied, { mode: 'apply', eligible: 3, applied: 2, skipped: 1, failed: 0 });
  assert.equal(state.transactions, 2, '每个企业必须使用独立事务');
  assert.equal(state.snapshots.every(item => item.input.onlyPending === true), true);
  assert.deepEqual(state.snapshots.map(item => item.input), [
    { companyId: 1, batchId: 44, onlyPending: true },
    { companyId: 2, batchId: 55, onlyPending: true }
  ]);
  assert.match(state.output.at(-1), /mode=apply eligible=3 applied=2 skipped=1 failed=0/);

  console.log('payslip-evidence-backfill-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
