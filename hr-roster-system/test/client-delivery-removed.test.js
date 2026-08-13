const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const miniHomePath = path.join(root, 'wechat-miniprogram', 'miniprogram', 'pages', 'home', 'index.wxml');

// 仅移除前端工作台和入口，历史数据及后端接口继续保留。
for (const marker of [
  '客户交付台',
  'clientServicesView',
  'clientServiceModal',
  'client-services',
  'goto-service'
]) {
  assert(!html.includes(marker), `页面仍包含客户交付台标记: ${marker}`);
  assert(!app.includes(marker), `前端脚本仍包含客户交付台标记: ${marker}`);
}

assert(html.includes('data-view="projects"'), '客户项目入口必须保留');
assert(app.includes("if (action === 'projects') return switchView('projects');"), '客户项目快捷入口必须保留');

// 生产 Web 发布包会排除小程序目录，本地完整项目中才执行小程序页面断言。
if (fs.existsSync(miniHomePath)) {
  const miniHome = fs.readFileSync(miniHomePath, 'utf8');
  assert(!miniHome.includes('待交付工单'), '小程序首页不应继续展示待交付工单');
  assert(!miniHome.includes('处理中工单'), '小程序首页不应继续展示处理中工单');
  assert(miniHome.includes('驻厂快速办理'), '小程序首页应保留不含工单的驻厂快速办理入口');
}

console.log('client-delivery-removed-tests-ok');
