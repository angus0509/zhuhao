const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
process.env.EMPLOYEE_BIND_HMAC_SECRET = process.env.EMPLOYEE_BIND_HMAC_SECRET || 'test-employee-bind-secret-32-bytes-minimum';

function mysqlResult(rows = [], meta = []) {
  return [rows, meta];
}

function createHarness(options = {}) {
  const state = {
    ticketRows: new Map(),
    users: new Map(),
    bindings: [],
    loginAudits: [],
    bindingUpdates: [],
    employee: {
      id: 88,
      company_id: 1,
      name: '张三',
      phone: '13800000000',
      id_card_no: '32010119900101123X',
      employee_status: 2,
      deleted_at: null
    },
    ...options.state
  };

  const connection = {
    async execute(sql, params = {}) {
      if (/FROM employee_login_audit[\s\S]*FOR UPDATE/i.test(sql)) {
        const row = state.ticketRows.get(params.nonceHash);
        return mysqlResult(row ? [row] : []);
      }
      if (/FROM hr_employee(?:\s+e)?[\s\S]*FOR UPDATE/i.test(sql)) {
        const supportsDeparted = /employee_status\s+IN\s*\(2,3\)/i.test(sql);
        const eligible = state.employee && (state.employee.employee_status === 2
          || (supportsDeparted && state.employee.employee_status === 3));
        return mysqlResult(eligible ? [state.employee] : []);
      }
      if (/FROM employee_wechat_binding/i.test(sql)) {
        return mysqlResult(state.bindings.filter(item =>
          item.company_id === params.companyId
          && item.binding_status === 1
          && (item.employee_id === params.employeeId || item.openid === params.openid)
        ));
      }
      if (/FROM sys_user/i.test(sql)) {
        const user = state.users.get(params.employeeId);
        return mysqlResult(user ? [user] : []);
      }
      if (/INSERT INTO sys_user/i.test(sql)) {
        const user = { id: 501, token_version: 0 };
        state.users.set(params.employeeId, user);
        return mysqlResult({ insertId: user.id, affectedRows: 1 });
      }
      if (/UPDATE sys_user/i.test(sql)) return mysqlResult({ affectedRows: 1 });
      if (/DELETE FROM sys_user_role/i.test(sql)) return mysqlResult({ affectedRows: 0 });
      if (/INSERT INTO employee_wechat_binding/i.test(sql)) {
        state.bindings.push({
          company_id: params.companyId,
          employee_id: params.employeeId,
          user_id: params.userId,
          openid: params.openid,
          binding_status: 1
        });
        return mysqlResult({ insertId: 601, affectedRows: 1 });
      }
      if (/UPDATE employee_login_audit/i.test(sql)) {
        const row = state.ticketRows.get(params.nonceHash);
        if (!row || row.result_code !== 'ISSUED') return mysqlResult({ affectedRows: 0 });
        row.result_code = 'SUCCESS';
        row.user_id = params.userId;
        return mysqlResult({ affectedRows: 1 });
      }
      if (/INSERT INTO employee_login_audit/i.test(sql)) {
        state.loginAudits.push(params);
        return mysqlResult({ insertId: state.loginAudits.length, affectedRows: 1 });
      }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    }
  };

  const db = {
    pool: connection,
    async query(sql, params = {}) {
      if (/FROM employee_wechat_binding b/i.test(sql)) return options.existingBindings || [];
      if (/UPDATE employee_wechat_binding SET last_login_at/i.test(sql)) {
        state.bindingUpdates.push(params);
        return { affectedRows: 1 };
      }
      if (/FROM hr_employee e/i.test(sql) && /e\.phone=:phone/i.test(sql)) {
        if (options.phoneMatches) return options.phoneMatches;
        const supportsDeparted = /employee_status\s+IN\s*\(2,3\)/i.test(sql);
        const eligible = state.employee && (state.employee.employee_status === 2
          || (supportsDeparted && state.employee.employee_status === 3));
        return eligible ? [state.employee] : [];
      }
      if (/INSERT INTO employee_login_audit/i.test(sql)) {
        const row = { ...params, result_code: 'ISSUED' };
        state.ticketRows.set(params.nonceHash, row);
        state.loginAudits.push(row);
        return { insertId: state.loginAudits.length, affectedRows: 1 };
      }
      throw new Error(`Unexpected query SQL: ${sql}`);
    },
    async first(sql, params = {}) {
      const rows = await this.query(sql, params);
      return rows[0] || null;
    },
    async transaction(handler) {
      return handler(connection);
    }
  };

  return { db, state };
}

function loadService(harness, options = {}) {
  const { createEmployeeAuthService } = require('../src/services/employee-auth.service');
  return createEmployeeAuthService({
    db: harness.db,
    wechatMiniService: {
      codeToSession: async () => ({ openid: options.openid || 'openid-88', unionid: 'union-88' }),
      getPhoneNumber: async () => ({ phoneNumber: '13800000000' })
    },
    hmacSecret: 'test-employee-bind-secret-32-bytes-minimum',
    now: () => new Date('2026-08-14T08:00:00.000Z'),
    randomBytes: size => Buffer.alloc(size, 7),
    decrypt: value => String(value || '')
  });
}

