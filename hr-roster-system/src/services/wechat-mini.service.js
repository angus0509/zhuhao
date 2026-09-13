const env = require('../config/env');
const { createError } = require('../utils/response');

const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_SECONDS = 300;
const TOKEN_INVALID_CODES = new Set([40001, 40014, 42001]);

let accessTokenCache = {
  value: '',
  expiresAt: 0
};

async function wechatRequest(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw createError('微信服务暂时不可用，请稍后重试', 502);
    try {
      return await response.json();
    } catch (_error) {
      throw createError('微信服务返回异常，请稍后重试', 502);
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createError('微信服务请求超时，请稍后重试', 504);
    }
    if (Number.isInteger(error?.statusCode)) throw error;
    throw createError('微信服务暂时不可用，请稍后重试', 502);
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(endpoint, params) {
  const url = new URL(endpoint);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  return url.toString();
}

async function getAccessToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && accessTokenCache.value && accessTokenCache.expiresAt > now) {
    return accessTokenCache.value;
  }

  const url = buildUrl('https://api.weixin.qq.com/cgi-bin/token', {
    grant_type: 'client_credential',
    appid: env.wechatMini.appId,
    secret: env.wechatMini.appSecret
  });
  const payload = await wechatRequest(url, { method: 'GET' });
  const token = String(payload?.access_token || '');
  const expiresIn = Number(payload?.expires_in || 0);
  if (!token || payload?.errcode) throw createError('微信服务鉴权失败，请稍后重试', 502);

  accessTokenCache = {
    value: token,
    expiresAt: now + Math.max(0, expiresIn - TOKEN_REFRESH_MARGIN_SECONDS) * 1000
  };
  return token;
}

async function codeToSession(loginCode) {
  const code = String(loginCode || '').trim();
  if (!code) throw createError('缺少微信登录凭证');

  const url = buildUrl('https://api.weixin.qq.com/sns/jscode2session', {
    appid: env.wechatMini.appId,
    secret: env.wechatMini.appSecret,
    js_code: code,
    grant_type: 'authorization_code'
  });
  const payload = await wechatRequest(url, { method: 'GET' });
  if (payload?.errcode || !payload?.openid) {
    throw createError('微信登录凭证无效，请重新授权', 401);
  }

  // session_key 只由微信用于会话换取，本系统不返回、不缓存也不记录。
  return {
    openid: String(payload.openid),
    unionid: String(payload.unionid || '')
  };
}

async function requestPhoneNumber(phoneCode, accessToken) {
  const url = buildUrl('https://api.weixin.qq.com/wxa/business/getuserphonenumber', {
    access_token: accessToken
  });
  return wechatRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: phoneCode })
  });
}

async function getPhoneNumber(phoneCode) {
  const code = String(phoneCode || '').trim();
  if (!code) throw createError('请授权获取微信手机号');

  let accessToken = await getAccessToken();
  let payload = await requestPhoneNumber(code, accessToken);
  if (TOKEN_INVALID_CODES.has(Number(payload?.errcode))) {
    accessTokenCache = { value: '', expiresAt: 0 };
    accessToken = await getAccessToken(true);
    payload = await requestPhoneNumber(code, accessToken);
  }
  if (payload?.errcode) throw createError('微信手机号授权无效，请重新授权', 401);

  const phoneNumber = String(payload?.phone_info?.purePhoneNumber || payload?.phone_info?.phoneNumber || '').trim();
  if (!phoneNumber) throw createError('未获取到微信手机号，请重新授权');
  return { phoneNumber };
}

module.exports = {
  codeToSession,
  getPhoneNumber
};
