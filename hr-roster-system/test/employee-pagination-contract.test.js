const assert = require('assert');
const Module = require('node:module');
const db = {
  first: async () => null,
  query: async () => []
};
const originalModuleLoad = Module._load;
Module._load = function loadWithIsolatedDependencies(request, parent, isMain) {
  if (request === '../db') return db;
  if (request === 'exceljs') return {};
  if (request === './notice.service') return {};
  if (request === '../utils/crypto') {
    return { encrypt: value => value, decrypt: value => value || '', sha256: value => value };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const employeeService = require('../src/services/employee.service');
Module._load = originalModuleLoad;

async function main() {
  let listQueryChecked = false;

  db.first = async (_sql, params) => {
    assert.strictEqual(params.pageSize, 2);
    assert.strictEqual(params.offset, 0);
    return { total: 1 };
  };
  db.query = async (sql, params) => {
    if (/LIMIT\s+:pageSize\s+OFFSET\s+:offset/i.test(sql)) {
      assert.strictEqual(params.pageSize, 2);
      assert.strictEqual(params.offset, 0);
      listQueryChecked = true;
      return [{
        id: 88,
        name: '单奇',
        phone: '13800000000',
        employee_status: 2,
        customer_name: '客户A',
        project_name: '一厂项目',
        position_name: '操作工'
      }];
    }
    return [];
  };

  const result = await employeeService.listEmployees(1, { page: 1, pageSize: 2 }, null);
  assert.strictEqual(listQueryChecked, true);
  assert.strictEqual(result.list.length, 1);
  assert.strictEqual(result.list[0].projectName, '一厂项目');

  console.log('employee-pagination-contract-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
