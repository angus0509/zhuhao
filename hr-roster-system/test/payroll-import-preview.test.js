const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/operations.service');
const { sha256 } = require('../src/utils/crypto');

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
  assert.equal(typeof service.previewPayrollBatch, 'function', '缺少工资导入预校验服务');
  const queries = [];
  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (params.employeeNo === 'YG0001') return [{ id: 88, name: '张三', employeeNo: 'YG0001' }];
      if (params.idCardHash === sha256('320101199002022345')) return [{ id: 89, name: '李四', employeeNo: 'SYS89' }];
      if (params.employeeName === '重名员工') return [
        { id: 90, name: '重名员工', employeeNo: 'SYS90' },
        { id: 91, name: '重名员工', employeeNo: 'SYS91' }
      ];
      return [];
    }
  }, async () => {
    const result = await service.previewPayrollBatch(1, {
      projectId: 16,
      rows: [
        { rowNumber: 4, employeeNo: 'YG0001', baseSalary: 5000, otherDeduction: 200 },
        { rowNumber: 5, idCardNo: '320101199002022345', grossAmount: 6000, netAmount: 5500 },
        { rowNumber: 6, employeeName: '重名员工', baseSalary: 4500 },
        { rowNumber: 7, employeeName: '不存在人员', baseSalary: 4500 }
      ]
    }, user);
    assert.equal(result.totalRows, 4);
    assert.equal(result.validRows, 2);
    assert.equal(result.errorRows, 2);
    assert.equal(result.rows[0].employeeId, 88);
    assert.equal(result.rows[0].netAmount, 4800);
    assert.equal(result.rows[1].employeeId, 89);
    assert.equal(result.rows[1].baseSalary, 6000, '只有应发合计时应自动形成基本工资');
    assert.equal(result.rows[1].otherDeduction, 0, '应保留原表扣款明细，不得自动补写其他扣款');
    assert.equal(result.rows[1].warnings.length, 0,
      '仅有应发和实发、未提供扣款明细时，不应误提示金额异常');
    assert.match(result.rows[2].errors.join('；'), /存在重名/);
    assert.match(result.rows[3].errors.join('；'), /不存在|不属于/);
    assert.equal(result.rows[3].grossAmount, 4500, '员工匹配失败时也应展示原表应发金额');
    assert.equal(result.rows[3].netAmount, 4500, '员工匹配失败时也应展示原表实发金额');
  });

  const idCardQuery = queries.find(item => item.params.idCardHash);
  assert.ok(idCardQuery, '身份证匹配必须使用摘要查询');
  assert.match(idCardQuery.sql, /e\.id_card_hash=:idCardHash/);
  assert.equal(idCardQuery.params.idCardHash, sha256('320101199002022345'));
  assert.equal(idCardQuery.params.idCardNo, undefined, '不得把完整身份证号作为SQL参数');
  assert.ok(queries.every(item => /e\.employee_status\s+IN\s*\(2,3\)/i.test(item.sql)),
    '工资发放必须允许在职和已离职员工');
  assert.ok(queries.every(item => /EXISTS[\s\S]*hr_employee_job[\s\S]*customer_id=:customerId[\s\S]*project_id=:projectId/i.test(item.sql)),
    '员工匹配必须按所选客户项目的历史派驻记录隔离');
  assert.ok(queries.every(item => !/job_status=1/.test(item.sql)),
    '已离职员工的历史派驻记录不得被当前在职状态过滤');

  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    query: async () => [{ id: 92, name: '离职员工', employeeNo: 'YG0092' }]
  }, async () => {
    const result = await service.previewPayrollBatch(1, {
      projectId: 16,
      rows: [{
        employeeNo: 'YG0092',
        baseSalary: 2180,
        positionSalary: 1000,
        performanceSalary: 820,
        allowanceAmount: 800,
        grossAmount: 8000,
        otherDeduction: 90,
        netAmount: 7910
      }]
    }, user);
    assert.equal(result.validRows, 1, '已离职员工按历史项目匹配后应允许进入工资批次');
    assert.equal(result.rows[0].grossAmount, 8000, 'API 必须优先保留原表明确提供的应发合计');
    assert.equal(result.rows[0].netAmount, 7910, 'API 必须保留原表明确提供的实发金额');
    assert.equal(result.rows[0].otherDeduction, 90, 'API 不得因部分收入明细缺失虚增扣款');
  });

  // 创建批次必须复用同一套多身份匹配逻辑，不能再强制要求工号。
  const executed = [];
  await withDbStubs({
    first: async () => ({ id: 16, customerId: 6, projectName: '装配项目' }),
    transaction: async callback => callback({
      execute: async (sql, params) => {
        executed.push({ sql, params });
        if (/SELECT id FROM salary_batch/.test(sql)) return [[]];
        if (/SELECT e\.id/.test(sql)) return [[{ id: 89, name: '李四', employeeNo: 'SYS89' }]];
        if (/INSERT INTO salary_batch/.test(sql)) return [{ insertId: 61, affectedRows: 1 }];
        return [{ affectedRows: 1, insertId: 1 }];
      }
    })
  }, async () => {
    const result = await service.createPayrollBatch(1, {
      projectId: 16,
      salaryMonth: '2026-08',
      rows: [{ employeeName: '李四', phone: '13900139000', baseSalary: 6000, otherDeduction: 500 }]
    }, 9, user);
    assert.equal(result.employeeCount, 1);
  });
  const employeeLookup = executed.find(item => /SELECT e\.id/.test(item.sql));
  assert.match(employeeLookup.sql, /e\.name=:employeeName/);
  assert.equal(employeeLookup.params.employeeName, '李四');
  assert.equal(employeeLookup.params.phone, '13900139000');

  const routes = require('../src/routes/operations.routes');
  const previewRoute = (routes.stack || []).find(layer => layer.route?.path === '/payroll/batches/preview');
  assert.ok(previewRoute, '缺少工资导入预校验接口');
  assert.ok(previewRoute.route.methods.post);

  console.log('payroll-import-preview-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
