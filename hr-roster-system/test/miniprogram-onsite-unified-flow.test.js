const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const onsiteWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const onsiteWxss = read('wechat-miniprogram/miniprogram/pages/employees/index.wxss');
const onsiteJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const homeJs = read('wechat-miniprogram/miniprogram/pages/home/index.js');
const tasksJs = read('wechat-miniprogram/miniprogram/pages/tasks/index.js');
const resignJs = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.js');
const resignWxml = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.wxml');
const service = read('src/services/employee.service.js');
const tabWxml = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxml');
const tabWxss = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.wxss');
const tabJs = read('wechat-miniprogram/miniprogram/custom-tab-bar/index.js');
const allMiniWxml = fs.readdirSync(path.join(root, 'wechat-miniprogram/miniprogram/pages'), { recursive: true })
  .filter(file => String(file).endsWith('.wxml'))
  .map(file => read(`wechat-miniprogram/miniprogram/pages/${file}`))
  .join('\n');

for (const stage of ['', 'interview', 'pending', 'active', 'left']) {
  const marker = stage ? `data-stage="${stage}"` : 'data-stage=""';
  if (!onsiteWxml.includes(marker)) throw new Error(`蓝色驻厂面板缺少人员状态入口：${stage || '全部'}`);
}
if ((onsiteWxml.match(/bindtap="filterByStage"/g) || []).length !== 5) throw new Error('蓝色驻厂面板应只保留五个可点击状态');
if (/data-stage="(?:unjoined|offboarding)"/.test(onsiteWxml)) throw new Error('蓝色驻厂面板仍展示已取消的未入职或离职办理状态');
if (onsiteWxml.includes('vertical-stage-grid')) throw new Error('人员状态仍在蓝色面板外重复展示');
if (!onsiteWxml.includes('site-customer-switch')) throw new Error('客户切换未合并进驻厂人员管理面板');
if (!onsiteWxss.includes('.site-status-grid')) throw new Error('驻厂人员管理缺少一体化状态网格布局');
if (!onsiteJs.includes('filterByStage(event)')) throw new Error('驻厂状态筛选逻辑缺失');

if (!tabJs.includes("text: '驻厂'")) throw new Error('底部菜单应使用简洁的驻厂名称');
if (tabWxml.includes('hover-class="tab-pressed"')) throw new Error('底部菜单仍显示点击变色/按压态');
if (/\.tab-item:active|\.tab-pressed/.test(tabWxss)) throw new Error('底部菜单仍保留点击变色样式');
if (/<button(?![^>]*hover-class="none")/s.test(allMiniWxml)) throw new Error('小程序仍有按钮显示默认点击变色');

if (!resignWxml.includes('<checkbox-group bindchange="onHandoverChange">')) throw new Error('离职交接清单未使用可勾选控件');
if (!resignWxml.includes('已减保')) throw new Error('办理离职中缺少“已减保”选项');
if (/请确认完成全部交接项|every\(Boolean\)/.test(resignJs)) throw new Error('小程序离职仍强制全选交接清单');
if (/请确认完成全部离职交接清单|handoverFields\.every/.test(service)) throw new Error('后端离职仍强制全选交接清单');
if (!service.includes("badgeReturned: Number(body.badgeReturned) === 1 ? 1 : 0")) throw new Error('后端未保存实际勾选的交接项');

if (!homeJs.includes("task.taskType === 'INSURANCE_TERMINATION' && this.data.canResignEmployee")) throw new Error('工作台减保待办未合并到办理离职');
if (!tasksJs.includes("item.taskType === 'INSURANCE_TERMINATION' && this.data.canResign")) throw new Error('待办中心减保事项未进入办理离职');

console.log('miniprogram-onsite-unified-flow-tests-ok');
