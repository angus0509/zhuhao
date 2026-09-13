const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
process.env.EMPLOYEE_BIND_HMAC_SECRET = process.env.EMPLOYEE_BIND_HMAC_SECRET || 'test-employee-bind-secret-32-bytes-minimum';

async function main() {
  let capturedSql = '';
  let capturedParams = null;
  const database = {
    async first(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      return {
        id: 88,
        name: '张三',
        phone: '13800000000',
        id_card_no: '32010119900101123X',
        employee_status: 2,
        customerName: '某电子厂',
        projectName: '生产项目',
        positionName: '普工',
        wechatBound: 1,
        latestPayslipId: 901,
        salaryMonth: '2026-08',
        receiptStatus: 1,
        netAmount: 999999
      };
    }
  };
  const { createEmployeeAuthService } = require('../src/services/employee-auth.service');
  const service = createEmployeeAuthService({
    db: database,
    hmacSecret: 'test-employee-bind-secret-32-bytes-minimum',
    decrypt: value => String(value || '')
  });

  const result = await service.getProfile(1, {
    id: 501,
    accountType: 'EMPLOYEE',
    employeeId: 88
  });

  assert.deepEqual(capturedParams, { companyId: 1, employeeId: 88 },
    '员工资料必须从已认证会话中派生 employeeId');
  assert.match(capturedSql, /e\.company_id=:companyId/);
  assert.match(capturedSql, /e\.id=:employeeId/);
  assert.match(capturedSql, /batch_status=5/);
  assert.deepEqual(result, {
    employeeId: 88,
    name: '张三',
    idCardMasked: '320101********123X',
    phoneMasked: '138****0000',
    customerName: '某电子厂',
    projectName: '生产项目',
    positionName: '普工',
    employeeStatus: 2,
    employeeStatusName: '在职',
    wechatBound: true,
    latestPayslip: {
      id: 901,
      salaryMonth: '2026-08',
      receiptStatus: 1,
      receiptStatusName: '待签收'
    }
  });
  assert.equal(JSON.stringify(result).includes('999999'), false, '员工首页资料不得返回工资金额');

  database.first = async sql => {
    assert.match(sql, /employee_status\s+IN\s*\(2,3\)/i,
      '员工本人资料入口必须允许已离职员工进入工资条工作台');
    return {
      id: 89,
      name: '离职员工',
      phone: '13900000000',
      id_card_no: '32010119900101123X',
      employee_status: 3,
      customerName: '某电子厂',
      projectName: '生产项目',
      positionName: '普工',
      wechatBound: 1,
      latestPayslipId: 902,
      salaryMonth: '2026-08',
      receiptStatus: 1
    };
  };
  const departedProfile = await service.getProfile(1, {
    id: 502,
    accountType: 'EMPLOYEE',
    employeeId: 89
  });
  assert.equal(departedProfile.employeeStatus, 3);
  assert.equal(departedProfile.employeeStatusName, '已离职');
  assert.equal(departedProfile.latestPayslip.id, 902);

  await assert.rejects(
    () => service.getProfile(1, { id: 501, accountType: 'EMPLOYEE', employeeId: null }),
    /未关联员工档案/
  );
  console.log('employee-profile-api-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
