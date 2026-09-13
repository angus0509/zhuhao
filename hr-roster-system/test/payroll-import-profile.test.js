const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const service = require('../src/services/payroll-import-profile.service');

const signature = 'a'.repeat(64);
const user = { id: 19, companyId: 1, dataScope: 5 };

async function main() {
  const originalFirst = db.first;
  let captured = null;
  db.first = async (sql, params) => {
    captured = { sql, params };
    return {
      id: 8,
      projectId: 16,
      headerSignature: signature,
      sourceHeaders: JSON.stringify(['姓名', '夜班奖', '实发工资']),
      mappingJson: JSON.stringify([
        { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
        { columnIndex: 2, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true }
      ])
    };
  };
  try {
    const result = await service.findProfile(1, 16, signature, user);
    assert.equal(result.profileId, 8);
    assert.equal(result.mapping.length, 2);
    assert.match(captured.sql, /sip\.company_id=:companyId/);
    assert.match(captured.sql, /scope_up\.user_id = :scopeUserId/);
    assert.equal(captured.params.companyId, 1);
    assert.equal(captured.params.projectId, 16);
    assert.equal(captured.params.scopeUserId, 19);
  } finally {
    db.first = originalFirst;
  }

  await assert.rejects(() => service.findProfile(1, 16, 'not-a-hash', user), /表头签名格式不正确/);

  let executed = null;
  const connection = {
    execute: async (sql, params) => {
      executed = { sql, params };
      return [{ insertId: 21, affectedRows: 1 }];
    }
  };
  const saved = await service.upsertProfile(connection, {
    companyId: 1,
    projectId: 16,
    headerSignature: signature,
    sourceHeaders: ['姓名', '夜班奖', '实发工资'],
    mapping: [
      { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
      {
        columnIndex: 1,
        sourceHeader: '夜班奖',
        target: 'custom',
        category: 'income',
        includeInPayslip: true,
        value: '不得保存原始行值'
      },
      { columnIndex: 2, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true }
    ],
    operatorId: 19
  });
  assert.equal(saved.profileId, 21);
  assert.match(executed.sql, /ON DUPLICATE KEY UPDATE/);
  assert.match(executed.sql, /LAST_INSERT_ID\(id\)/);
  assert.equal(executed.params.companyId, 1);
  assert.ok(!executed.params.mappingJson.includes('不得保存原始行值'), '映射配置不得保存工资行数据');

  assert.throws(() => service.normalizeMapping([{
    columnIndex: 0,
    sourceHeader: '姓名',
    target: 'employeeName',
    category: '',
    includeInPayslip: false
  }]), /实发工资/);
  assert.throws(() => service.normalizeMapping([
    { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
    { columnIndex: 1, sourceHeader: '备用姓名', target: 'employeeName', category: '', includeInPayslip: false },
    { columnIndex: 2, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true }
  ]), /关键字段.*重复/);

  const routes = require('../src/routes/operations.routes');
  const route = (routes.stack || []).find(layer => layer.route?.path === '/payroll/import-profiles');
  assert.ok(route?.route?.methods?.get, '缺少项目工资字段映射查询接口');

  console.log('payroll-import-profile-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
