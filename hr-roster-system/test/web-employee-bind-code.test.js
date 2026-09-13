const assert = require('assert');

const {
  canGenerateEmployeeBindCode,
  createEmployeeBindCode
} = require('../public/js/core/employee-bind-code');

async function run() {
  assert.strictEqual(
    canGenerateEmployeeBindCode(['employee:update'], 2),
    true,
    '在职员工且具备 employee:update 权限时应允许生成绑定码'
  );
  assert.strictEqual(
    canGenerateEmployeeBindCode(['employee:update'], 3),
    true,
    '离职员工应允许生成绑定码，以便查看历史工资条'
  );
  assert.strictEqual(
    canGenerateEmployeeBindCode([], 2),
    false,
    '缺少 employee:update 权限时必须禁止生成绑定码'
  );
  assert.strictEqual(
    canGenerateEmployeeBindCode(['employee:update'], 1),
    false,
    '待到岗员工尚不能生成员工端绑定码'
  );

  const calls = [];
  const result = await createEmployeeBindCode({
    employeeId: 66,
    employeeName: '张三',
    request: async (url, options) => {
      calls.push({ url, options });
      return {
        bindCode: '483921',
        expireAt: '2026-08-26 22:45:00'
      };
    }
  });

  assert.deepStrictEqual(calls, [{
    url: '/api/employees/66/bind-code',
    options: { method: 'POST' }
  }], '生成绑定码必须调用指定员工的 POST 接口');
  assert.deepStrictEqual(result, {
    employeeId: 66,
    employeeName: '张三',
    bindCode: '483921',
    expireAt: '2026-08-26 22:45:00'
  }, '页面应获得完整、可直接展示的绑定码信息');

  await assert.rejects(
    () => createEmployeeBindCode({
      employeeId: 66,
      employeeName: '张三',
      request: async () => ({ expireAt: '2026-08-26 22:45:00' })
    }),
    /绑定码生成失败/,
    '接口没有返回绑定码时必须显示明确错误'
  );

  console.log('web-employee-bind-code-tests-ok');
}

if (require.main === module) {
  run().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { run };
