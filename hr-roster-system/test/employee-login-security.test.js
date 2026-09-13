const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
process.env.EMPLOYEE_BIND_HMAC_SECRET = process.env.EMPLOYEE_BIND_HMAC_SECRET
  || 'test-employee-bind-secret-32-bytes-minimum';

const db = require('../src/db');
const authService = require('../src/services/auth.service');
const { createEmployeeAuthService } = require('../src/services/employee-auth.service');
const {
  requirePermission,
  requireManagerAccount,
  requireEmployeeAccount
} = require('../src/middlewares/auth.middleware');

function runGuard(guard, user) {
  let result;
  guard({ user }, {}, error => { result = error || null; });
  return result;
}

async function main() {
  const manager = {
    id: 1,
    accountType: 'MANAGER',
    employeeId: 88,
    permissions: ['employee:view']
  };
  const employee = {
    id: 2,
    accountType: 'EMPLOYEE',
    employeeId: 88,
    permissions: ['employee:view']
  };

  assert.equal(runGuard(requireEmployeeAccount, manager)?.statusCode, 403,
    '管理账号即使关联员工档案也不能调用员工本人接口');
  assert.equal(runGuard(requireManagerAccount, employee)?.statusCode, 403,
    '员工账号不能进入管理接口');
  assert.equal(runGuard(requirePermission('employee:view'), employee)?.statusCode, 403,
    '员工账号不能继承历史管理权限');

  const originalFirst = db.first;
  const originalQuery = db.query;
  try {
    db.first = async () => ({
      id: 2,
      company_id: 1,
      username: 'employee_1_88',
      employee_id: 88,
      account_type: 'EMPLOYEE',
      employee_status: 3,
      employee_deleted_at: null,
      token_version: 0
    });
    db.query = async () => {
      throw new Error('离职员工受限会话不得读取任何角色或权限');
    };
    const departed = await authService.getUserById(2);
    assert.equal(departed.accountType, 'EMPLOYEE');
    assert.deepEqual(departed.roles, []);
    assert.deepEqual(departed.permissions, [], '离职员工不能访问任何管理功能');
    assert.equal(departed.dataScope, 4);
  } finally {
    db.first = originalFirst;
    db.query = originalQuery;
  }

  let capturedParams;
  const employeeAuth = createEmployeeAuthService({
    db: {
      async first(_sql, params) {
        capturedParams = params;
        return {
          id: 88,
          name: '张三',
          phone: '13800000000',
          id_card_no: '32010119900101123X',
          employee_status: 2,
          customerName: '甲客户',
          projectName: '装配项目',
          positionName: '普工',
          wechatBound: 1,
          latestPayslipId: 9,
          salaryMonth: '2026-08',
          receiptStatus: 1,
          netAmount: '9999.00'
        };
      }
    },
    hmacSecret: 'test-employee-bind-secret-32-bytes-minimum',
    decrypt: value => String(value || '')
  });
  const profile = await employeeAuth.getProfile(1, employee);
  assert.deepEqual(capturedParams, { companyId: 1, employeeId: 88 });
  assert.equal(profile.phoneMasked, '138****0000');
  assert.equal(profile.idCardMasked, '320101********123X');
  assert.equal(Object.hasOwn(profile.latestPayslip, 'netAmount'), false,
    '员工首页不能返回工资金额');

  const serialized = JSON.stringify(profile);
  for (const secret of [
    '13800000000',
    '32010119900101123X',
    '9999.00',
    'test-employee-bind-secret-32-bytes-minimum'
  ]) {
    assert.equal(serialized.includes(secret), false, `员工响应泄露敏感值：${secret}`);
  }

  console.log('employee-login-security-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
