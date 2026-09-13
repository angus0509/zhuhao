const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const packageJson = JSON.parse(read('package.json'));
const cssPath = path.join(root, 'public/design-system-unified.css');

assert.equal(fs.existsSync(cssPath), true, '缺少网页端最终统一设计系统样式');
const css = fs.readFileSync(cssPath, 'utf8');
const unifiedLink = '<link rel="stylesheet" href="/design-system-unified.css" />';
assert.ok(html.includes(unifiedLink), '首页未加载统一设计系统样式');
assert.ok(html.indexOf(unifiedLink) > html.indexOf('/layout-refine.css'), '统一设计系统必须最后加载以消除旧样式冲突');

for (const token of [
  '--ui-font-body:', '--ui-font-display:', '--ui-font-number:',
  '--ui-text-xs:', '--ui-text-sm:', '--ui-text-md:', '--ui-text-lg:', '--ui-title-page:',
  '--ui-control-height:', '--ui-radius-control:', '--ui-radius-panel:'
]) {
  assert.ok(css.includes(token), `统一设计系统缺少令牌：${token}`);
}

for (const selector of [
  'html, body, button, input, select, textarea',
  '.topbar h1,',
  '.primary-button,',
  'input, select, textarea',
  '.data-table th',
  '.data-table td',
  '.modal-panel',
  '.panel-head h2,',
  '.badge',
  '.pulse-mark,',
  '.pulse-card > strong,',
  '.pulse-card b,',
  '.pulse-hero strong,',
  '.pulse-row b {',
  '@media (max-width: 760px)'
]) {
  assert.ok(css.includes(selector), `统一设计系统缺少全局组件规则：${selector}`);
}

assert.doesNotMatch(css, /\bInter\b|Noto Serif|Georgia|Times New Roman/, '最终统一样式仍混用旧英文字体或衬线字体');
assert.ok(packageJson.scripts.postcheck.includes('web-visual-system-unified.test.js'), '统一设计系统验收未接入固定检查命令');
console.log('web-visual-system-unified-tests-ok');
