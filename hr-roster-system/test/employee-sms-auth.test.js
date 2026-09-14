const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

function createHarness(options = {}) {
  const state = {
    verifications: [],
    audits: [],
    providerCalls: [],
    employees: options.employees || [{
      id: 88, company_id: 1, name: '张三', phone: '13800000000',
      employee_status: 2, deleted_at: null
    }]
  };
  let nextId = 1;

  const connection = {
    async execute(sql, params = {}) {
      if (/FROM employee_sms_verification[\s\S]*FOR UPDATE/i.test(sql)) {
        const rows = state.verifications
          .filter(row => row.companyId === params.companyId && row.phoneHash === params.phoneHash)
          .sort((a, b) => b.id - a.id);
        return [rows.slice(0, 1).map(row => ({
          id: row.id,
          employee_id: row.employeeId,
          code_hash: row.codeHash,
          expires_at: row.expiresAt,
          failed_attempts: row.failedAttempts,
          send_status: row.sendStatus,
          consumed_at: row.consumedAt
        }))];
      }
      if (/UPDATE employee_sms_verification SET failed_attempts/i.test(sql)) {
        const row = state.verifications.find(item => item.id === params.verificationId);
        if (row) row.failedAttempts += 1;
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (/FROM hr_employee[\s\S]*FOR UPDATE/i.test(sql)) {
        const supportsDeparted = /employee_status\s+IN\s*\(2,3\)/i.test(sql);
        const rows = state.employees.filter(item => item.id === params.employeeId
          && item.company_id === params.companyId
          && (item.employee_status === 2 || (supportsDeparted && item.employee_status === 3))
          && !item.deleted_at);
        return [rows];
      }
      if (/UPDATE employee_sms_verification SET consumed_at/i.test(sql)) {
        const row = state.verifications.find(item => item.id === params.verificationId && !item.consumedAt);
        if (row) row.consumedAt = '2026-08-14 08:00:00';
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (/INSERT INTO employee_login_audit/i.test(sql)) {
        state.audits.push(params);
        return [{ insertId: state.audits.length, affectedRows: 1 }];
      }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    }
  };

  const db = {
    async query(sql, params = {}) {
      if (/SELECT created_at[\s\S]*phone_hash/i.test(sql)) {
        const rows = state.verifications
          .filter(row => row.companyId === params.companyId && row.phoneHash === params.phoneHash)
          .sort((a, b) => b.id - a.id);
        return rows.length ? [{ created_at: rows[0].createdAt }] : [];
      }
      if (/COUNT\(\*\) total[\s\S]*phone_hash/i.test(sql)) {
        return [{ total: state.verifications.filter(row => row.phoneHash === params.phoneHash).length }];
      }
      if (/COUNT\(\*\) total[\s\S]*request_ip_hash/i.test(sql)) {
        return [{ total: state.verifications.filter(row => row.ipHash === params.ipHash).length }];
      }
      if (/FROM hr_employee[\s\S]*phone=:phone/i.test(sql)) {
        const supportsDeparted = /employee_status\s+IN\s*\(2,3\)/i.test(sql);
        return state.employees.filter(item => item.company_id === params.companyId
          && item.phone === params.phone
          && (item.employee_status === 2 || (supportsDeparted && item.employee_status === 3))
          && !item.deleted_at).slice(0, 2);
      }
      if (/INSERT INTO employee_sms_verification/i.test(sql)) {
        const row = {
          id: nextId++,
          companyId: params.companyId,
          employeeId: params.employeeId,
          phoneHash: params.phoneHash,
          codeHash: params.codeHash,
          expiresAt: params.expiresAt,
          failedAttempts: 0,
          sendStatus: params.sendStatus,
          consumedAt: null,
          ipHash: params.ipHash,
          createdAt: params.createdAt
        };
        state.verifications.push(row);
        return { insertId: row.id, affectedRows: 1 };
      }
      if (/UPDATE employee_sms_verification[\s\S]*send_status/i.test(sql)) {
        const row = state.verifications.find(item => item.id === params.verificationId);
        if (row) {
          row.sendStatus = params.sendStatus;
          row.providerRequestId = params.providerRequestId;
        }
        return { affectedRows: row ? 1 : 0 };
      }
      throw new Error(`Unexpected query SQL: ${sql}`);
    },
    async transaction(handler) {
      return handler(connection);
    }
  };

  const provider = {
    async sendTemplate(payload) {
      state.providerCalls.push(payload);
      return { accepted: true, providerCode: 'Ok', providerMessage: '', requestId: 'request-1', serialNo: 'serial-1' };
    }
  };
  return { state, db, provider };
}

function createService(harness) {
  const { createEmployeeSmsAuthService } = require('../src/services/employee-sms-auth.service');
  return createEmployeeSmsAuthService({
    db: harness.db,
    smsProvider: harness.provider,
    hmacSecret: 'test-sms-code-hmac-secret-32-bytes-minimum',
    now: () => new Date('2026-08-14T08:00:00.000Z'),
    randomInt: () => 654321,
    issueEmployeeSession: async (_connection, employee) => ({
      token: 'employee-token',
      user: { companyId: 1, employeeId: employee.id, accountType: 'EMPLOYEE', roles: [], permissions: [] }
    })
  });
}

async function main() {
  const harness = createHarness();
  const service = createService(harness);
  const response = await service.requestLoginCode(1, { phone: '13800000000' }, { ipAddress: '127.0.0.1' });
  assert.deepEqual(response, { retryAfterSeconds: 60 });
  assert.equal(harness.state.providerCalls.length, 1);
  assert.deepEqual(harness.state.providerCalls[0], {
    phone: '13800000000', templateKey: 'loginCode', params: ['654321', '5']
  });
  assert.equal(JSON.stringify(harness.state.verifications).includes('654321'), false,
    '验证码不得明文入库');
  assert.equal(harness.state.verifications[0].sendStatus, 'SENT');

  const session = await service.loginByCode(1, { phone: '13800000000', code: '654321' }, {
    ipAddress: '127.0.0.1', deviceInfo: 'test-device'
  });
  assert.equal(session.user.accountType, 'EMPLOYEE');
  assert.equal(session.user.employeeId, 88);
  assert.ok(harness.state.verifications[0].consumedAt);
  assert.equal(JSON.stringify(harness.state.audits).includes('13800000000'), false);
  await assert.rejects(
    () => service.loginByCode(1, { phone: '13800000000', code: '654321' }, {}),
    error => error.businessCode === 'EMPLOYEE_SMS_CODE_INVALID'
  );

  const wrongHarness = createHarness();
  const wrongService = createService(wrongHarness);
  await wrongService.requestLoginCode(1, { phone: '13800000000' }, { ipAddress: '127.0.0.2' });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await assert.rejects(
      () => wrongService.loginByCode(1, { phone: '13800000000', code: '000000' }, {}),
      error => error.businessCode === (attempt === 5 ? 'EMPLOYEE_SMS_CODE_LOCKED' : 'EMPLOYEE_SMS_CODE_INVALID')
    );
  }
  assert.equal(wrongHarness.state.verifications[0].failedAttempts, 5);

  const departedHarness = createHarness({ employees: [{
    id: 89, company_id: 1, name: '离职员工', phone: '13900000000',
    employee_status: 3, deleted_at: null
  }] });
  const departedService = createService(departedHarness);
  await departedService.requestLoginCode(1, { phone: '13900000000' }, { ipAddress: '127.0.0.3' });
  const departedSession = await departedService.loginByCode(
    1,
    { phone: '13900000000', code: '654321' },
    { ipAddress: '127.0.0.3' }
  );
  assert.equal(departedSession.user.employeeId, 89,
    '已离职员工应能通过短信登录查看和签收本人工资条');
  assert.deepEqual(departedSession.user.permissions, []);

  const rehireHarness = createHarness({ employees: [
    { id: 90, company_id: 1, name: '孙敏', phone: '18676619260', employee_status: 2, deleted_at: null },
    { id: 91, company_id: 1, name: '孙敏', phone: '18676619260', employee_status: 3, deleted_at: null }
  ] });
  const rehireService = createService(rehireHarness);
  await rehireService.requestLoginCode(1, { phone: '18676619260' }, { ipAddress: '127.0.0.4' });
  const rehireSession = await rehireService.loginByCode(
    1,
    { phone: '18676619260', code: '654321' },
    { ipAddress: '127.0.0.4' }
  );
  assert.equal(rehireSession.user.employeeId, 90, '离职回流同名同手机号应优先取在职档案');

  console.log('employee-sms-auth-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
