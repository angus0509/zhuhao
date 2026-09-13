const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

function createDb(matches) {
  const inserted = [];
  return {
    inserted,
    async query(sql, params = {}) {
      if (/SELECT created_at/i.test(sql)) return [];
      if (/COUNT\(\*\) total/i.test(sql)) return [{ total: 0 }];
      if (/FROM hr_employee/i.test(sql)) return matches;
      if (/INSERT INTO employee_sms_verification/i.test(sql)) {
        inserted.push(params);
        return { insertId: inserted.length, affectedRows: 1 };
      }
      if (/UPDATE employee_sms_verification/i.test(sql)) return { affectedRows: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

async function main() {
  const { createEmployeeSmsAuthService } = require('../src/services/employee-sms-auth.service');
  for (const matches of [[], [
    { id: 1, company_id: 1, name: '张三', phone: '13800000000', employee_status: 2 },
    { id: 2, company_id: 1, name: '张四', phone: '13800000000', employee_status: 2 }
  ]]) {
    let providerCalls = 0;
    const db = createDb(matches);
    const service = createEmployeeSmsAuthService({
      db,
      smsProvider: { sendTemplate: async () => { providerCalls += 1; } },
      hmacSecret: 'test-sms-code-hmac-secret-32-bytes-minimum',
      now: () => new Date('2026-08-14T08:00:00.000Z'),
      randomInt: () => 654321
    });
    await assert.rejects(
      () => service.requestLoginCode(1, { phone: '13800000000' }, { ipAddress: '127.0.0.1' }),
      error => error.statusCode === 400
        && error.businessCode === 'EMPLOYEE_PHONE_NOT_REGISTERED'
        && error.message === '登记号码错误，请联系驻厂！'
    );
    assert.equal(providerCalls, 0, '无匹配或重复员工不得发送短信');
    assert.equal(JSON.stringify(db.inserted).includes('13800000000'), false);
  }
  console.log('employee-sms-enumeration-security-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
