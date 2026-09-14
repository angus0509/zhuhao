const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';
process.env.EMPLOYEE_BIND_HMAC_SECRET = process.env.EMPLOYEE_BIND_HMAC_SECRET || 'test-employee-bind-secret-32-bytes-minimum';

function mysqlResult(rows = [], meta = []) {
  return [rows, meta];
}

function createHarness(options = {}) {
  const state = {
    employee: {
      id: 88,
      company_id: 1,
      name: '张三',
      phone: null,
      id_card_no: '32010119900101123X',
      employee_status: 2,
      deleted_at: null
    },
    code: null,
    bindings: [],
    users: new Map(),
    loginAudits: [],
    operationLogs: [],
    scopeChecks: [],
    ...options.state
  };

  const connection = {
    async execute(sql, params = {}) {
      if (/FROM hr_employee e[\s\S]*FOR UPDATE/i.test(sql) && /employee_bind_code/i.test(sql)) {
        if (!state.employee || !state.code) return mysqlResult([]);
        return mysqlResult([{
          ...state.employee,
          code_id: state.code.id,
          code_hash: state.code.code_hash,
          code_salt: state.code.code_salt,
          expire_at: state.code.expire_at,
          failed_attempts: state.code.failed_attempts,
          used_at: state.code.used_at
        }]);
      }
      if (/FROM hr_employee[\s\S]*FOR UPDATE/i.test(sql)) {
        return mysqlResult(state.employee ? [state.employee] : []);
      }
      if (/UPDATE employee_bind_code[\s\S]*used_at=NOW\(\)/i.test(sql)) {
        if (params.codeId) state.code.used_at = '2026-08-14 16:00:00';
        else if (state.code) state.code.used_at = '2026-08-14 16:00:00';
        return mysqlResult({ affectedRows: 1 });
      }
      if (/UPDATE employee_bind_code[\s\S]*failed_attempts/i.test(sql)) {
        state.code.failed_attempts += 1;
        return mysqlResult({ affectedRows: 1 });
      }
      if (/INSERT INTO employee_bind_code/i.test(sql)) {
        state.code = {
          id: 701,
          company_id: params.companyId,
          employee_id: params.employeeId,
          code_hash: params.codeHash,
          code_salt: params.codeSalt,
          expire_at: params.expireAt,
          failed_attempts: 0,
          used_at: null
        };
        return mysqlResult({ insertId: 701, affectedRows: 1 });
      }
      if (/FROM employee_wechat_binding/i.test(sql)) {
        return mysqlResult(state.bindings.filter(item =>
          item.employee_id === params.employeeId || item.openid === params.openid
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
      if (/UPDATE hr_employee SET phone/i.test(sql)) {
        state.employee.phone = params.phone;
        return mysqlResult({ affectedRows: 1 });
      }
      if (/INSERT INTO employee_login_audit/i.test(sql)) {
        state.loginAudits.push(params);
        return mysqlResult({ insertId: state.loginAudits.length, affectedRows: 1 });
      }
      if (/INSERT INTO hr_operation_log/i.test(sql)) {
        state.operationLogs.push(params);
        return mysqlResult({ insertId: state.operationLogs.length, affectedRows: 1 });
      }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    }
  };

  const db = {
    pool: connection,
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
      getPhoneNumber: async () => {
        throw new Error('绑定码路径不应调用手机号授权');
      }
    },
    hmacSecret: 'test-employee-bind-secret-32-bytes-minimum',
    now: () => new Date(options.now || '2026-08-14T08:00:00.000Z'),
    randomInt: () => 483921,
    randomBytes: size => Buffer.alloc(size, 9),
    decrypt: value => String(value || ''),
    assertEmployeeScope: async (companyId, employeeId, user, connection) => {
      harness.state.scopeChecks.push({ companyId, employeeId, user, connection });
    }
  });
}

async function createCode(service, harness) {
  const result = await service.createBindCode(1, 88, 7, {
    id: 7,
    accountType: 'MANAGER',
    permissions: ['employee:update'],
    dataScope: 5
  });
  assert.match(result.bindCode, /^\d{6}$/);
  assert.equal(result.bindCode, '483921');
  assert.equal(harness.state.scopeChecks.length, 1, '必须复用员工数据范围校验');
  assert.notEqual(harness.state.code.code_hash, result.bindCode, '数据库只能保存绑定码摘要');
  assert.equal(JSON.stringify(harness.state).includes('483921'), false, '绑定码明文不得进入审计或数据库状态');
  return result;
}

async function testGenerationAndSingleUseBinding() {
  const harness = createHarness();
  const service = loadService(harness);
  await createCode(service, harness);

  const result = await service.bindByCode(1, {
    loginCode: 'wx-login-secret',
    name: '张三',
    bindCode: '483921'
  }, { ipAddress: '127.0.0.1', deviceInfo: 'test-device' });

  assert.equal(result.user.employeeId, 88);
  assert.equal(result.user.accountType, 'EMPLOYEE');
  assert.equal(harness.state.code.used_at, '2026-08-14 16:00:00');
  assert.equal(harness.state.employee.phone, null, '无手机号绑定不得伪造或覆盖员工手机号');
  assert.equal(JSON.stringify(harness.state.loginAudits).includes('13900000000'), false,
    '审计不得记录完整手机号');

  await assert.rejects(
    () => service.bindByCode(1, {
      loginCode: 'login', name: '张三', bindCode: '483921'
    }, {}),
    /已使用|无效/
  );
}

async function testBindCodeWorksWithoutIdCard() {
  const harness = createHarness();
  harness.state.employee.id_card_no = null;
  const service = loadService(harness);
  await createCode(service, harness);
  const result = await service.bindByCode(1, {
    loginCode: 'wx-login-secret',
    name: '张三',
    bindCode: '483921'
  }, { ipAddress: '127.0.0.1' });
  assert.equal(result.user.employeeId, 88, '未登记身份证的员工应能通过绑定码登录');
}

async function testExpiredAndWrongCodeAreRejected() {
  const expiredHarness = createHarness();
  const expiredService = loadService(expiredHarness, { now: '2026-08-14T08:11:00.000Z' });
  const creator = loadService(expiredHarness);
  await createCode(creator, expiredHarness);
  await assert.rejects(
    () => expiredService.bindByCode(1, {
      loginCode: 'login', name: '张三', bindCode: '483921'
    }, {}),
    /已过期/
  );

  const wrongHarness = createHarness();
  const wrongService = loadService(wrongHarness);
  await createCode(wrongService, wrongHarness);
  await assert.rejects(
    () => wrongService.bindByCode(1, {
      loginCode: 'login', name: '张三', bindCode: '000000'
    }, {}),
    /姓名或绑定码错误/
  );
}

async function testMalformedExpiryFailsClosed() {
  const harness = createHarness();
  const service = loadService(harness);
  await createCode(service, harness);
  harness.state.code.expire_at = 'not-a-date';
  await assert.rejects(
    () => service.bindByCode(1, {
      loginCode: 'login', name: '张三', idCardLast6: '01123X', bindCode: '483921'
    }, {}),
    /已过期|无效/
  );
}

async function main() {
  await testGenerationAndSingleUseBinding();
  await testBindCodeWorksWithoutIdCard();
  await testExpiredAndWrongCodeAreRejected();
  await testMalformedExpiryFailsClosed();
  await require('./web-employee-bind-code.test').run();
  console.log('employee-bind-code-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
