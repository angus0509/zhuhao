const assert = require('node:assert/strict');
const env = require('../src/config/env');

env.wechatMini = {
  appId: 'wx-test-app-id',
  appSecret: 'wechat-secret-do-not-leak'
};

function loadService() {
  const modulePath = require.resolve('../src/services/wechat-mini.service');
  delete require.cache[modulePath];
  return require(modulePath);
}

function response(payload, ok = true) {
  return { ok, json: async () => payload };
}

async function expectRejectsWithoutSecrets(operation, pattern) {
  await assert.rejects(operation, error => {
    assert.match(error.message, pattern);
    assert.doesNotMatch(
      error.message,
      /wechat-secret-do-not-leak|access-token-secret|login-code-secret|phone-code-secret|session-key-secret/
    );
    return true;
  });
}

async function testSuccessAndTokenCache() {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('jscode2session')) {
      return response({
        openid: 'openid-1',
        unionid: 'union-1',
        session_key: 'session-key-secret'
      });
    }
    if (String(url).includes('/cgi-bin/token')) {
      return response({ access_token: 'access-token-secret', expires_in: 7200 });
    }
    return response({ phone_info: { purePhoneNumber: '13800000000' } });
  };

  const service = loadService();
  const session = await service.codeToSession('login-code-secret');
  const firstPhone = await service.getPhoneNumber('phone-code-secret');
  const secondPhone = await service.getPhoneNumber('second-phone-code');

  assert.deepEqual(session, { openid: 'openid-1', unionid: 'union-1' });
  assert.deepEqual(firstPhone, { phoneNumber: '13800000000' });
  assert.deepEqual(secondPhone, { phoneNumber: '13800000000' });
  assert.equal(calls.filter(call => call.url.includes('/cgi-bin/token')).length, 1, '应用 access token 应在内存复用');

  const codeToSessionCall = calls.find(call => call.url.includes('jscode2session'));
  assert.match(codeToSessionCall.url, /js_code=login-code-secret/);
  const phoneCalls = calls.filter(call => call.url.includes('getuserphonenumber'));
  assert.equal(phoneCalls.length, 2);
  assert.equal(JSON.parse(phoneCalls[0].options.body).code, 'phone-code-secret');
}

async function testInvalidAndMalformedResponses() {
  global.fetch = async url => {
    if (String(url).includes('jscode2session')) {
      return response({ errcode: 40029, errmsg: 'invalid login-code-secret wechat-secret-do-not-leak' });
    }
    if (String(url).includes('/cgi-bin/token')) {
      return response({ access_token: 'access-token-secret', expires_in: 7200 });
    }
    return response({ errcode: 40029, errmsg: 'bad phone-code-secret access-token-secret' });
  };

  const service = loadService();
  await expectRejectsWithoutSecrets(
    () => service.codeToSession('login-code-secret'),
    /微信登录凭证无效，请重新授权/
  );
  await expectRejectsWithoutSecrets(
    () => service.getPhoneNumber('phone-code-secret'),
    /微信手机号授权无效，请重新授权/
  );

  global.fetch = async url => {
    if (String(url).includes('/cgi-bin/token')) {
      return response({ access_token: 'access-token-secret', expires_in: 7200 });
    }
    return response({ phone_info: {} });
  };
  await expectRejectsWithoutSecrets(
    () => loadService().getPhoneNumber('phone-code-secret'),
    /未获取到微信手机号，请重新授权/
  );
}

async function testExpiredAccessTokenRetriesOnce() {
  let tokenCalls = 0;
  let phoneCalls = 0;
  global.fetch = async url => {
    if (String(url).includes('/cgi-bin/token')) {
      tokenCalls += 1;
      return response({ access_token: `access-token-secret-${tokenCalls}`, expires_in: 7200 });
    }
    phoneCalls += 1;
    if (phoneCalls === 1) return response({ errcode: 40014, errmsg: 'invalid access token' });
    return response({ phone_info: { phoneNumber: '13900000000' } });
  };

  const result = await loadService().getPhoneNumber('phone-code-secret');
  assert.deepEqual(result, { phoneNumber: '13900000000' });
  assert.equal(tokenCalls, 2, 'access token 失效后应刷新一次');
  assert.equal(phoneCalls, 2, '手机号接口只能重试一次');
}

async function testTimeoutAndInputValidation() {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = callback => {
    queueMicrotask(callback);
    return 1;
  };
  global.clearTimeout = () => {};
  global.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('request aborted with phone-code-secret');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  try {
    await expectRejectsWithoutSecrets(
      () => loadService().codeToSession('login-code-secret'),
      /微信服务请求超时，请稍后重试/
    );
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  const service = loadService();
  await assert.rejects(() => service.codeToSession(''), /缺少微信登录凭证/);
  await assert.rejects(() => service.getPhoneNumber('  '), /请授权获取微信手机号/);
}

async function main() {
  const originalFetch = global.fetch;
  try {
    await testSuccessAndTokenCache();
    await testInvalidAndMalformedResponses();
    await testExpiredAccessTokenRetriesOnce();
    await testTimeoutAndInputValidation();
  } finally {
    global.fetch = originalFetch;
  }
  console.log('wechat-mini-service-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
