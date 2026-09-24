const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const payrollImport = require('../public/js/core/payroll-import');
const snapshotService = require('../src/services/payroll-item-snapshot.service');
const operationsService = require('../src/services/operations.service');
const payslipService = require('../src/services/payslip.service');

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
    { label: '夜班奖', value: '380.126', category: 'display', sortOrder: 1 },
    { label: '班组', value: 'A组', category: 'display', sortOrder: 2 },
    { label: '全勤奖', value: '0', category: 'display', sortOrder: 3 }
  ]);

  for (const invalid of [
    [{ label: '身份证号', value: '320101199001011234', category: 'display', sortOrder: 1 }],
    [{ label: '银行卡号', value: '6222020000000000', category: 'display', sortOrder: 1 }],
    [{ label: '手机号', value: '13900139000', category: 'display', sortOrder: 1 }],
    [{ label: '夜班奖', value: '=SUM(A1:A2)', category: 'income', sortOrder: 1 }],
    [{ label: '项目', value: '装配', category: 'unknown', sortOrder: 1 }],
    [
      { label: '底薪', value: 5000, category: 'income', sortOrder: 1 },
      { label: '实发', value: 5000, category: 'summary', sortOrder: 1 }
    ]
  ]) {
    assert.throws(() => snapshotService.normalizeItemSnapshot(invalid));
  }
  for (const label of ['Bank Account', 'Phone', 'Mobile', 'National ID']) {
    assert.throws(() => snapshotService.normalizeItemSnapshot([
      { label, value: 'sensitive', category: 'display', sortOrder: 1 }
    ]), /敏感身份字段/);
  }
  for (const label of ['Project Name', 'Position Name', 'Department Name', 'Bank Name']) {
    assert.deepEqual(snapshotService.normalizeItemSnapshot([
      { label, value: '展示内容', category: 'display', sortOrder: 1 }
    ]), [
      { label, value: '展示内容', category: 'display', sortOrder: 1 }
    ], `${label} 不属于员工敏感身份字段，应允许作为工资条展示项`);
  }
  const englishDisplayMapping = payrollImport.buildSuggestedMapping([
    'Employee Name', 'Project Name', 'Position Name', 'Bank Name', 'Net Pay'
  ]);
  assert.equal(englishDisplayMapping[0].target, 'employeeName');
  for (const item of englishDisplayMapping.slice(1, 4)) {
    assert.equal(item.target, 'custom', `${item.sourceHeader} 应识别为自定义展示项`);
    assert.equal(item.includeInPayslip, true);
  }
  assert.deepEqual(payslipService._testing.parseDynamicItems([
    { label: '夜班奖', value: '300', category: 'display', sortOrder: 1 },
    { label: 'Bank Account', value: '6222020000000000', category: 'display', sortOrder: 2 },
    { label: 'Phone', value: '13900139000', category: 'display', sortOrder: 3 },
    { label: 'National ID', value: '320101199001011234', category: 'display', sortOrder: 4 }
  ]), [
    { label: '夜班奖', value: '300', category: 'display', sortOrder: 1 }
  ], '员工端必须过滤中英文敏感身份字段');
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
      { label: '夜班奖', value: '380.126', category: 'display', sortOrder: 1 },
      { label: '实发工资', value: '4850', category: 'display', sortOrder: 2 }
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

    const duplicateNet = payrollImport.parseFlexiblePayrollRows([
      ['工号', '实发工资', '实发工资'],
      ['YG0001', '4750', '4460']
    ]);
    const duplicateNetPreview = await operationsService.previewPayrollBatch(1, {
      projectId: 16,
      headerSignature: signature,
      sourceHeaders: duplicateNet.headers,
      mapping: duplicateNet.columnMapping,
      rows: duplicateNet.rows
    }, user);
    assert.equal(duplicateNetPreview.validRows, 1, '重复实发工资列应以最右侧映射列作为系统实发工资');
    assert.equal(duplicateNetPreview.rows[0].netAmount, 4460);
  });

  const executed = [];
  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    transaction: async callback => callback({
      execute: async (sql, params) => {
        executed.push({ sql, params });
        if (/SELECT id FROM salary_batch/.test(sql)) return [[{ id: 60 }]];
        if (/INSERT INTO salary_import_profile/.test(sql)) return [{ insertId: 41, affectedRows: 1 }];
        if (/INSERT INTO salary_batch/.test(sql)) return [{ insertId: 61, affectedRows: 1 }];
        if (/SELECT e\.id/.test(sql)) return [[{ id: 88, name: '张三', employeeNo: 'YG0001' }]];
        return [{ affectedRows: 1, insertId: 1 }];
      }
    })
  }, async () => {
    const result = await operationsService.createPayrollBatch(1, {
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
    assert.equal(result.batchId, 61,
      '同项目同月份已有进行中批次时仍应允许创建新的工资批次');
  });

  const existingCheck = executed.find(item => /SELECT id FROM salary_batch/.test(item.sql));
  assert.equal(existingCheck, undefined,
    '创建工资批次不得再查询或限制同项目同月份的其他批次');

  const batchInsert = executed.find(item => /INSERT INTO salary_batch/.test(item.sql));
  assert.match(batchInsert.sql, /import_profile_id/);
  assert.match(batchInsert.sql, /VALUES \([^)]*,3,0,0,/, '上传工资条后必须直接进入待复核状态');
  assert.equal(batchInsert.params.importProfileId, 41);
  assert.equal(batchInsert.params.sourceSheetName, '8月工资');

  const detailInsert = executed.find(item => /INSERT INTO salary_detail/.test(item.sql));
  assert.match(detailInsert.sql, /item_snapshot/);
  assert.match(detailInsert.sql, /source_row_no/);
  assert.equal(detailInsert.params.sourceRowNo, 6);
  assert.deepEqual(JSON.parse(detailInsert.params.itemSnapshot), [
    { label: '夜班奖', value: '380', category: 'display', sortOrder: 1 },
    { label: '住宿扣款', value: '150', category: 'display', sortOrder: 2 },
    { label: '实发工资', value: '4850', category: 'display', sortOrder: 3 }
  ]);

  const auditInsert = executed.find(item => /INSERT INTO hr_operation_log/.test(item.sql));
  assert.equal(auditInsert.params.afterData.includes('夜班奖'), false, '审计日志不得保存工资项目和值');
  assert.equal(auditInsert.params.afterData.includes('YG0001'), false, '审计日志不得保存员工身份信息');
  assert.equal(JSON.parse(auditInsert.params.afterData).profileId, 41);

  const duplicateNet = payrollImport.parseFlexiblePayrollRows([
    ['工号', '实发工资', '实发工资'],
    ['YG0001', '4750', '4460']
  ]);
  const duplicateCreateStatements = [];
  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    transaction: async callback => callback({
      execute: async (sql, params) => {
        duplicateCreateStatements.push({ sql, params });
        if (/INSERT INTO salary_import_profile/.test(sql)) return [{ insertId: 42, affectedRows: 1 }];
        if (/INSERT INTO salary_batch/.test(sql)) return [{ insertId: 62, affectedRows: 1 }];
        if (/SELECT e\.id/.test(sql)) return [[{ id: 88, name: '张三', employeeNo: 'YG0001' }]];
        return [{ affectedRows: 1, insertId: 1 }];
      }
    })
  }, async () => {
    const result = await operationsService.createPayrollBatch(1, {
      projectId: 16,
      salaryMonth: '2026-09',
      headerSignature: signature,
      sourceHeaders: duplicateNet.headers,
      mapping: duplicateNet.columnMapping,
      rows: duplicateNet.rows
    }, 9, user);
    assert.equal(result.batchId, 62, '重复实发工资列不应阻止创建批次');
  });
  const duplicateDetailInsert = duplicateCreateStatements.find(item => /INSERT INTO salary_detail/.test(item.sql));
  assert.equal(duplicateDetailInsert.params.netAmount, 4460, '创建批次必须使用最右侧实发工资列');

  console.log('payroll-dynamic-persistence-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
