const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const employeeJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const employeeWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const employeeWxss = read('wechat-miniprogram/miniprogram/pages/employees/index.wxss');
const addWxml = read('wechat-miniprogram/miniprogram/pages/employees/add/index.wxml');
const allWxml = fs.readdirSync(path.join(root, 'wechat-miniprogram/miniprogram/pages'), { recursive: true })
  .filter(file => String(file).endsWith('.wxml'))
  .map(file => read(`wechat-miniprogram/miniprogram/pages/${file}`))
  .join('\n');

for (const marker of ['customerOptions', 'customerNames', 'customerIndex', 'onCustomerChange', "wx.setStorageSync('onsite_customer_id'"]) {
  if (!employeeJs.includes(marker)) throw new Error(`驻厂客户工作区缺少逻辑：${marker}`);
}
if (!employeeJs.includes('preferredCustomerId')) throw new Error('驻厂页未恢复上次选择的客户');
if (!employeeJs.includes('customers[0].id')) throw new Error('驻厂页未默认进入首个授权客户');
if (!employeeWxml.includes('mode="selector"') || !employeeWxml.includes('range="{{customerNames}}"')) throw new Error('驻厂页缺少客户下拉切换器');
if (!employeeWxml.includes('site-status-grid')) throw new Error('驻厂人员状态未合并到蓝色管理面板');
if (employeeWxml.includes('customer-tabs') || employeeWxml.includes('channel-tabs')) throw new Error('驻厂页仍保留横向客户或渠道滑动条');
if (!employeeWxss.includes('.site-status-grid') || !employeeWxss.includes('grid-template-columns:repeat(2,1fr)')) throw new Error('驻厂状态筛选未使用两列竖屏布局');
if (allWxml.includes('<scroll-view scroll-x')) throw new Error('小程序仍存在需要左右拖动的横向页面区域');
if (!addWxml.includes('<view class="channel-suggestions"')) throw new Error('新增员工招聘渠道建议未改为竖屏自动换行');

console.log('miniprogram-onsite-customer-workspace-tests-ok');
