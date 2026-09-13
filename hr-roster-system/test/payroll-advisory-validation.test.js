const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const payrollImport = require('../public/js/core/payroll-import');
const operationsService = require('../src/services/operations.service');

const user = { id: 9, companyId: 1, dataScope: 1, permissions: ['payroll:manage'] };

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
  const parsed = payrollImport.parseFlexiblePayrollRows([
    ['姓名', '应发工资', '实发工资'],
    ['张三', '100.00', '120.00']
  ]);
  assert.equal(parsed.rows[0].errors.length, 0, '金额关系异常只能提示，不能作为阻断错误');
  assert.match(parsed.rows[0].warnings.join('；'), /实发工资不能超过应发工资/);

  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    query: async () => [{ id: 88, name: '张三', employeeNo: 'YG0001' }]
  }, async () => {
    const preview = await operationsService.previewPayrollBatch(1, {
      projectId: 16,
      rows: [{ employeeNo: 'YG0001', grossAmount: 100, netAmount: 120 }]
    }, user);
    assert.equal(preview.errorRows, 0, '金额异常不应阻止创建工资条');
    assert.equal(preview.validRows, 1);
    assert.equal(preview.rows[0].grossAmount, 100, '应保留原表应发工资');
    assert.equal(preview.rows[0].netAmount, 120, '应保留原表实发工资');
    assert.match(preview.rows[0].warnings.join('；'), /实发工资不能超过应发工资/);
  });

  const executed = [];
  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    transaction: async callback => callback({
      execute: async (sql, params) => {
        executed.push({ sql, params });
        if (/SELECT id FROM salary_batch/.test(sql)) return [[]];
        if (/INSERT INTO salary_batch/.test(sql)) return [{ insertId: 61, affectedRows: 1 }];
        if (/SELECT e\.id/.test(sql)) return [[{ id: 88, name: '张三', employeeNo: 'YG0001' }]];
        return [{ affectedRows: 1, insertId: 1 }];
      }
    })
  }, async () => {
    const result = await operationsService.createPayrollBatch(1, {
      projectId: 16,
      salaryMonth: '2026-08',
      rows: [{ employeeNo: 'YG0001', grossAmount: 100, netAmount: 120 }]
    }, 9, user);
    assert.equal(result.employeeCount, 1);
  });
  const detailInsert = executed.find(item => /INSERT INTO salary_detail/.test(item.sql));
  assert.equal(detailInsert.params.grossAmount, 100);
  assert.equal(detailInsert.params.netAmount, 120);

  const app = fs.readFileSync('public/app.js', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(
    app,
    /confirmPayrollBatchImport[\s\S]*?preview\.rows[\s\S]*?warnings[\s\S]*?confirmDialog\(/,
    '存在金额异常提示时，创建前必须使用统一确认弹窗'
  );
  assert.match(html, /无阻断错误即可创建，金额差异会提示并可确认继续/,
    '工资条导入说明必须与金额异常仅提示的实际规则一致');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(packageJson.scripts.check, /payroll-advisory-validation\.test\.js/,
    '金额异常提示回归测试必须加入 npm run check');

  assert.deepEqual(
    operationsService.payrollAmountWarnings(6000, 5500, []),
    [],
    '工资条详情不能把只有应发/实发的正确金额标成异常'
  );
  assert.match(
    operationsService.payrollAmountWarnings(6000, 5500, [
      { label: '社保扣款', value: 100, category: 'deduction' }
    ]).join('；'),
    /应发工资减扣款明细/,
    '原表明确提供扣款明细且无法对应时仍需提示'
  );

  console.log('payroll-advisory-validation-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
