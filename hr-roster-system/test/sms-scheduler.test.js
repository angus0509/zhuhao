const assert = require('node:assert/strict');

const schedulerPath = require.resolve('../src/scheduler');
const smsServicePath = require.resolve('../src/services/sms-delivery.service');
const originalSchedulerCache = require.cache[schedulerPath];
const originalSmsServiceCache = require.cache[smsServicePath];
const originalTimers = {
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval
};
const originalConsole = { log: console.log, error: console.error };

const timeoutCalls = [];
const intervalCalls = [];
const clearedTimeouts = [];
const clearedIntervals = [];
const logCalls = [];
const errorCalls = [];
let deliveryBehavior = async () => ({ claimed: 3, sent: 2, failed: 1, skipped: 0 });
const deliveryCalls = [];

global.setTimeout = (callback, delay) => {
  const handle = { type: 'timeout', id: timeoutCalls.length + 1 };
  timeoutCalls.push({ callback, delay, handle });
  return handle;
};
global.clearTimeout = handle => clearedTimeouts.push(handle);
global.setInterval = (callback, delay) => {
  const handle = { type: 'interval', id: intervalCalls.length + 1 };
  intervalCalls.push({ callback, delay, handle });
  return handle;
};
global.clearInterval = handle => clearedIntervals.push(handle);
console.log = (...args) => logCalls.push(args);
console.error = (...args) => errorCalls.push(args);

require.cache[smsServicePath] = {
  id: smsServicePath,
  filename: smsServicePath,
  loaded: true,
  exports: {
    processPendingJobs: async options => {
      deliveryCalls.push(options);
      return deliveryBehavior(options);
    }
  }
};
delete require.cache[schedulerPath];

async function main() {
  const scheduler = require('../src/scheduler');

  assert.equal(timeoutCalls.length, 0, '加载调度器模块时不得自动启动风险扫描');
  assert.equal(intervalCalls.length, 0, '加载调度器模块时不得自动启动短信任务');

  assert.equal(scheduler.startScheduler(), true, '首次启动调度器应成功');
  assert.equal(timeoutCalls.length, 1, '启动后应保留每日风险扫描计时器');
  assert.equal(intervalCalls.length, 1, '启动后应创建独立短信队列计时器');
  assert.equal(intervalCalls[0].delay, 60 * 1000, '短信队列应每分钟处理一次');
  assert.equal(scheduler.startScheduler(), false, '重复启动不得创建第二组计时器');
  assert.equal(timeoutCalls.length, 1, '重复启动不得复制风险扫描计时器');
  assert.equal(intervalCalls.length, 1, '重复启动不得复制短信队列计时器');

  const summary = await scheduler.runSmsDelivery();
  assert.deepEqual(summary, { claimed: 3, sent: 2, failed: 1, skipped: 0 });
  assert.deepEqual(deliveryCalls[0], { limit: 100 }, '每轮最多领取100条短信任务');
  assert.deepEqual(logCalls.at(-1), [
    '[Scheduler] 短信队列处理完成',
    { claimed: 3, sent: 2, failed: 1, skipped: 0 }
  ], '短信运行日志只能记录处理数量');

  let releaseDelivery;
  deliveryBehavior = () => new Promise(resolve => { releaseDelivery = resolve; });
  const firstRun = scheduler.runSmsDelivery();
  await Promise.resolve();
  const overlappingRun = await scheduler.runSmsDelivery();
  assert.deepEqual(overlappingRun, { skipped: true, reason: 'previous_sms_delivery_running' });
  assert.equal(deliveryCalls.length, 2, '短信任务未结束时不得重复领取队列');
  releaseDelivery({ claimed: 1, sent: 1, failed: 0, skipped: 0 });
  await firstRun;

  deliveryBehavior = async () => {
    const error = new Error('phone=13800000000 code=123456 secret=do-not-log');
    error.name = 'TencentProviderError';
    error.code = 'SMS_TIMEOUT';
    throw error;
  };
  const failedResult = await scheduler.runSmsDelivery();
  assert.deepEqual(failedResult, { failed: true, code: 'SMS_TIMEOUT' });
  const serializedErrors = JSON.stringify(errorCalls);
  assert.equal(serializedErrors.includes('13800000000'), false, '异常日志不得包含完整手机号');
  assert.equal(serializedErrors.includes('123456'), false, '异常日志不得包含验证码');
  assert.equal(serializedErrors.includes('do-not-log'), false, '异常日志不得包含凭据或模板参数');
  assert.deepEqual(errorCalls.at(-1), [
    '[Scheduler] 短信队列处理异常',
    { name: 'TencentProviderError', code: 'SMS_TIMEOUT' }
  ], '异常日志只允许输出错误名称和错误代码');

  scheduler.stopScheduler();
  assert.deepEqual(clearedTimeouts, [timeoutCalls[0].handle], '停止调度器应清理风险扫描计时器');
  assert.deepEqual(clearedIntervals, [intervalCalls[0].handle], '停止调度器应清理短信队列计时器');

  originalConsole.log('sms-scheduler-tests-ok');
}

main()
  .catch(error => {
    originalConsole.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.setTimeout = originalTimers.setTimeout;
    global.clearTimeout = originalTimers.clearTimeout;
    global.setInterval = originalTimers.setInterval;
    global.clearInterval = originalTimers.clearInterval;
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    delete require.cache[schedulerPath];
    if (originalSchedulerCache) require.cache[schedulerPath] = originalSchedulerCache;
    if (originalSmsServiceCache) require.cache[smsServicePath] = originalSmsServiceCache;
    else delete require.cache[smsServicePath];
  });
