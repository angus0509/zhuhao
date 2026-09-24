const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('public/index.html');
const dashboard = read('public/js/views/dashboard.js');
const css = read('public/styles.css');

assert(!index.includes('<script src="https://cdn.bootcdn.net/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"'), '首屏不得预加载 Chart.js');
assert(index.includes('/js/core/resource-loader.js'), '页面缺少按需资源加载器');
assert(dashboard.includes('ensureChartJs()'), '驾驶舱未按需加载 Chart.js');
assert(dashboard.includes("typeof Chart === 'undefined'"), 'Chart.js 加载失败时缺少降级判断');
assert(dashboard.includes("type: 'doughnut'"), '用工结构或合规环形图未升级');
assert(dashboard.includes("type: 'line'"), '入离职趋势未升级为折线图');
assert(dashboard.includes("indexAxis: 'y'"), '客户或风险图未升级为水平柱状图');
assert(dashboard.includes('destroyDashboardChart'), '图表重复渲染时未销毁旧实例');
assert(dashboard.includes("classList.contains('motion-enabled')"), 'Chart.js 动画未受 motion 开关控制');
assert(dashboard.includes('escapeHtml(item.name)'), 'CSS 降级图表未转义业务名称');
assert(css.includes('.chart-canvas-host'), '缺少 Chart.js 响应式容器样式');
assert(dashboard.includes('renderRecruitmentChannelChart'), '驾驶舱缺少招聘渠道图表');

console.log('dashboard-chart-tests-ok');
