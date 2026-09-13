const tencentcloud = require('tencentcloud-sdk-nodejs');
const { CvmRoleCredential } = require('tencentcloud-sdk-nodejs/tencentcloud/common/credential');
const env = require('../config/env');
const { createError } = require('../utils/response');

const SmsClient = tencentcloud.sms.v20210111.Client;

function normalizePhone(phone) {
  const value = String(phone || '').replace(/[\s-]/g, '');
  if (/^1\d{10}$/.test(value)) return `+86${value}`;
  if (/^\+861\d{10}$/.test(value)) return value;
  throw createError('手机号格式不正确');
}

function sanitizeProviderText(value) {
  return String(value || '')
    .replace(/(?:\+?86)?1\d{10}/g, '[masked-phone]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 160);
}

function createCredentialProvider({
  roleProvider = new CvmRoleCredential(),
  secretId = process.env.TENCENT_SECRET_ID || '',
  secretKey = process.env.TENCENT_SECRET_KEY || ''
} = {}) {
  let roleUnavailable = false;
  return {
    async getCredential() {
      if (!roleUnavailable) {
        try {
          const credential = await roleProvider.getCredential();
          if (credential?.secretId && credential?.secretKey) return credential;
        } catch (_error) {
          if (secretId && secretKey) roleUnavailable = true;
        }
      }
      if (secretId && secretKey) return { secretId, secretKey };
      throw new Error('Tencent Cloud credential unavailable');
    }
  };
}

function defaultCreateClient(config) {
  return new SmsClient({
    credential: createCredentialProvider(),
    region: config.region || 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com', reqTimeout: 10 } }
  });
}

function createTencentSmsService(dependencies = {}) {
  const config = dependencies.config || env.tencentSms;
  const createClient = dependencies.createClient || (() => defaultCreateClient(config));
  let client = null;

  function getClient() {
    if (!client) client = createClient();
    return client;
  }

  async function sendTemplate({ phone, templateKey, params = [] }) {
    if (!config.enabled) {
      throw createError('短信服务尚未启用', 503, 'SMS_NOT_ENABLED');
    }
    const templateId = String(config.templates?.[templateKey] || '').trim();
    if (!templateId || !config.sdkAppId || !config.signName) {
      throw createError('短信模板未配置', 503, 'SMS_TEMPLATE_NOT_CONFIGURED');
    }

    const request = {
      PhoneNumberSet: [normalizePhone(phone)],
      SmsSdkAppId: String(config.sdkAppId),
      SignName: String(config.signName),
      TemplateId: templateId,
      TemplateParamSet: params.map(value => String(value))
    };

    let payload;
    try {
      payload = await getClient().SendSms(request);
    } catch (_error) {
      throw createError('短信服务暂时不可用，请稍后重试', 502, 'SMS_PROVIDER_UNAVAILABLE');
    }

    const status = Array.isArray(payload?.SendStatusSet) ? payload.SendStatusSet[0] : null;
    const providerCode = String(status?.Code || 'EMPTY_RESPONSE');
    return {
      accepted: providerCode === 'Ok',
      providerCode,
      providerMessage: sanitizeProviderText(status?.Message || ''),
      requestId: String(payload?.RequestId || ''),
      serialNo: String(status?.SerialNo || '')
    };
  }

  return { sendTemplate, normalizePhone };
}

module.exports = {
  createTencentSmsService,
  createCredentialProvider,
  normalizePhone,
  sendTemplate: createTencentSmsService().sendTemplate
};
