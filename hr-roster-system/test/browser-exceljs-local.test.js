const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('public/index.html');
const app = read('public/app.js');
const expressApp = read('src/app.js');
const prototypeServer = read('server.js');
const excelJsBundle = require.resolve('exceljs/dist/exceljs.min.js');

assert.ok(fs.statSync(excelJsBundle).size > 100000, '本地 ExcelJS 浏览器包不存在或内容异常');
assert.match(html, /src="\/vendor\/exceljs\.min\.js"[^>]*defer/, '页面未加载本地 ExcelJS');
assert.doesNotMatch(html, /xlsx\/0\.18\.5\/xlsx\.full\.min\.js/, '页面仍依赖外部 SheetJS CDN');
assert.ok(
  html.indexOf('/vendor/exceljs.min.js') < html.indexOf('/app.js'),
  'ExcelJS 必须在 app.js 之前加载'
);

assert.doesNotMatch(app, /\bXLSX\b/, '浏览器业务代码仍使用 SheetJS 全局对象');
assert.match(app, /new ExcelJS\.Workbook\(\)/, '浏览器业务代码未创建 ExcelJS 工作簿');
assert.match(app, /workbook\.xlsx\.writeBuffer\(\)/, 'XLSX 模板未通过 ExcelJS 写入');
assert.match(app, /workbook\.xlsx\.load\(buffer\)/, 'XLSX 文件未通过 ExcelJS 读取');
assert.match(app, /workbook\.worksheets/, '工资导入未遍历 ExcelJS 工作表');
assert.match(app, /function triggerBlobDownload\(/, '模板下载缺少统一的 Blob 下载函数');
assert.match(app, /document\.body\.appendChild\(link\)/, '下载链接未挂载到页面，部分浏览器不会触发下载');
assert.match(app, /link\.remove\(\)/, '模板下载完成后未清理临时链接');
assert.match(app, /setTimeout\([\s\S]{0,160}URL\.revokeObjectURL\(url\)/,
  '模板下载过早释放 Blob 地址，可能导致浏览器取消下载');
assert.match(app, /value\.formula[\s\S]{0,100}`=\$\{value\.formula\}`/,
  'ExcelJS 公式单元格未转换为公式文本供工资解析器拒绝');

for (const source of [expressApp, prototypeServer]) {
  assert.match(source, /\/vendor\/exceljs\.min\.js/, '服务器缺少本地 ExcelJS 固定路由');
  assert.match(source, /require\.resolve\(['"]exceljs\/dist\/exceljs\.min\.js['"]\)/,
    '服务器未使用依赖包的固定 ExcelJS 文件路径');
}

console.log('browser-exceljs-local-tests-ok');
