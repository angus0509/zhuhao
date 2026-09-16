const assert = require('node:assert/strict');
const db = require('../src/db');
const service = require('../src/services/wage-calculation.service');

async function run() {
  const originalTransaction = db.transaction;
  const originalQuery = db.query;
  try {
    let projectQuery;
    db.transaction = async handler => handler({
      execute: async (sql, params) => {
        if (/FROM labor_project p/.test(sql)) {
          projectQuery = { sql, params };
          return [[]];
        }
        return [[]];
      }
    });
    await assert.rejects(
      service.createPreview(3, { id: 9, companyId: 3, dataScope: 5 }, 9, { projectId: 12, salaryMonth: '2026-10' }),
      error => error.businessCode === 'PROJECT_FORBIDDEN'
    );
    assert.match(projectQuery.sql, /p\.company_id=:companyId/);
    assert.match(projectQuery.sql, /sys_user_project/);
    assert.match(projectQuery.sql, /FOR UPDATE/);
    assert.equal(projectQuery.params.companyId, 3);

    let previewSql;
    db.query = async (sql, params) => {
      previewSql = sql;
      assert.equal(params.companyId, 3);
      assert.equal(params.runId, 81);
      return [];
    };
    await assert.rejects(
      service.getPreview(3, { id: 9, companyId: 3, dataScope: 5 }, 81),
      error => error.businessCode === 'WAGE_PREVIEW_NOT_FOUND'
    );
    assert.match(previewSql, /run\.company_id=:companyId/);
    assert.match(previewSql, /sys_user_project/);
  } finally {
    db.transaction = originalTransaction;
    db.query = originalQuery;
  }
}

run().then(() => console.log('wage-calculation-isolation.test.js: passed')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
