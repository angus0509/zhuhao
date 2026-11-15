const assert = require('node:assert/strict');

const operationsService = require('../src/services/operations.service');
const noticeService = require('../src/services/notice.service');
const smsDeliveryService = require('../src/services/sms-delivery.service');
const {
  buildPayslipEvidenceSnapshot,
  hashPayslipEvidenceSnapshot
} = require('../src/services/payslip-evidence-snapshot.service');

function detailRow(id, overrides = {}) {
  return {
    companyId: 1,
    salaryDetailId: id,
    salaryMonth: '2026-10',
    employeeId: id + 100,
    employeeName: `员工${id}`,
    customerName: '某制造公司',
    projectName: '装配项目',
    itemSnapshot: [
      { label: '实发工资', value: '4800', category: 'summary', sortOrder: 1 }
    ],
    evidenceSnapshot: null,
    ...overrides
  };
}

function snapshotHarness(rows) {
  const state = { updates: [], queries: [] };
  const connection = {
    async execute(sql, params = {}) {
      state.queries.push({ sql, params });
      if (/SELECT d\.id salaryDetailId/.test(sql)) return [rows];
      if (/UPDATE salary_detail[\s\S]*evidence_schema_version='1\.0'/.test(sql)) {
        state.updates.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  return { connection, state };
}

async function main() {
  const createEvidenceSnapshotsForBatch = operationsService.createEvidenceSnapshotsForBatch;
  assert.equal(typeof createEvidenceSnapshotsForBatch, 'function', '工资发布服务必须导出批次证据快照函数');

  const existingRow = detailRow(903);
  const existingSnapshot = buildPayslipEvidenceSnapshot(existingRow);
  const harness = snapshotHarness([
    detailRow(901),
    detailRow(902, { itemSnapshot: JSON.stringify(detailRow(902).itemSnapshot) }),
    detailRow(903, {
      evidenceSchemaVersion: '1.0',
      evidenceSnapshot: existingSnapshot,
      evidenceContentSha256: hashPayslipEvidenceSnapshot(existingSnapshot)
    })
  ]);
  const result = await createEvidenceSnapshotsForBatch(harness.connection, { companyId: 1, batchId: 44 });
  assert.deepEqual(result, { count: 2 });
  assert.equal(harness.state.updates.length, 2);
  assert.match(harness.state.updates[0].params.evidenceContentSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(harness.state.updates[0].params.evidenceSnapshot).salaryDetailId, 901);
  assert.equal(
    harness.state.updates.some(item => Number(item.params.salaryDetailId) === 903),
    false,
    '已有证据快照不得覆盖'
  );
  assert.match(harness.state.queries[0].sql, /FOR UPDATE/);

  const invalid = snapshotHarness([
    detailRow(904),
    detailRow(905, { itemSnapshot: [] })
  ]);
  await assert.rejects(
    () => createEvidenceSnapshotsForBatch(invalid.connection, { companyId: 1, batchId: 45 }),
    /展示项目/
  );
  assert.equal(invalid.state.updates.length, 0, '批次存在无效明细时必须在写入任何快照前失败');

  const incompleteExisting = snapshotHarness([
    detailRow(907, { evidenceSnapshot: { schemaVersion: '1.0' } })
  ]);
  await assert.rejects(
    () => createEvidenceSnapshotsForBatch(incompleteExisting.connection, { companyId: 1, batchId: 47 }),
    /快照.*不完整|摘要.*不一致/
  );
  assert.equal(incompleteExisting.state.updates.length, 0, '不完整的已有快照不得自动覆盖');

  const events = [];
  const integrationConnection = {
    async execute(sql, params = {}) {
      if (/SELECT d\.id salaryDetailId/.test(sql)) return [[detailRow(906)]];
      if (/UPDATE salary_detail[\s\S]*evidence_schema_version='1\.0'/.test(sql)) {
        events.push('snapshot-update');
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE salary_batch SET batch_status=5/.test(sql)) {
        events.push('publish-status-update');
        return [{ affectedRows: 1 }];
      }
      if (/UPDATE salary_detail SET receipt_status=1/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO hr_operation_log/.test(sql)) return [{ insertId: 1, affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql} ${JSON.stringify(params)}`);
    }
  };
  const originalNotice = noticeService.createNotice;
  const originalEnqueue = smsDeliveryService.enqueuePublishedJobs;
  noticeService.createNotice = async () => ({ noticeId: 1 });
  smsDeliveryService.enqueuePublishedJobs = async () => ({ queued: 0, skippedNoPhone: 0 });
  try {
    const published = await operationsService._testing.finalizePayrollPublication(integrationConnection, {
      companyId: 1,
      batchId: 46,
      batch: { project_id: 9, salary_month: '2026-10' },
      operatorId: 7,
      fromStatus: 4,
      actionType: 'publish'
    });
    assert.equal(published.batchId, 46);
  } finally {
    noticeService.createNotice = originalNotice;
    smsDeliveryService.enqueuePublishedJobs = originalEnqueue;
  }
  assert.ok(
    events.indexOf('snapshot-update') < events.indexOf('publish-status-update'),
    '证据快照必须在批次发布状态更新之前写入'
  );

  console.log('payroll-evidence-publication-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
