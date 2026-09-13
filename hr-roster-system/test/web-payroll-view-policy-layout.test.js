const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function run() {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

  assert.match(html, /class="payroll-view-policy-bar"/, '工资条详情缺少查看策略容器');
  assert.match(css, /\.payroll-view-policy-bar\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,/s,
    '查看策略未使用三列紧凑网格布局'
  );
  assert.match(css, /\.payroll-view-policy-bar\s+label\s+span\s*\{[^}]*display:\s*block/s,
    '查看策略字段标签未固定为紧凑块级布局'
  );
  assert.match(css, /\.payroll-view-policy-bar\s+select\s*\{[^}]*min-height:\s*40px/s,
    '查看策略下拉框缺少紧凑高度'
  );
  assert.match(css, /\.payroll-view-policy-bar\s+small\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    '查看策略说明未占满网格并避免挤压控件'
  );
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.payroll-view-policy-bar\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
    '查看策略在手机端未切换为两列自适应布局'
  );

  console.log('web-payroll-view-policy-layout-tests-ok');
}

if (require.main === module) run();

module.exports = { run };
