const env = require('../config/env');
const { createError } = require('../utils/response');

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/template/send';

function createWechatOfficialService(dependencies = {}) {
  const config = dependencies.config || env.wechatOfficial;
  const request = dependencies.request || (async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`wechat_http_${response.status}`);
    return response.json();
  });
  let tokenCache = null;

  function assertConfigured() {
    if (!config?.appId || !config?.appSecret) throw createError('服务号尚未配置', 503, 'WECHAT_OFFICIAL_NOT_CONFIGURED');
  }

  function buildAuthUrl(state) {
    assertConfigured();
    const query = new URLSearchParams({
      appid: config.appId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'snsapi_userinfo',
      state: String(state || '')
    });
    return `https://open.weixin.qq.com/connect/oauth2/authorize?${query.toString()}#wechat_redirect`;
  }

  async function getAccessToken() {
    assertConfigured();
    if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
    const query = new URLSearchParams({ grant_type: 'client_credential', appid: config.appId, secret: config.appSecret });
    let result;
    try {
      result = await request(`${TOKEN_URL}?${query.toString()}`, { method: 'GET' });
    } catch (_error) {
      throw createError('服务号接口暂时不可用', 502, 'WECHAT_OFFICIAL_UNAVAILABLE');
    }
    if (!result?.access_token) throw createError('服务号凭据无效或未开通接口', 502, String(result?.errcode || 'WECHAT_OFFICIAL_TOKEN_FAILED'));
    const expiresIn = Math.max(60, Number(result.expires_in || 7200) - 120);
    tokenCache = { value: String(result.access_token), expiresAt: Date.now() + expiresIn * 1000 };
    return tokenCache.value;
  }

  async function exchangeCode(code) {
    assertConfigured();
    const query = new URLSearchParams({ appid: config.appId, secret: config.appSecret, code: String(code || ''), grant_type: 'authorization_code' });
    let result;
    try {
      result = await request(`https://api.weixin.qq.com/sns/oauth2/access_token?${query.toString()}`, { method: 'GET' });
    } catch (_error) {
      throw createError('服务号授权暂时不可用', 502, 'WECHAT_OFFICIAL_UNAVAILABLE');
    }
    if (!result?.openid) throw createError('服务号授权无效，请重新进入绑定页', 400, String(result?.errcode || 'WECHAT_OFFICIAL_AUTH_FAILED'));
    return { openid: String(result.openid), unionid: result.unionid ? String(result.unionid) : null };
  }

  async function sendTemplate({ openid, templateId, month, url }) {
    if (!openid || !templateId) throw createError('服务号通知参数不完整', 400, 'WECHAT_OFFICIAL_INVALID_ARGUMENT');
    const accessToken = await getAccessToken();
    const payload = {
      touser: String(openid),
      template_id: String(templateId),
      url: String(url || config.redirectUri || ''),
      data: {
        first: { value: '您的工资条已发布，请登录查看' },
        keyword1: { value: String(month || '') },
        keyword2: { value: '待查看' },
        remark: { value: '请勿向他人透露登录信息' }
      }
    };
    let result;
    try {
      result = await request(`${SEND_URL}?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (_error) {
      throw createError('服务号通知发送失败，请稍后重试', 502, 'WECHAT_OFFICIAL_SEND_FAILED');
    }
    if (Number(result?.errcode || 0) !== 0) {
      const error = createError('服务号通知发送失败，请稍后重试', 502, `WECHAT_${String(result?.errcode || 'SEND_FAILED')}`);
      error.providerCode = String(result?.errcode || 'SEND_FAILED');
      throw error;
    }
    return { accepted: true, providerCode: '0', providerRequestId: result.msgid ? String(result.msgid) : '' };
  }

  return { buildAuthUrl, getAccessToken, exchangeCode, sendTemplate };
}

module.exports = { createWechatOfficialService };
