const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = {
  first: async () => null,
  query: async () => []
};
const unrelatedServiceStubs = new Map([
  ['./employee.service', { assertEmployeeScope: async () => null }],
  ['./system.service', { MANAGED_ROLE_CODES: [], createUser: async () => null }],
  ['./notice.service', {}],
  ['./sms-delivery.service', {}],
  ['./official-notification.service', { createOfficialNotificationService: () => ({}) }],
  ['./payroll-import-profile.service', {}],
  ['./payroll-item-snapshot.service', { normalizeItemSnapshot: value => value }]
]);
const originalModuleLoad = Module._load;
Module._load = function loadWithoutUnrelatedDependencies(request, parent, isMain) {
  if (request === '../db') return db;
  if (request === 'pdf-lib') return { PDFDocument: {}, rgb: () => ({}) };
  if (request === '@pdf-lib/fontkit') return {};
  if (unrelatedServiceStubs.has(request)) return unrelatedServiceStubs.get(request);
  return originalModuleLoad.call(this, request, parent, isMain);
};
const service = require('../src/services/operations.service');
Module._load = originalModuleLoad;

const scopedUser = {
  id: 9,
  companyId: 1,
  dataScope: 5,
  scopeDeptIds: []
};

test('project list applies parameterized keyword and status filters to count and rows', async () => {
  const calls = [];
  db.first = async (sql, params) => {
    calls.push({ kind: 'first', sql, params: { ...params } });
    return { total: 1 };
  };
  db.query = async (sql, params) => {
    calls.push({ kind: 'query', sql, params: { ...params } });
    return [{ id: 12, projectName: '一厂项目', customerName: '测试客户', status: 2 }];
  };

  const result = await service.listProjects(1, {
    page: 1,
    pageSize: 20,
    keyword: ' 一厂 ',
    status: '2'
  }, scopedUser);

  assert.equal(result.total, 1);
  assert.equal(result.list.length, 1);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.params.companyId, 1);
    assert.equal(call.params.keyword, '%一厂%');
    assert.equal(call.params.status, 2);
    assert.match(call.sql, /p\.status\s*=\s*:status/);
    assert.match(call.sql, /p\.project_name LIKE :keyword/);
    assert.match(call.sql, /c\.customer_name LIKE :keyword/);
    assert.match(call.sql, /sys_user_project/);
  }
  assert.match(calls[0].sql, /JOIN crm_customer c/,
    'count query must join customers before filtering by customer name');
});

test('project list keeps empty filters backward compatible and rejects unknown status', async () => {
  db.first = async (_sql, params) => {
    assert.equal(params.keyword, '%%');
    assert.equal(params.status, null);
    return { total: 0 };
  };
  db.query = async (_sql, params) => {
    assert.equal(params.keyword, '%%');
    assert.equal(params.status, null);
    return [];
  };

  const result = await service.listProjects(1, {}, scopedUser);
  assert.deepEqual(result.list, []);

  await assert.rejects(
    () => service.listProjects(1, { status: '3' }, scopedUser),
    error => error.statusCode === 400 && error.businessCode === 'INVALID_PROJECT_STATUS'
  );
});
