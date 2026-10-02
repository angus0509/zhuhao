const fs = require('node:fs');
const assert = require('node:assert/strict');

const navigation = fs.readFileSync('public/js/core/navigation-groups.js', 'utf8');
const router = fs.readFileSync('public/js/core/router.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const jsPath = 'public/js/views/daily-settlement.js';

assert.match(navigation, /view: 'dailySettlement', label: '日结薪资', permissions: \['payroll:view'\]/);
assert.match(router, /dailySettlement: \(\) => loadDailySettlement\(\)/);
assert.match(router, /dailySettlement: '#dailySettlementView'/);
for (const id of [
  'dailySettlementView', 'dailySettlementProject', 'dailySettlementDate',
  'dailySettlementStatus', 'dailySettlementKeyword', 'dailySettlementSummary',
  'dailySettlementBody', 'dailySettlementRefresh', 'dailySettlementBatchConfirm'
]) assert.match(html, new RegExp(`id="${id}"`));
assert.match(html, /src="\/js\/views\/daily-settlement\.js"/);
assert.equal(fs.existsSync(jsPath), true);
const js = fs.readFileSync(jsPath, 'utf8');
assert.match(js, /async function loadDailySettlement\(/);
assert.match(js, /async function confirmDailySettlementBatch\(/);
assert.match(js, /async function revokeDailySettlement\(/);
assert.match(js, /dailySettlementRequestGate\.begin/);
assert.match(js, /withSubmitLock/);
assert.match(js, /dailySettlementState\.runStatus === 'PREVIEW'/,
  '已失效预览不得再启用支付选择');
assert.match(js, /toast\('日结已确认支付'\);\s*await refreshDailySettlement\(\{ preview: true \}\)/,
  '确认支付后必须重新生成预览，不能继续使用已取消的运行版本');
console.log('web-daily-settlement-tests-ok');
