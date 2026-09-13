const assert = require('assert');
const { createWechatOfficialService } = require('../src/services/wechat-official.service');

(async () => {
  const calls = [];
  const service = createWechatOfficialService({
    config: { appId: 'wx-test', appSecret: 'secret', redirectUri: 'https://lczpt.com/api/wechat/official/callback' },
    request: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/token')) return { access_token: 'token-1', expires_in: 7200 };
      return { errcode: 0, msgid: 'm1' };
    }
  });
  assert.match(service.buildAuthUrl('state-1'), /appid=wx-test/);
  assert.match(service.buildAuthUrl('state-1'), /scope=snsapi_userinfo/);
  const token1 = await service.getAccessToken();
  const token2 = await service.getAccessToken();
  assert.equal(token1, 'token-1');
  assert.equal(token2, 'token-1');
  assert.equal(calls.filter(call => call.url.includes('/token')).length, 1, 'access_token 应缓存');
  await service.sendTemplate({ openid: 'openid-1', templateId: 'tpl-1', month: '2026-08', url: 'https://lczpt.com/wx/payslip' });
  const payload = JSON.parse(calls.at(-1).options.body);
  assert.equal(payload.touser, 'openid-1');
  assert.equal(payload.template_id, 'tpl-1');
  assert.equal(payload.url, 'https://lczpt.com/wx/payslip');
  assert.ok(!JSON.stringify(payload).includes('身份证'));
  assert.ok(!JSON.stringify(payload).includes('银行卡'));
  assert.ok(!JSON.stringify(payload).includes('工资明细'));
  console.log('wechat-official-service-tests-ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
