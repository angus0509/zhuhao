const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const snapshotService = require('../src/services/payroll-item-snapshot.service');
const operationsService = require('../src/services/operations.service');

const user = { id: 9, companyId: 1, dataScope: 1, permissions: ['payroll:manage'] };
const signature = 'b'.repeat(64);
const sourceHeaders = ['姓名', '夜班奖', '住宿扣款', '实发工资'];
const mapping = [
  { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
  { columnIndex: 1, sourceHeader: '夜班奖', target: 'custom', category: 'income', includeInPayslip: true },
  { columnIndex: 2, sourceHeader: '住宿扣款', target: 'custom', category: 'deduction', includeInPayslip: true },
  { columnIndex: 3, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true }
];

async function withDbStubs(stubs, callback) {
  const original = { first: db.first, query: db.query, transaction: db.transaction };
  Object.assign(db, stubs);
  try {
    return await callback();
  } finally {
    Object.assign(db, original);
  }
}

async function main() {
  assert.deepEqual(snapshotService.normalizeItemSnapshot([
    { label: '夜班奖', value: '380.126', category: 'income', sortOrder: 1 },
    { label: '班组', value: 'A组', category: 'display', sortOrder: 2 },
    { label: '全勤奖', value: 0, category: 'income', sortOrder: 3 }
  ]), [
    { label: '夜班奖', value: 380.13, category: 'income', sortOrder: 1 },
    { label: '班组', value: 'A组', category: 'display', sortOrder: 2 },
    { label: '全勤奖', value: 0, category: 'income', sortOrder: 3 }
  ]);

  for (const invalid of [
    [{ label: '身份证号', value: '320101199001011234', category: 'display', sortOrder: 1 }],
    [{ label: '银行卡号', value: '6222020000000000', category: 'display', sortOrder: 1 }],
    [{ label: '手机号', value: '13900139000', category: 'display', sortOrder: 1 }],
    [{ label: '夜班奖', value: '=SUM(A1:A2)', category: 'income', sortOrder: 1 }],
    [{ label: '夜班奖', value: -1, category: 'income', sortOrder: 1 }],
    [{ label: '项目', value: '装配', category: 'unknown', sortOrder: 1 }],
    [
      { label: '底薪', value: 5000, category: 'income', sortOrder: 1 },
      { label: '实发', value: 5000, category: 'summary', sortOrder: 1 }
    ]
  ]) {
    assert.throws(() => snapshotService.normalizeItemSnapshot(invalid));
  }
  assert.throws(() => snapshotService.normalizeItemSnapshot(Array.from({ length: 81 }, (_, index) => ({
    label: `项目${index + 1}`,
    value: 1,
    category: 'income',
    sortOrder: index + 1
  }))), /最多80项/);
  assert.throws(() => snapshotService.normalizeItemSnapshot([{
    label: '备注',
    value: 'A'.repeat(64 * 1024),
    category: 'display',
    sortOrder: 1
  }]), /64KB/);

  await assert.rejects(() => operationsService.previewPayrollBatch(1, {
    projectId: 16,
    headerSignature: 'invalid',
    sourceHeaders,
    mapping,
    rows: [{ employeeNo: 'YG0001', baseSalary: 5000, netAmount: 5000 }]
  }, user), /表头签名格式不正确/);

  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    query: async () => [{ id: 88, name: '张三', employeeNo: 'YG0001' }]
  }, async () => {
    const preview = await operationsService.previewPayrollBatch(1, {
      projectId: 16,
      rows: [{
        sourceRowNo: 6,
        employeeNo: 'YG0001',
        baseSalary: 5000,
        otherDeduction: 150,
        netAmount: 4850,
        itemSnapshot: [
          { label: '夜班奖', value: 380.126, category: 'income', sortOrder: 1 },
          { label: '实发工资', value: 4850, category: 'summary', sortOrder: 2 }
        ]
      }]
    }, user);
    assert.deepEqual(preview.rows[0].itemSnapshot, [
      { label: '夜班奖', value: 380.13, category: 'income', sortOrder: 1 },
      { label: '实发工资', value: 4850, category: 'summary', sortOrder: 2 }
    ]);
    assert.equal(preview.rows[0].sourceRowNo, 6);

    const mismatch = await operationsService.previewPayrollBatch(1, {
      projectId: 16,
      headerSignature: signature,
      sourceHeaders,
      mapping,
      rows: [{
        employeeNo: 'YG0001',
        baseSalary: 5000,
        otherDeduction: 150,
        netAmount: 4850,
        itemSnapshot: [{ label: '实发工资', value: 9999, category: 'summary', sortOrder: 1 }]
      }]
    }, user);
    assert.match(mismatch.rows[0].errors.join('；'), /动态工资项目.*实发工资.*不一致/);
  });

  const executed = [];
  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    transaction: async callback => callback({
      execute: async (sql, params) => {
        executed.push({ sql, params });
        if (/SELECT id FROM salary_batch/.test(sql)) return [[]];
        if (/INSERT INTO salary_import_profile/.test(sql)) return [{ insertId: 41, affectedRows: 1 }];
        if (/INSERT INTO salary_batch/.test(sql)) return [{ insertId: 61, affectedRows: 1 }];
        if (/SELECT e\.id/.test(sql)) return [[{ id: 88, name: '张三', employeeNo: 'YG0001' }]];
        return [{ affectedRows: 1, insertId: 1 }];
      }
    })
  }, async () => {
    await operationsService.createPayrollBatch(1, {
      projectId: 16,
      salaryMonth: '2026-08',
      headerSignature: signature,
      sourceHeaders,
      mapping,
      sheetName: '8月工资',
      rows: [{
        sourceRowNo: 6,
        employeeNo: 'YG0001',
        baseSalary: 5000,
        otherDeduction: 150,
        netAmount: 4850,
        itemSnapshot: [
          { label: '夜班奖', value: 380, category: 'income', sortOrder: 1 },
          { label: '住宿扣款', value: 150, category: 'deduction', sortOrder: 2 },
          { label: '实发工资', value: 4850, category: 'summary', sortOrder: 3 }
        ]
      }]
    }, 9, user);
  });

  const existingCheck = executed.find(item => /SELECT id FROM salary_batch/.test(item.sql));
  assert.match(existingCheck.sql, /batch_status IN \(1,2,3,4\)/, '同项目同月已发放/归档后应允许多次发放');

  const batchInsert = executed.find(item => /INSERT INTO salary_batch/.test(item.sql));
  assert.match(batchInsert.sql, /import_profile_id/);
  assert.equal(batchInsert.params.importProfileId, 41);
  assert.equal(batchInsert.params.sourceSheetName, '8月工资');

  const detailInsert = executed.find(item => /INSERT INTO salary_detail/.test(item.sql));
  assert.match(detailInsert.sql, /item_snapshot/);
  assert.match(detailInsert.sql, /source_row_no/);
  assert.equal(detailInsert.params.sourceRowNo, 6);
  assert.deepEqual(JSON.parse(detailInsert.params.itemSnapshot), [
    { label: '夜班奖', value: 380, category: 'income', sortOrder: 1 },
    { label: '住宿扣款', value: 150, category: 'deduction', sortOrder: 2 },
    { label: '实发工资', value: 4850, category: 'summary', sortOrder: 3 }
  ]);

  const auditInsert = executed.find(item => /INSERT INTO hr_operation_log/.test(item.sql));
  assert.equal(auditInsert.params.afterData.includes('夜班奖'), false, '审计日志不得保存工资项目和值');
  assert.equal(auditInsert.params.afterData.includes('YG0001'), false, '审计日志不得保存员工身份信息');
  assert.equal(JSON.parse(auditInsert.params.afterData).profileId, 41);

  console.log('payroll-dynamic-persistence-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
