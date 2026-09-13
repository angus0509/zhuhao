const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('public/index.html');
const app = read('public/app.js');
const state = read('public/js/core/state.js');
const style = read('public/styles.css');

assert.match(html, /src="\/js\/core\/payroll-import\.js"[^>]*defer/, '工资智能解析模块未加载');
assert.ok(
  html.indexOf('/js/core/payroll-import.js') < html.indexOf('/app.js'),
  '工资智能解析模块必须在 app.js 之前加载'
);
assert.match(html, /id="payrollFileZone"/, '工资批次弹窗缺少拖拽上传区');
assert.match(html, /id="payrollFileInput"[^>]*accept="\.csv,\.xlsx"/, '工资导入文件格式不完整');
assert.match(html, /不要求固定模板/, '页面必须明确说明不限制模板');
assert.match(html, /自动识别表头/, '页面缺少智能表头识别说明');
assert.match(html, /任意列顺序/, '页面缺少任意列顺序说明');
assert.match(html, /未识别列将原名保留/, '页面缺少未识别列保留说明');
assert.doesNotMatch(html, /额外列自动忽略/, '页面不得继续声称额外列会被忽略');
assert.match(html, /id="payrollImportSummary"/, '缺少工资导入预览汇总');
assert.match(html, /id="payrollImportPreviewBody"/, '缺少工资导入行级预览表');
assert.match(html, /id="payrollPreviewButton"/, '缺少预校验按钮');
assert.match(html, /id="payrollConfirmButton"[^>]*disabled/, '确认创建按钮默认必须禁用');
assert.match(html, /下载 XLSX 示例/, '缺少 XLSX 示例下载入口');
assert.match(html, /下载 CSV 示例/, '缺少 CSV 示例下载入口');

assert.match(state, /payrollImport:\s*\{[\s\S]*parsedRows:\s*\[\]/, '缺少工资导入状态');
assert.match(app, /async function readPayrollFile\(file\)/, '缺少工资文件读取函数');
assert.match(app, /TextDecoder\(['"]gbk['"]/, 'CSV 读取未提供 GBK 编码兼容');
assert.match(app, /UTF-8[\s\S]{0,240}gbk/i, 'CSV 读取未在 UTF-8 乱码时回退 GBK');
assert.match(app, /workbook\.worksheets/, 'Excel 导入必须遍历工作簿工作表');
assert.match(app, /value\.formula[\s\S]{0,120}`=\$\{value\.formula\}`/,
  'Excel 公式单元格必须转换为公式标记并交给解析器拒绝');
assert.match(app, /PayrollImport\.parseFlexiblePayrollRows/, '未调用智能工资表解析器');
assert.match(app, /async function previewPayrollImport/, '缺少工资预校验流程');
assert.match(app, /\/api\/payroll\/batches\/preview/, '工资导入未调用后台预校验接口');
assert.match(app, /function renderPayrollImportPreview/, '缺少行级错误预览渲染');
assert.match(app, /item\.itemSnapshot[\s\S]{0,500}payroll-item-row/, '导入预览未展示原表动态工资项目');
assert.match(html, /原表全部信息/, '导入预览缺少原表全部信息列');
assert.match(app, /payroll-manual-entry[\s\S]{0,180}\.open\s*=\s*false/,
  '预览完成后应自动收起手工粘贴区，避免预览表被挤出屏幕');
assert.match(app, /async function confirmPayrollBatchImport/, '缺少确认创建流程');
assert.match(app, /confirmButton\.disabled\s*=\s*preview\.errorRows\s*>\s*0/, '只有阻断错误行才能禁止创建批次');
assert.match(app, /工资数据存在异常提示[\s\S]*仍然创建工资条/, '金额异常创建前缺少二次确认');
assert.doesNotMatch(app, /escapeHtml\(item\.idCardNo\)/, '预览页面不得显示完整身份证号');

assert.match(style, /\.payroll-import-guide/, '缺少工资智能导入说明样式');
assert.match(style, /\.payroll-import-preview/, '缺少工资导入预览样式');
assert.match(style, /\.payroll-import-summary \.warning/, '金额异常提示缺少醒目的黄色汇总样式');
assert.match(style, /#payrollBatchModal\s*\{[^}]*width:\s*min\(1040px/s,
  '工资弹窗外框宽度未与导入面板统一');
assert.match(style, /\.payroll-import-panel\s*\{[^}]*width:\s*100%/s,
  '工资导入面板仍可能溢出弹窗外框');
assert.match(style, /\.payroll-import-panel[\s\S]*?\.sticky-actions[\s\S]*?flex-wrap:\s*wrap/,
  '工资导入底部按钮区未适配窄屏换行');

console.log('web-payroll-flexible-import-tests-ok');
