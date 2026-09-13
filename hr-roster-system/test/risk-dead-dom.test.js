const assert = require('assert');
const fs = require('fs');

const root = '/Users/zhuhao/Documents/moluo/hr-roster-system';
const html = fs.readFileSync(`${root}/public/index.html`, 'utf8');
const app = fs.readFileSync(`${root}/public/app.js`, 'utf8');
const removedRiskIds = [
  'riskStatusFilter',
  'riskKeywordInput',
  'riskSummaryKpis',
  'riskQueueCount',
  'riskTableBody',
  'riskDetailContent',
  'riskDetailModal'
];

for (const id of removedRiskIds) {
  assert(!app.includes(`$('#${id}')`), `仍引用已移除的风险 DOM：${id}`);
}
assert(!app.includes("switchView('risk')"), '仍保留不可达的风险中心跳转');
assert(!app.includes('function renderRiskCenter'), '仍保留不可达的风险中心渲染函数');
assert(!html.includes('data-risk-preset="open"'), '仍保留已取消的风险指标入口');

console.log('risk-dead-dom-tests-ok');
