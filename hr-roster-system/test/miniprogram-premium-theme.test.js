const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const appStyle = read('wechat-miniprogram/miniprogram/app.wxss');
const homeStyle = read('wechat-miniprogram/miniprogram/pages/home/index.wxss');
const homePage = read('wechat-miniprogram/miniprogram/pages/home/index.wxml');
const rosterStyle = read('wechat-miniprogram/miniprogram/pages/employees/index.wxss');
const detailStyle = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.wxss');
const resignStyle = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.wxss');

for (const token of ['--electric-blue', '--aqua-glow', '--warm-gold', '--glass-line']) {
  if (!appStyle.includes(token)) throw new Error(`小程序高级主题缺少颜色令牌：${token}`);
}
for (const marker of ['tech-scan', 'ambient-orbit', 'linear-gradient', 'radial-gradient']) {
  if (!(appStyle + homeStyle).includes(marker)) throw new Error(`小程序高级主题缺少视觉标记：${marker}`);
}
if (!homeStyle.includes('.onsite-lifecycle-grid button:nth-child(4)')) throw new Error('首页生命周期入口未按业务状态区分颜色');
if (!rosterStyle.includes('.employee-card:nth-child(3n + 2) .avatar')) throw new Error('花名册员工卡缺少可识别的渐变变化');
if (!detailStyle.includes('.detail-card:nth-of-type')) throw new Error('员工详情卡片缺少分层色彩');
if (!resignStyle.includes('.check-row.checked')) throw new Error('离职交接确认项缺少明确完成状态');
if (homePage.includes('交接、减保和结算')) throw new Error('首页仍显示已取消的离职工资结算流程');

console.log('miniprogram-premium-theme-tests-ok');
