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
  let summaryQueryCount = 0;
  let detailSocialQuery = '';

  db.first = async (sql, params) => {
    if (/FROM hr_social_security/.test(sql)) {
      detailSocialQuery = sql;
      return {
        id: 3,
        social_status: 1,
        social_city: '常州',
        employer_insurance_status: 1,
        employer_policy_no: 'HIDDEN-POLICY'
      };
    }
    if (/WHERE e\.company_id = :companyId[\s\S]*e\.id = :employeeId/.test(sql)) {
      return {
        id: 88,
        name: '单奇',
        employee_status: 2,
        social_status: 1,
        employer_insurance_status: 1,
        employer_end_date: '2027-01-01'
      };
    }
    if (/FROM hr_resignation/.test(sql)) return null;
    assert.strictEqual(params.pageSize, 2);
    assert.strictEqual(params.offset, 0);
    return { total: 1 };
  };
  db.query = async (sql, params) => {
    if (/GROUP BY\s+j\.customer_id,\s*cu\.customer_name/i.test(sql)) {
      assert.strictEqual(params.pageSize, 2);
      assert.strictEqual(params.offset, 0);
      summaryQueryCount += 1;
      return [{
        customerId: 7,
        customerName: '客户A',
        employeeCount: 1080,
        activeCount: 1080,
        riskCount: 3
      }];
    }
    if (/LIMIT\s+:pageSize\s+OFFSET\s+:offset/i.test(sql)) {
      assert.strictEqual(params.pageSize, 2);
      assert.strictEqual(params.offset, 0);
      listQueryChecked = true;
      return [{
        id: 88,
        name: '单奇',
        phone: '13800000000',
        employee_status: 2,
        insurance_status: 'ACTIVE',
        employer_insurance_status: 1,
        employer_end_date: '2027-01-01',
        customer_name: '客户A',
        project_name: '一厂项目',
        position_name: '操作工'
      }];
    }
    return [];
  };

  const result = await employeeService.listEmployees(1, { page: 1, pageSize: 2, includeRosterStats: '1' }, null);
  assert.strictEqual(listQueryChecked, true);
  assert.strictEqual(summaryQueryCount, 1);
  assert.strictEqual(result.list.length, 1);
  assert.strictEqual(result.list[0].projectName, '一厂项目');
  assert.strictEqual('insuranceStatus' in result.list[0], false);
  assert.strictEqual('employerInsuranceStatus' in result.list[0], false);
  assert.strictEqual('employerInsuranceStatusName' in result.list[0], false);
  assert.strictEqual('employerInsuranceEndDate' in result.list[0], false);
  assert.deepStrictEqual(result.customerStats, [{
    customerId: 7,
    customerName: '客户A',
    employeeCount: 1080,
    activeCount: 1080,
    riskCount: 3
  }]);

  const plainResult = await employeeService.listEmployees(1, { page: 1, pageSize: 2 }, null);
  assert.strictEqual(summaryQueryCount, 1, '普通员工分页不得额外执行花名册客户统计');
  assert.deepStrictEqual(plainResult.customerStats, []);

  const detail = await employeeService.getEmployeeDetail(1, 88);
  assert.doesNotMatch(detailSocialQuery, /employer_/i, '员工详情仍查询雇主险字段');
  assert.doesNotMatch(JSON.stringify(detail), /employerInsurance|HIDDEN-POLICY|2027-01-01/, '员工详情仍返回雇主险信息');
  assert.strictEqual(detail.socialSecurity.socialStatus, 1, '移除雇主险时不得误删正常社保状态');

  console.log('employee-pagination-contract-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
