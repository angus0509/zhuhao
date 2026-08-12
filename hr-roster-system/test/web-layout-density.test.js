const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const css = read('public/layout-refine.css');

assert.match(css, /\.content-grid\s*\{[^}]*320px[^}]*gap:\s*12px/s, '花名册工作区未扩大主表或压缩详情栏');
assert.match(css, /\.detail-panel\s*\{[^}]*min-height:\s*470px/s, '员工详情空态仍占用过大高度');
assert.match(css, /\.metric-cell\s*\{[^}]*min-height:\s*74px/s, '顶部指标卡仍过高');
assert.match(css, /\.office-view\s*\{[^}]*align-items:\s*start\s*!important/s, '办公中心两栏仍可能互相拉伸高度');
assert.match(css, /\.office-main\s*\{[^}]*align-content:\s*start[^}]*grid-auto-rows:\s*max-content/s, '办公中心主列未按实际内容高度紧凑排列');
assert.match(css, /\.office-welcome\s*\{[^}]*min-height:\s*104px\s*!important/s, '办公中心欢迎区仍过高');
assert.match(css, /\.office-statline article\s*\{[^}]*min-height:\s*60px\s*!important/s, '办公中心统计条仍过高');
assert.match(css, /\.office-action\s*\{[^}]*min-height:\s*78px\s*!important/s, '办公中心功能卡仍过高');
assert.match(css, /\.pulse-stats-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s, '运营脉搏明细仍纵向堆叠占用过多高度');
assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1180px\)[\s\S]*\.office-welcome\s*\{[^}]*min-height:\s*110px\s*!important/s, '中等宽度欢迎区仍会回退为高卡片');
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.office-welcome\s*\{[^}]*min-height:\s*112px\s*!important[^}]*grid-template-columns:/s, '手机 Web 欢迎区仍有过多装饰留白');
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.office-action\s*\{[^}]*min-height:\s*82px\s*!important/s, '手机 Web 功能卡仍过高');
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.office-statline\s*\{[^}]*repeat\(3,/s, '手机 Web 统计区仍使用三行布局');
assert.ok(html.includes('class="modal employee-batch-modal" id="batchEmployeeModal"'), '批量员工上传未启用专属紧凑布局');
assert.ok(html.includes('class="employee-batch-workspace"'), '批量员工上传缺少双栏工作区');
assert.ok(html.includes('class="employee-batch-upload"'), '批量员工上传缺少文件区');
assert.ok(html.includes('class="employee-batch-paste"'), '批量员工上传缺少核对区');
assert.match(css, /\.employee-batch-workspace\s*\{[^}]*grid-template-columns:/s, '批量员工上传桌面端未使用双栏布局');
assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.employee-batch-workspace\s*\{[^}]*grid-template-columns:\s*1fr/s, '批量员工上传未适配窄屏');

console.log('web-layout-density-tests-ok');
