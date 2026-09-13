const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const app = read('public/app.js');
const nav = read('public/js/core/navigation-groups.js');
const router = read('public/js/core/router.js');
const mini = read('wechat-miniprogram/miniprogram/pages/employees/add/index.wxml');
const miniTask = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
if (nav.includes("view: 'risk', label: '用工风险'")) throw new Error('网页导航仍显示用工风险入口');
if (/risk:\s*\(\)|risk:\s*'#riskView'/.test(router)) throw new Error('网页路由仍允许打开风险页面');
for (const label of ['劳动合同签订', '雇主险增保', '入职合规']) {
  if (html.includes(label)) throw new Error(`网页仍显示${label}`);
  if (mini.includes(label)) throw new Error(`小程序新增员工仍显示${label}`);
  if (miniTask.includes(label)) throw new Error(`小程序待办仍显示${label}`);
}
if (app.includes("'入职合规待办'")) throw new Error('网页办公中心仍显示入职合规待办');
if (!miniTask.includes("pageTitle: '驻厂待办'")) throw new Error('小程序待办未恢复为驻厂待办');
console.log('onboarding-compliance-entry-removal-tests-ok');
