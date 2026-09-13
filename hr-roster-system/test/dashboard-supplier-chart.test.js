const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dashboard = read('public/js/views/dashboard.js');
const html = read('public/index.html');
const portal = read('src/services/portal.service.js');
const prototype = read('server.js');

assert.doesNotMatch(dashboard, /\['高风险',\s*kpis\.highOpenRisks/, '驾驶舱不应继续展示高风险指标卡');
assert.match(dashboard, /function renderRecruitmentChannelChart\(/, '驾驶舱缺少招聘渠道分布图表渲染函数');
assert.match(dashboard, /recruitmentChannelDistribution/, '驾驶舱未读取招聘渠道分布数据');
assert.match(html, /id="recruitmentChannelChart"/, '驾驶舱缺少招聘渠道图表容器');
assert.match(html, /招聘渠道分布/, '驾驶舱缺少招聘渠道分布标题');
assert.match(portal, /recruitmentChannelDistribution/, '生产服务未返回招聘渠道分布数据');
assert.match(portal, /hr_recruitment_channel/, '生产服务未关联招聘渠道表');
assert.match(prototype, /recruitmentChannelDistribution/, '本地原型未返回招聘渠道分布数据');
assert.doesNotMatch(html, /class="chart-panel risk-matrix-panel/, '驾驶舱仍保留已下线的风险雷达面板');
assert.doesNotMatch(dashboard, /renderRiskTypes\(data\.riskByType/, '驾驶舱仍执行已下线的风险雷达渲染');

console.log('dashboard-supplier-chart-tests-ok');
