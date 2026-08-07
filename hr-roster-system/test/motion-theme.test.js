const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('public/index.html');
const loader = read('public/motion-loader.js');
const css = read('public/theme-motion.css');
const app = read('public/app.js');
const utils = read('public/js/core/utils.js');

assert(index.includes('<script src="/motion-loader.js"></script>'), '首页未加载 CSP 兼容的动效开关脚本');
assert(!index.includes("document.documentElement.classList.add('motion-enabled')"), '首页不应使用会被 CSP 拦截的内联动效脚本');
assert(loader.includes("params.get('motion') !== '1'"), '动效必须仅由 ?motion=1 启用');
assert(loader.includes("stylesheet.href = '/theme-motion.css'"), '动效开关未加载独立主题文件');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), '动效主题缺少减少动态效果降级');
assert(css.includes('.data-table tbody tr:nth-child(25)'), '表格行动画未覆盖到第 25 行');
assert(css.includes('#employmentDonut'), '动效主题缺少环形图动画');
assert(css.includes('.modal[open] .modal-panel'), '动效主题缺少弹窗动画');
assert(utils.includes('function animateCounter('), '缺少 KPI 数字滚动函数');
assert(utils.includes("classList.contains('motion-enabled')"), '数字滚动没有受动效开关控制');
assert(utils.includes("matchMedia('(prefers-reduced-motion: reduce)')"), '数字滚动没有遵守减少动态效果偏好');

console.log('motion-theme-tests-ok');
