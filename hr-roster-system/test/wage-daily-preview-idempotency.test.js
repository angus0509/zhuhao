const assert = require('node:assert/strict');
const db = require('../src/db');
const wage = require('../src/services/wage-calculation.service');

const previous = db.transaction;
let writes = 0;
db.transaction = async handler => handler({
  execute: async (sql) => {
    if (/FROM labor_project p/.test(sql)) return [[{ projectId: 12 }]];
    if (/FROM wage_calculation_runs/.test(sql) && /client_request_id/.test(sql)) {
      return [[{ id: 81, projectId: 12, salaryMonth: '2026-09', revisionNo: 2 }]];
    }
    if (!/^\s*SELECT\b/i.test(sql)) writes += 1;
    return [[]];
  }
});

wage.createPreview(3, { id: 9, dataScope: 1 }, 9, {
  projectId: 12, salaryMonth: '2026-09', clientRequestId: 'preview-idempotent-20260929'
}).then(result => {
  assert.equal(result.runId, 81);
  assert.equal(writes, 0, '相同请求不应新增工资预览');
  console.log('wage-daily-preview-idempotency-tests-ok');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => { db.transaction = previous; });
