const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const employeeRoutes = read('src/routes/employee.routes.js');
const employeeService = read('src/services/employee.service.js');
const onsiteJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const taskJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
const appStyle = read('wechat-miniprogram/miniprogram/app.wxss');
const tabWxml = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxml');
const refreshUtil = read('wechat-miniprogram/miniprogram/utils/page-refresh.js');

assertIncludes(employeeRoutes, "router.get('/employees/onsite-overview'", '缺少驻厂轻量统计接口');
if (employeeRoutes.indexOf("'/employees/onsite-overview'") > employeeRoutes.indexOf("'/employees/:id'")) {
  throw new Error('驻厂统计接口必须注册在员工详情动态路由之前');
}
assertIncludes(employeeService, 'async function getOnsiteOverview', '后端缺少驻厂汇总查询');
assertIncludes(employeeService, 'applyDataScope(where, params', '驻厂统计未执行企业和项目数据隔离');
assertIncludes(onsiteJs, "request({ url: '/employees/onsite-overview' })", '驻厂页仍依赖下载全公司员工计算客户统计');
assertIncludes(onsiteJs, 'customerId ? `&customerId=', '驻厂员工查询未按当前客户缩小数据范围');
assertIncludes(onsiteJs, 'shouldRefresh(refreshKey, 20000)', '驻厂页切回时仍会无条件重复加载');
assertIncludes(onsiteJs, 'this._employeeCache[cacheKey]', '驻厂客户切换缺少短时内存缓存');

if (/await request\(\{ url: `\/work-tasks\/\$\{item\.taskId\}\/start`/.test(taskJs)) {
  throw new Error('待办点击仍在等待状态更新接口后才跳转');
}
if (/setTimeout\(\(\) => wx\.navigateTo[\s\S]{0,120}, 500\)/.test(taskJs)) {
  throw new Error('待办点击仍存在固定500ms等待');
}
if (tabWxml.includes('hover-class="tab-pressed"')) throw new Error('底部菜单仍显示点击变色/按压态');
assertIncludes(refreshUtil, 'function shouldRefresh', '缺少页面刷新节流工具');
if (!appStyle.includes('animation: mini-page-enter 160ms')) throw new Error('页面入场动画仍然过长');
if (/\.employee-card\s*\{[^}]*animation:/s.test(appStyle)) throw new Error('长员工列表仍逐卡执行入场动画');

for (const file of ['home/index.js', 'advances/index.js', 'payroll/index.js']) {
  const source = read(`wechat-miniprogram/miniprogram/pages/${file}`);
  assertIncludes(source, 'shouldRefresh(', `${file} 切换显示时仍会无条件请求接口`);
}

for (const file of ['add', 'onboard', 'insurance', 'resign', 'contract', 'transfer', 'transfer-handle']) {
  const source = read(`wechat-miniprogram/miniprogram/pages/employees/${file}/index.js`);
  assertIncludes(source, 'markDirty(', `${file} 保存后未通知驻厂页刷新`);
}

console.log('miniprogram-interaction-performance-tests-ok');
