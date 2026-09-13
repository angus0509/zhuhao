const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const servicePath = path.resolve(__dirname, '../src/services/manager-device-auth.service.js');
assert.ok(fs.existsSync(servicePath), '缺少驻厂端安全记住登录服务');

const { createManagerDeviceAuthService } = require(servicePath);

function fakeDb(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { affectedRows: 1 };
    },
    async transaction(handler) {
      const connection = {
        async execute(sql, params) {
          calls.push({ type: 'execute', sql, params });
          if (/SELECT[\s\S]+manager_login_device/.test(sql)) return [[row].filter(Boolean)];
          return [{ affectedRows: 1 }];
        }
      };
      return handler(connection);
    }
  };
}

async function main() {
  const now = new Date('2026-08-17T03:00:00.000Z');
  const issuedDb = fakeDb();
  const issuedService = createManagerDeviceAuthService({
    db: issuedDb,
    now: () => now,
    randomToken: () => 'plain-device-secret'
  });
  const issued = await issuedService.issue({
    companyId: 1,
    userId: 9,
    tokenVersion: 3,
    deviceInfo: 'WeChat iPhone',
    ipAddress: '127.0.0.1'
  });

  assert.equal(issued.refreshToken, 'plain-device-secret');
  assert.equal(issued.expiresAt, '2026-09-16T03:00:00.000Z',
    '客户端过期时间必须使用无时区歧义的ISO格式');
  const insert = issuedDb.calls.find(call => /INSERT INTO manager_login_device/.test(call.sql));
  assert.ok(insert, '签发设备凭证时必须写入数据库');
  assert.match(insert.sql, /DATE_ADD\(NOW\(\),\s*INTERVAL :ttlSeconds SECOND\)/,
    '数据库过期时间必须由MySQL统一计算，禁止依赖Node容器时区');
  assert.equal(insert.params.ttlSeconds, 30 * 24 * 60 * 60);
  assert.match(insert.params.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(insert.params).includes('plain-device-secret'), false,
    '数据库参数中禁止保存设备凭证明文');
  assert.equal(JSON.stringify(insert.params).includes('password'), false,
    '记住登录不得保存密码');
  assert.ok(issuedDb.calls.some(call => /INSERT INTO hr_operation_log/.test(call.sql)
    && call.params.actionType === 'remember_login_issue'), '签发设备凭证必须记录审计日志');

  const refreshDb = fakeDb({
    credentialId: 71,
    companyId: 1,
    userId: 9,
    credentialTokenVersion: 3,
    expireAt: '2026-09-01 00:00:00',
    userTokenVersion: 3,
    username: 'onsite01',
    company_id: 1,
    account_type: 'MANAGER',
    status: 1,
    token_version: 3
  });
  const refreshService = createManagerDeviceAuthService({
    db: refreshDb,
    now: () => now,
    randomToken: () => 'rotated-device-secret'
  });
  const refreshed = await refreshService.refresh({
    companyId: 1,
    refreshToken: 'old-device-secret',
    deviceInfo: 'WeChat Android',
    ipAddress: '127.0.0.2'
  });

  assert.equal(refreshed.user.username, 'onsite01');
  assert.equal(refreshed.refreshToken, 'rotated-device-secret');
  assert.ok(refreshDb.calls.some(call => /UPDATE manager_login_device[\s\S]+revoked_at/.test(call.sql)),
    '续登成功后必须撤销旧凭证');
  const refreshSelect = refreshDb.calls.find(call => /SELECT[\s\S]+manager_login_device/.test(call.sql));
  assert.match(refreshSelect.sql, /d\.expire_at\s*>\s*NOW\(\)/,
    '凭证是否过期必须由MySQL按同一时区判断');
  const rotatedInsert = refreshDb.calls.find(call => /INSERT INTO manager_login_device/.test(call.sql));
  assert.ok(rotatedInsert, '续登成功后必须轮换为新凭证');
  assert.equal(JSON.stringify(refreshDb.calls).includes('rotated-device-secret'), false,
    '轮换后的设备凭证也只能保存摘要');
  assert.ok(refreshDb.calls.some(call => /INSERT INTO hr_operation_log/.test(call.sql)
    && call.params.actionType === 'remember_login_refresh'), '一键续登必须记录审计日志');

  const staleDb = fakeDb({
    credentialId: 72,
    companyId: 1,
    userId: 9,
    credentialTokenVersion: 2,
    expireAt: '2026-09-01 00:00:00',
    userTokenVersion: 3,
    username: 'onsite01',
    company_id: 1,
    account_type: 'MANAGER',
    status: 1,
    token_version: 3
  });
  const staleService = createManagerDeviceAuthService({ db: staleDb, now: () => now });
  await assert.rejects(
    () => staleService.refresh({ companyId: 1, refreshToken: 'stale-token' }),
    error => error.statusCode === 401 && /失效/.test(error.message),
    '修改密码或权限变化后，旧设备凭证必须失效'
  );

  console.log('manager-remember-login-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
