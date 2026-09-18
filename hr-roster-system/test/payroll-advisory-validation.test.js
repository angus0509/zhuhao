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
  assert.equal(parsed.rows[0].errors.length, 0, '上传金额关系不得作为阻断错误');
  assert.deepEqual(parsed.rows[0].warnings, [], '上传工资条不得生成金额异常提示');

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
    assert.deepEqual(preview.rows[0].warnings, [], '服务端不得重新生成金额异常提示');
  });

  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    query: async () => [{ id: 88, name: '张三', employeeNo: 'YG0001' }]
  }, async () => {
    const displayOnly = await operationsService.previewPayrollBatch(1, {
      projectId: 16,
      rows: [{ employeeNo: 'YG0001', baseSalary: 5000, otherDeduction: 200, netAmount: 4700 }]
    }, user);
    assert.equal(displayOnly.rows[0].baseSalary, 0, '基本工资不得参与系统计算字段');
    assert.equal(displayOnly.rows[0].otherDeduction, 0, '扣款不得参与系统计算字段');
    assert.equal(displayOnly.rows[0].grossAmount, 0, '不得根据工资类目或实发工资推导应发工资');
    assert.equal(displayOnly.rows[0].netAmount, 4700, '只保留上传的实发工资作为发放统计字段');
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
  assert.doesNotMatch(app, /工资数据存在异常提示|金额异常提示，仍可继续创建工资条/,
    '上传流程不得显示金额异常提示或二次确认');
  assert.doesNotMatch(html, /金额差异会提示|金额异常/,
    '工资条导入说明不得继续描述金额异常提示');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(packageJson.scripts.check, /payroll-advisory-validation\.test\.js/,
    '金额异常提示回归测试必须加入 npm run check');

  assert.equal(operationsService.payrollAmountWarnings, undefined,
    '服务端应彻底移除工资金额异常计算能力');

  console.log('payroll-advisory-validation-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
