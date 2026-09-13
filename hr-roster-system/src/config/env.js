require('dotenv').config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3100),
  defaultCompanyId: Number(process.env.DEFAULT_COMPANY_ID || 1),
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
    tokenExpiresInSeconds: Number(process.env.JWT_EXPIRES_IN_SECONDS || 7 * 24 * 60 * 60),
    managerRememberLoginTtlSeconds: Number(process.env.MANAGER_REMEMBER_LOGIN_TTL_SECONDS || 30 * 24 * 60 * 60)
  },
  corsOrigins: String(process.env.CORS_ORIGINS || 'https://lczpt.com,https://www.lczpt.com')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hr_roster',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10)
  },
  crypto: {
    key: process.env.DATA_ENCRYPT_KEY || '',
    iv: process.env.DATA_ENCRYPT_IV || ''
  },
  wechatMini: {
    appId: process.env.WECHAT_MINIPROGRAM_APPID || '',
    appSecret: process.env.WECHAT_MINIPROGRAM_SECRET || '',
    urlScheme: process.env.WECHAT_MINIPROGRAM_URL_SCHEME || ''
  },
  wechatOfficial: {
    enabled: String(process.env.WECHAT_OFFICIAL_ENABLED || 'false').toLowerCase() === 'true',
    appId: process.env.WECHAT_OFFICIAL_APPID || '',
    appSecret: process.env.WECHAT_OFFICIAL_SECRET || '',
    templates: {
      payslipPublished: process.env.WECHAT_OFFICIAL_TEMPLATE_PAYSLIP_PUBLISHED || '',
      payslipReminder: process.env.WECHAT_OFFICIAL_TEMPLATE_PAYSLIP_REMINDER || ''
    },
    redirectUri: process.env.WECHAT_OFFICIAL_REDIRECT_URI || 'https://lczpt.com/api/wechat/official/callback'
  },
  employeeBinding: {
    hmacSecret: process.env.EMPLOYEE_BIND_HMAC_SECRET || '',
    ticketTtlSeconds: 5 * 60,
    codeTtlSeconds: 10 * 60,
    maxAttempts: 5
  },
  tencentSms: {
    enabled: String(process.env.TENCENT_SMS_ENABLED || 'false').toLowerCase() === 'true',
    region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
    sdkAppId: process.env.TENCENT_SMS_SDK_APP_ID || '',
    signName: process.env.TENCENT_SMS_SIGN_NAME || '',
    templates: {
      loginCode: process.env.TENCENT_SMS_TEMPLATE_LOGIN_CODE || '',
      payslipPublished: process.env.TENCENT_SMS_TEMPLATE_PAYSLIP_PUBLISHED || '',
      payslipReminder: process.env.TENCENT_SMS_TEMPLATE_PAYSLIP_REMINDER || ''
    },
    payslipUrlLink: process.env.TENCENT_SMS_PAYSLIP_URL_LINK || ''
  },
  smsCode: {
    hmacSecret: process.env.SMS_CODE_HMAC_SECRET || '',
    ttlSeconds: 5 * 60,
    resendSeconds: 60,
    maxDailySends: 10,
    maxHourlyIpRequests: 20,
    maxAttempts: 5
  }
};

function assertProductionSecurityConfig() {
  if (env.nodeEnv !== 'production') return;

  const errors = [];
  if (!env.db.password) errors.push('DB_PASSWORD 未配置');
  if (!env.auth.jwtSecret || env.auth.jwtSecret === 'dev-secret-change-me' || Buffer.byteLength(env.auth.jwtSecret, 'utf8') < 32) {
    errors.push('JWT_SECRET 必须为至少32字节的随机字符串');
  }
  if (Buffer.byteLength(env.crypto.key, 'utf8') !== 32) errors.push('DATA_ENCRYPT_KEY 必须为32字节');
  // 保留固定 IV 仅用于解密历史 enc:v1 数据；新数据已改用随机 nonce。
  if (Buffer.byteLength(env.crypto.iv, 'utf8') !== 16) errors.push('DATA_ENCRYPT_IV 必须为16字节');
  if (!env.wechatMini.appId) errors.push('WECHAT_MINIPROGRAM_APPID 未配置');
  if (!env.wechatMini.appSecret) errors.push('WECHAT_MINIPROGRAM_SECRET 未配置');
  if (env.wechatOfficial.enabled) {
    if (!env.wechatOfficial.appId) errors.push('WECHAT_OFFICIAL_APPID 未配置');
    if (!env.wechatOfficial.appSecret) errors.push('WECHAT_OFFICIAL_SECRET 未配置');
    if (!env.wechatOfficial.templates.payslipPublished) errors.push('WECHAT_OFFICIAL_TEMPLATE_PAYSLIP_PUBLISHED 未配置');
    if (!env.wechatOfficial.redirectUri) errors.push('WECHAT_OFFICIAL_REDIRECT_URI 未配置');
  }
  if (Buffer.byteLength(env.employeeBinding.hmacSecret, 'utf8') < 32) {
    errors.push('EMPLOYEE_BIND_HMAC_SECRET 必须为至少32字节的随机字符串');
  }
  if (env.tencentSms.enabled) {
    if (!env.wechatMini.urlScheme) errors.push('WECHAT_MINIPROGRAM_URL_SCHEME 未配置');
    if (!env.tencentSms.payslipUrlLink) errors.push('TENCENT_SMS_PAYSLIP_URL_LINK 未配置');
    if (!env.tencentSms.sdkAppId) errors.push('TENCENT_SMS_SDK_APP_ID 未配置');
    if (!env.tencentSms.signName) errors.push('TENCENT_SMS_SIGN_NAME 未配置');
    if (!env.tencentSms.templates.loginCode) errors.push('TENCENT_SMS_TEMPLATE_LOGIN_CODE 未配置');
    if (!env.tencentSms.templates.payslipPublished) errors.push('TENCENT_SMS_TEMPLATE_PAYSLIP_PUBLISHED 未配置');
    if (!env.tencentSms.templates.payslipReminder) errors.push('TENCENT_SMS_TEMPLATE_PAYSLIP_REMINDER 未配置');
    if (Buffer.byteLength(env.smsCode.hmacSecret, 'utf8') < 32) {
      errors.push('SMS_CODE_HMAC_SECRET 必须为至少32字节的随机字符串');
    }
  }
  if (errors.length) throw new Error(`生产安全配置不完整：${errors.join('；')}`);
}

env.assertProductionSecurityConfig = assertProductionSecurityConfig;

module.exports = env;
