const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('public/app.js');
const html = read('public/index.html');
const router = read('public/js/core/router.js');
const roster = read('public/js/views/roster.js');
const css = read('public/layout-refine.css');

assert.ok(app.includes("let notices = Array.isArray(data.notices) ? data.notices : []"), '办公中心未兼容内嵌公告数据');
assert.ok(app.includes("if (!/接口不存在|404/.test"), '独立公告接口缺失仍会中断办公中心');
assert.ok(app.includes('const delivery = data.delivery || {}'), '办公中心未兼容旧版项目交付字段');
assert.ok(app.includes('const compliance = data.compliance || {}'), '办公中心未兼容旧版合规字段');
assert.ok(app.includes('data.todos.filter(item => Number(item.count || 0) > 0)'), '办公中心仍展示数量为零的伪待办');
assert.ok(app.includes('const customers = state.bootstrap.customers || []'), '基础数据缺少客户字段时仍会中断页面');
assert.ok(app.includes("if (left.positionName === '普工') return -1"), '新增员工岗位未保证普工第一位');
assert.ok(app.includes("state.token = data.token || ''"), '登录返回的 Token 未保存在页面内存，原型环境会立即 401');
assert.ok(!app.includes("localStorage.setItem('hrRosterToken'"), 'Token 不得写入 localStorage');
assert.match(html, /id="scanRiskButton"[^>]*data-topbar-views="risk"/, '扫描风险按钮未限定风险页面');
assert.match(html, /id="batchEmployeeButton"[^>]*data-topbar-views="roster"/, '批量录入按钮未限定花名册页面');
assert.ok(app.includes('function applyTopbarActionVisibility'), '缺少顶部页面动作显隐逻辑');
assert.ok(router.includes('applyTopbarActionVisibility(view)'), '切换页面后未刷新顶部动作');
assert.ok(roster.includes("classList.toggle('detail-collapsed', !state.selectedEmployeeId)"), '花名册未按员工选择状态收起详情栏');
assert.match(css, /\.content-grid\.detail-collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s, '详情收起后主表未铺满');
assert.match(css, /\.content-grid\.detail-collapsed\s*>\s*\.detail-panel\s*\{[^}]*display:\s*none/s, '未选员工时详情栏仍占空间');

console.log('web-office-resilience-tests-ok');
