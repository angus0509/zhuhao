const assert = require('node:assert/strict');
const { runMigration, buildDynamicPayload, payloadHmac, parseArgs } = require('../scripts/migrate-payslip-file-receipts-to-dynamic');

const row = {
  id: 9, companyId: 7, payslipId: 31,
  receiptPayload: JSON.stringify({
    schemaVersion: '1.0', receiptNo: 'PSR-20261115-ABCDEF123456',
    generatedAt: '2026-11-15T01:30:00.499Z', signedAt: '2026-11-15 09:29:57'
  }),
  storagePath: 'company-7/payslip-receipts/receipt.pdf', receiptSha256: 'a'.repeat(64),
  receiptGeneratedAt: '2026-11-15 09:30:01', signatureSignedAt: '2026-11-15 09:29:58'
};
const secret = 's'.repeat(32);

function harness(options = {}) {
  const calls = { updates: [], rollbacks: [], resolves: 0, deletes: [] };
  const database = {
    async query(sql, params) {
      if (/WHERE r\.storage_mode='FILE'/.test(sql)) return [row];
      calls.rollbacks.push({ sql, params });
      return { affectedRows: 1 };
    },
    async transaction(handler) {
      return handler({ async execute(sql, params) {
        calls.updates.push({ sql, params });
        return [{ affectedRows: 1 }];
      } });
    }
  };
  const service = {
    async resolvePayrollReceipt() {
      calls.resolves += 1;
      if (options.failDynamic && calls.resolves === 2) throw new Error('dynamic validation failed');
      return { buffer: Buffer.from('%PDF') };
    },
    async removeReceiptFile(storagePath) { calls.deletes.push(storagePath); }
  };
  return { database, service, calls };
}

async function main() {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(['--apply']), { apply: true });
  assert.throws(() => parseArgs(['--force']), /未知参数/);

  const migratedAt = new Date('2026-11-26T09:30:00.000Z');
  const payload = buildDynamicPayload(row, migratedAt);
  assert.deepEqual(payload.storageMigration, {
    schemaVersion: '1.0', from: 'FILE', storagePath: row.storagePath,
    receiptSha256: row.receiptSha256, originalGeneratedAt: '2026-11-15T01:30:00.499Z',
    originalSignedAt: '2026-11-15 09:29:57', migratedAt: migratedAt.toISOString()
  });
  assert.equal(payload.generatedAt, row.receiptGeneratedAt);
  assert.equal(payload.signedAt, row.signatureSignedAt);
  assert.match(payloadHmac(secret, payload), /^[a-f0-9]{64}$/);

  const dryRun = harness();
  assert.deepEqual(await runMigration({ db: dryRun.database, receiptService: dryRun.service,
    secret, now: () => migratedAt }), { scanned: 1, converted: 0, deleted: 0 });
  assert.equal(dryRun.calls.resolves, 1);
  assert.equal(dryRun.calls.updates.length, 0);
  assert.equal(dryRun.calls.deletes.length, 0);

  const apply = harness();
  assert.deepEqual(await runMigration({ db: apply.database, receiptService: apply.service,
    secret, now: () => migratedAt, apply: true }), { scanned: 1, converted: 1, deleted: 1 });
  assert.equal(apply.calls.resolves, 2);
  assert.equal(apply.calls.updates.length, 1);
  assert.match(apply.calls.updates[0].sql, /storage_mode='DYNAMIC'/);
  assert.equal(apply.calls.deletes[0], row.storagePath);

  const rollback = harness({ failDynamic: true });
  await assert.rejects(() => runMigration({ db: rollback.database, receiptService: rollback.service,
    secret, now: () => migratedAt, apply: true }), /dynamic validation failed/);
  assert.equal(rollback.calls.rollbacks.length, 1);
  assert.match(rollback.calls.rollbacks[0].sql, /storage_mode='FILE'/);
  assert.equal(rollback.calls.deletes.length, 0);
  console.log('payslip-file-receipt-migration-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
