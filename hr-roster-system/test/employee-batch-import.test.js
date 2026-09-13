const assert = require('assert');
const fs = require('fs');
const path = require('path');
const batch = require('../public/js/core/employee-batch');
const employeeService = fs.readFileSync(path.join(__dirname, '..', 'src/services/employee.service.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');

assert.strictEqual(batch.fields.length, 20, '员工批量字段应保持20列');
assert.strictEqual(batch.headers.length, batch.example.length, '下载模板表头和示例行必须一一对应');
assert.strictEqual(batch.example[4], '江苏省常州市新北区示例路1号', '模板示例必须包含地址，避免后续字段左移');
assert.strictEqual(batch.example[19], '待到岗', '批量模板状态示例必须与新增员工页面统一为待到岗');

const reordered = [
  '手机号码,姓名,招聘来源,身份证号,客户单位,地址',
  '13800138000,张三,现场招聘,320101199001011234,示例制造公司,常州市新北区'
].join('\n');
const [employee] = batch.parseEmployeeBatchTable(reordered);
assert.deepStrictEqual(employee, {
  name: '张三',
  phone: '13800138000',
  channelSource: '现场招聘',
  idCardNo: '320101199001011234',
  customerName: '示例制造公司',
  address: '常州市新北区'
}, '上传表格应按中文表头和历史别名映射，不能依赖固定列序');

const inspection = batch.inspectEmployeeHeaders(['手机号码', '姓名', '招聘来源', '自定义说明']);
assert.deepStrictEqual(
  inspection.columns,
  [
    { actual: '手机号码', canonical: '电话', key: 'phone' },
    { actual: '姓名', canonical: '姓名', key: 'name' },
    { actual: '招聘来源', canonical: '招聘渠道', key: 'channelSource' },
    { actual: '自定义说明', canonical: '', key: '' }
  ],
  '上传预览应显示历史表头实际对应的标准字段'
);
assert.deepStrictEqual(inspection.missingRequired, [], '已识别姓名时不应误报缺少必填表头');

const pasted = batch.parseEmployeeBatchTable(batch.example.join('\t'))[0];
assert.strictEqual(pasted.address, batch.example[4], '无表头粘贴应按标准字段顺序读取地址');
assert.strictEqual(pasted.phone, batch.example[5], '无表头粘贴不应再把地址错当手机号');
assert.strictEqual(pasted.channelSource, batch.example[13], '招聘渠道应映射到 channelSource');

assert.throws(
  () => batch.parseEmployeeBatchTable('手机号,招聘渠道\n13800138000,员工介绍'),
  /缺少必需表头.*姓名/,
  '有表头的文件缺少姓名时应给出明确提示'
);

assert.match(employeeService, /const employeeStatusMap = \{[^}]*待到岗:\s*1/, '批量录入必须接受页面统一的待到岗状态');
assert.match(employeeService, /请填写待到岗\/直接入职\/在职\/未入职\/面试/, '批量录入错误提示必须列出历史在职补录状态');
assert.match(employeeService, /直接入职:\s*1/, '批量直接入职必须先进入待到岗，不能直接写入在职');
assert.match(employeeService, /在职:\s*2/, '批量历史在职员工必须支持直接补录为在职');
assert.match(employeeService, /INSERT INTO hr_position/, '批量导入缺失岗位时应自动补建岗位档案');
assert.match(employeeService, /positionMap\.set\(positionName,\s*positionId\)/, '自动补建岗位后必须回写岗位映射');
assert.match(html, /历史员工填写“在职”可直接补录为在职/, '批量弹窗必须说明历史在职员工的补录规则');
assert.match(html, /面试员工只需姓名，其余信息可后续补齐/, '批量弹窗不得把非必填手机号标为必填');

// 批量导入失败必须返回逐行原因与人员，前端必须展示逐行错误。
assert.match(employeeService, /errors\.push\(\{\s*row:\s*index\s*\+\s*1,\s*name:\s*row\.name\s*\|\|\s*'',\s*message:\s*error\.message\s*\}\)/, '批量导入失败必须逐行记录行号、姓名和原因');
assert.match(employeeService, /failureCount:\s*errors\.length/, '失败人数必须与逐行错误数量一致');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
assert.match(appSource, /第\$\{item\.row\}行[\s\S]*?escapeHtml\(item\.message\)/, '前端必须展示批量导入的逐行失败行号和原因');
assert.match(appSource, /batch-error-block/, '前端批量导入必须有错误提示块');

console.log('employee-batch-import-tests-ok');
