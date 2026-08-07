const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('public/index.html');
const css = read('public/ui-polish.css');
const interaction = read('public/interaction-polish.js');
const router = read('public/js/core/router.js');
const app = read('public/app.js');
const miniCssPath = path.join(root, 'wechat-miniprogram/miniprogram/app.wxss');

assert.ok(index.includes('<link rel="stylesheet" href="/ui-polish.css" />'), '首页未加载 UI 细节样式');
assert.ok(index.includes('<script src="/interaction-polish.js" defer></script>'), '首页未加载交互增强脚本');
assert.ok(index.includes('id="currentViewTitle"'), '顶部栏缺少动态页面标题');
assert.ok(index.includes('class="system-status"'), '顶部栏缺少系统在线状态');
assert.ok(index.includes('id="officeGreeting"'), '办公中心缺少动态问候挂载点');
assert.ok(!index.includes('下午好，企业管理员'), '办公中心仍硬编码企业管理员问候');
assert.ok(router.includes("new CustomEvent('app:viewchange'"), '页面切换未发送视图变化事件');
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'UI 动效缺少减少动态效果降级');
assert.ok(css.includes('.ui-view-enter'), 'UI 样式缺少页面进入动画');
assert.ok(css.includes('.ui-press::after'), 'UI 样式缺少按钮点击反馈');
assert.ok(interaction.includes('IntersectionObserver'), '交互脚本缺少可视区域渐入');
assert.ok(interaction.includes('MutationObserver'), '交互脚本未处理动态渲染内容');
assert.ok(interaction.includes("office: ['办公中心', '劳务运营总览']"), '交互脚本缺少视图标题映射');
assert.ok(app.includes("timeZone: 'Asia/Shanghai'"), '动态问候未按北京时间计算');
assert.ok(app.includes("state.user?.realName || state.user?.username || '同事'"), '动态问候未使用当前账号名称');
// Web/API 发布包按设计排除小程序源码；在完整源码仓库中继续校验小程序视觉契约。
if (fs.existsSync(miniCssPath)) {
  const miniCss = fs.readFileSync(miniCssPath, 'utf8');
  assert.ok(miniCss.includes('mini-page-enter'), '小程序缺少页面进入动效');
  assert.ok(miniCss.includes(':active'), '小程序缺少触控按压反馈');
}
assert.ok(!index.match(/<script(?![^>]*src=)[^>]*>/), '首页不应增加会被 CSP 拦截的内联脚本');

console.log('ui-polish-tests-ok');
