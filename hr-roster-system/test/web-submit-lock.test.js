const assert = require('node:assert/strict');
const { withSubmitLock } = require('../public/js/core/form-submit');

async function run() {
  const button = { disabled: false, textContent: '确认保存', dataset: {} };
  let release;
  let requestCount = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const task = async () => {
    requestCount += 1;
    await pending;
    return 'done';
  };

  const first = withSubmitLock(button, task);
  const second = withSubmitLock(button, task);
  assert.equal(button.disabled, true, '请求期间提交按钮必须禁用');
  assert.equal(button.textContent, '提交中…', '请求期间应显示明确的提交状态');
  assert.equal(requestCount, 1, '连续点击不得触发第二次请求');

  release();
  assert.equal(await first, 'done');
  assert.equal(await second, undefined, '被拦截的重复提交不应返回业务结果');
  assert.equal(button.disabled, false, '请求结束后必须恢复按钮');
  assert.equal(button.textContent, '确认保存', '请求结束后必须恢复原文案');

  let failed = false;
  try {
    await withSubmitLock(button, async () => { throw new Error('network'); });
  } catch (error) {
    failed = error.message === 'network';
  }
  assert.equal(failed, true, '业务错误必须继续向调用方抛出');
  assert.equal(button.disabled, false, '请求失败后也必须恢复按钮');
}

run().then(() => console.log('web-submit-lock-tests-ok'));