async function testPhoneMatchIssuesSafeTicketAndBindsAtomically() {
  const harness = createHarness();
  const service = loadService(harness);
  const start = await service.startWechatLogin(1, {
    loginCode: 'wx-login-secret',
    phoneCode: 'wx-phone-secret'
  }, { ipAddress: '127.0.0.1', deviceInfo: 'test-device' });

  assert.equal(start.needIdentityVerify, true);
  assert.equal(start.maskedName, '张*');
  assert.ok(start.bindTicket);
  assert.equal(JSON.stringify(start).includes('13800000000'), false, '绑定预检不得泄露完整手机号');

  const result = await service.bindByPhone(1, {
    bindTicket: start.bindTicket,
    idCardLast6: '01123X'
  }, { ipAddress: '127.0.0.1', deviceInfo: 'test-device' });

  assert.equal(result.user.accountType, 'EMPLOYEE');
  assert.equal(result.user.employeeId, 88);
  assert.equal(result.user.dataScope, 4);
  assert.deepEqual(result.user.roles, []);
  assert.deepEqual(result.user.permissions, []);
  assert.ok(result.token);
  assert.equal(harness.state.bindings.length, 1);
  assert.equal(harness.state.ticketRows.values().next().value.result_code, 'SUCCESS');
  assert.equal(JSON.stringify(harness.state.loginAudits).includes('13800000000'), false,
    '审计不得记录完整手机号');
}

async function testPhoneMatchRejectsMissingDuplicateAndInactiveEmployees() {
  for (const matches of [[], [
    { id: 88, name: '张三', phone: '13800000000', employee_status: 2 },
    { id: 89, name: '张四', phone: '13800000000', employee_status: 2 }
  ]]) {
    const service = loadService(createHarness({ phoneMatches: matches }));
    await assert.rejects(
      () => service.startWechatLogin(1, { loginCode: 'login', phoneCode: 'phone' }, {}),
      matches.length ? /重复手机号/ : /未找到可绑定的在职或已离职员工/
    );
  }

  const inactiveHarness = createHarness({ state: { employee: null } });
  const inactiveService = loadService(inactiveHarness);
  await assert.rejects(
    () => inactiveService.startWechatLogin(1, { loginCode: 'login', phoneCode: 'phone' }, {}),
    /未找到可绑定的在职或已离职员工/
  );
}

async function testWrongSuffixReplayAndForeignBindingAreRejected() {
  const wrongHarness = createHarness();
  const wrongService = loadService(wrongHarness);
  const started = await wrongService.startWechatLogin(1, { loginCode: 'login', phoneCode: 'phone' }, {});
  await assert.rejects(
    () => wrongService.bindByPhone(1, { bindTicket: started.bindTicket, idCardLast6: '999999' }, {}),
    /身份信息校验失败/
  );

  await wrongService.bindByPhone(1, { bindTicket: started.bindTicket, idCardLast6: '01123X' }, {});
  await assert.rejects(
    () => wrongService.bindByPhone(1, { bindTicket: started.bindTicket, idCardLast6: '01123X' }, {}),
    /已失效|已使用/
  );

  const foreignHarness = createHarness();
  const foreignService = loadService(foreignHarness, { openid: 'openid-foreign' });
  const foreignStarted = await foreignService.startWechatLogin(1, { loginCode: 'login', phoneCode: 'phone' }, {});
  foreignHarness.state.bindings.push({
    company_id: 1,
    employee_id: 99,
    user_id: 599,
    openid: 'openid-foreign',
    binding_status: 1
  });
  await assert.rejects(
    () => foreignService.bindByPhone(1, { bindTicket: foreignStarted.bindTicket, idCardLast6: '01123X' }, {}),
    /当前微信已绑定其他员工/
  );
}

async function testPhoneChangedAfterTicketIssueRequiresRestart() {
  const harness = createHarness();
  const service = loadService(harness);
  const started = await service.startWechatLogin(1, { loginCode: 'login', phoneCode: 'phone' }, {});
  harness.state.employee.phone = '13900000000';
  await assert.rejects(
    () => service.bindByPhone(1, { bindTicket: started.bindTicket, idCardLast6: '01123X' }, {}),
    /档案手机号已变更/
  );
}

async function testExistingOpenidLogsInWithoutRebinding() {
  const harness = createHarness({
    existingBindings: [{
      bindingId: 601,
      employeeId: 88,
      userId: 501,
      openid: 'openid-88',
      username: 'employee_1_88',
      token_version: 3,
      name: '张三'
    }]
  });
  const service = loadService(harness);
  const result = await service.startWechatLogin(1, { loginCode: 'login' }, {});
  assert.equal(result.user.employeeId, 88);
  assert.equal(result.user.accountType, 'EMPLOYEE');
  assert.equal(result.needIdentityVerify, undefined);
  assert.deepEqual(harness.state.bindingUpdates, [{ bindingId: 601, companyId: 1 }],
    '已绑定登录必须更新正确的绑定记录');
}

async function testDepartedEmployeeCanUseRestrictedWechatLogin() {
  const harness = createHarness();
  harness.state.employee.employee_status = 3;
  const service = loadService(harness);
  const started = await service.startWechatLogin(1, {
    loginCode: 'departed-login',
    phoneCode: 'departed-phone'
  }, {});
  const result = await service.bindByPhone(1, {
    bindTicket: started.bindTicket,
    idCardLast6: '01123X'
  }, {});
  assert.equal(result.user.accountType, 'EMPLOYEE');
  assert.equal(result.user.employeeId, 88);
  assert.deepEqual(result.user.permissions, [],
    '离职员工微信登录后不得获得管理权限');
}

async function main() {
  await testPhoneMatchIssuesSafeTicketAndBindsAtomically();
  await testPhoneMatchRejectsMissingDuplicateAndInactiveEmployees();
  await testWrongSuffixReplayAndForeignBindingAreRejected();
  await testPhoneChangedAfterTicketIssueRequiresRestart();
  await testExistingOpenidLogsInWithoutRebinding();
  await testDepartedEmployeeCanUseRestrictedWechatLogin();
  console.log('employee-auth-flow-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
