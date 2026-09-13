const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const {
  createTencentSmsService,
  createCredentialProvider,
  normalizePhone
} = require('../src/services/tencent-sms.service');

async function main() {
  const roleCredential = { secretId: 'temporary-role-id', secretKey: 'temporary-role-key', token: 'temporary-token' };
  const roleFirstProvider = createCredentialProvider({
    roleProvider: { getCredential: async () => roleCredential },
    secretId: 'fallback-id',
    secretKey: 'fallback-key'
  });
  assert.deepEqual(await roleFirstProvider.getCredential(), roleCredential, 'CVM实例角色应优先于长期环境变量凭据');

  const environmentFallbackProvider = createCredentialProvider({
    roleProvider: { getCredential: async () => { throw new Error('not running on cvm'); } },
    secretId: 'fallback-id',
    secretKey: 'fallback-key'
  });
  assert.deepEqual(await environmentFallbackProvider.getCredential(), {
    secretId: 'fallback-id',
    secretKey: 'fallback-key'
  }, '未绑定实例角色时应回退服务器环境变量凭据');

  assert.equal(normalizePhone('13800000000'), '+8613800000000');
  assert.equal(normalizePhone('+8613800000000'), '+8613800000000');
  assert.throws(() => normalizePhone('12345'), /手机号格式/);

  let capturedRequest = null;
  const service = createTencentSmsService({
    config: {
      enabled: true,
      region: 'ap-guangzhou',
      sdkAppId: '1400000000',
      signName: '优益数字化',
      templates: { loginCode: '100001' }
    },
    createClient: () => ({
      async SendSms(request) {
        capturedRequest = request;
        return {
          RequestId: 'request-1',
          SendStatusSet: [{ Code: 'Ok', Message: 'send success', SerialNo: 'serial-1' }]
        };
      }
    })
  });
  const result = await service.sendTemplate({
    phone: '13800000000',
    templateKey: 'loginCode',
    params: ['654321', '5']
  });
  assert.deepEqual(result, {
    accepted: true,
    providerCode: 'Ok',
    providerMessage: 'send success',
    requestId: 'request-1',
    serialNo: 'serial-1'
  });
  assert.deepEqual(capturedRequest, {
    PhoneNumberSet: ['+8613800000000'],
    SmsSdkAppId: '1400000000',
    SignName: '优益数字化',
    TemplateId: '100001',
    TemplateParamSet: ['654321', '5']
  });

  const disabled = createTencentSmsService({ config: { enabled: false, templates: {} } });
  await assert.rejects(
    () => disabled.sendTemplate({ phone: '13800000000', templateKey: 'loginCode', params: [] }),
    error => error.statusCode === 503 && error.businessCode === 'SMS_NOT_ENABLED'
  );

  await assert.rejects(
    () => service.sendTemplate({ phone: '13800000000', templateKey: 'unknown', params: [] }),
    /短信模板未配置/
  );

  const rejected = createTencentSmsService({
    config: {
      enabled: true,
      sdkAppId: '1400000000',
      signName: '优益数字化',
      templates: { loginCode: '100001' }
    },
    createClient: () => ({
      SendSms: async () => ({
        RequestId: 'request-2',
        SendStatusSet: [{ Code: 'FailedOperation', Message: 'phone 13800000000 rejected', SerialNo: '' }]
      })
    })
  });
  const rejectedResult = await rejected.sendTemplate({
    phone: '13800000000', templateKey: 'loginCode', params: ['654321', '5']
  });
  assert.equal(rejectedResult.accepted, false);
  assert.equal(JSON.stringify(rejectedResult).includes('13800000000'), false);

  const transportFailure = createTencentSmsService({
    config: {
      enabled: true,
      sdkAppId: '1400000000',
      signName: '优益数字化',
      templates: { loginCode: '100001' }
    },
    createClient: () => ({
      SendSms: async () => { throw new Error('secret value and phone 13800000000'); }
    })
  });
  await assert.rejects(
    () => transportFailure.sendTemplate({ phone: '13800000000', templateKey: 'loginCode', params: [] }),
    error => error.statusCode === 502
      && error.businessCode === 'SMS_PROVIDER_UNAVAILABLE'
      && !error.message.includes('13800000000')
      && !error.message.includes('secret value')
  );

  console.log('tencent-sms-service-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
