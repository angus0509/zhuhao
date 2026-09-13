const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const templateService = require('../src/services/payroll-import-template.service');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const user = { id: 9, companyId: 1, dataScope: 1, permissions: ['payroll:manage'] };
const sourceHeaders = ['姓名', '基本工资', '实发工资'];
const mapping = [
  { columnIndex: 0, sourceHeader: '姓名', target: 'employeeName', category: '', includeInPayslip: false },
  { columnIndex: 1, sourceHeader: '基本工资', target: 'baseSalary', category: 'income', includeInPayslip: true },
  { columnIndex: 2, sourceHeader: '实发工资', target: 'netAmount', category: 'summary', includeInPayslip: true }
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
  await withDbStubs({
    query: async () => [
      { id: 1, name: '标准模板', sourceHeaders: JSON.stringify(sourceHeaders), mappingJson: JSON.stringify(mapping), lastUsedAt: null, updatedAt: null }
    ]
  }, async () => {
    const list = await templateService.listTemplates(1, 10, user);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, '标准模板');
    assert.deepEqual(list[0].sourceHeaders, sourceHeaders);
    assert.deepEqual(list[0].mapping, mapping);
  });

  await withDbStubs({ query: async () => ({ insertId: 7 }) }, async () => {
    const result = await templateService.createTemplate(1, { projectId: 10, name: '标准模板', sourceHeaders, mapping }, 9);
    assert.equal(result.templateId, 7);
  });

  await withDbStubs({
    query: async () => { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
  }, async () => {
    await assert.rejects(
      () => templateService.createTemplate(1, { projectId: 10, name: '标准模板', sourceHeaders, mapping }, 9),
      /模板名称已存在/
    );
  });

  await withDbStubs({ query: async () => ({ affectedRows: 0 }) }, async () => {
    await assert.rejects(
      () => templateService.updateTemplate(1, 999, { name: '改名', sourceHeaders, mapping }),
      /模板不存在/
    );
  });

  await withDbStubs({ query: async () => ({ affectedRows: 1 }) }, async () => {
    const result = await templateService.deleteTemplate(1, 5);
    assert.equal(result.templateId, 5);
  });

  await assert.rejects(() => templateService.createTemplate(1, { projectId: 10, name: '', sourceHeaders, mapping }, 9), /模板名称不能为空/);
  await assert.rejects(() => templateService.createTemplate(1, { projectId: 10, name: 'x'.repeat(51), sourceHeaders, mapping }, 9), /模板名称最多50个字符/);

  const routes = read('src/routes/operations.routes.js');
  assert.match(routes, /router\.get\('\/payroll\/templates', requirePermission\('payroll:manage'\)/);
  assert.match(routes, /router\.post\('\/payroll\/templates', requirePermission\('payroll:manage'\)/);
  assert.match(routes, /router\.put\('\/payroll\/templates\/:id', requirePermission\('payroll:manage'\)/);
  assert.match(routes, /router\.delete\('\/payroll\/templates\/:id', requirePermission\('payroll:manage'\)/);

  console.log('payroll-import-template-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
