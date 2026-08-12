const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const html = read('public/index.html');
const webApp = read('public/app.js');
const service = read('src/services/employee.service.js');
const ocrService = read('src/services/ocr.service.js');
const dictionaries = read('src/utils/dictionaries.js');
const schema = read('sql/schema.mysql.sql');
const migration = read('sql/migrate-employee-address-interview-20260811.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const verify = read('scripts/verify-release-package.sh');
const miniAddJs = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
const miniAddWxml = read('wechat-miniprogram/miniprogram/pages/employees/add/index.wxml');
const miniListJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const miniOnboardJs = read('wechat-miniprogram/miniprogram/pages/employees/onboard/index.js');

for (const source of [html, miniAddWxml]) {
  const idIndex = source.indexOf('身份证号');
  const addressIndex = source.indexOf('地址', idIndex);
  if (idIndex < 0 || addressIndex <= idIndex) throw new Error('地址字段未放在身份证号之后');
}

assertIncludes(html, '<option value="6" selected>面试（先简单登记）</option>', 'Web 未将面试设为默认录入状态');
assertIncludes(webApp, "for (const name of ['idCardNo', 'address', 'phone'", 'Web 未将地址按敏感资料处理');
assertIncludes(webApp, "if (result.address) $('#mEmpAddress').value = result.address;", '手机 Web 身份证OCR未回填地址');
assertIncludes(html, 'id="mEmpAddress"', '手机 Web 地址输入框缺少OCR回填定位');
if ((html.match(/id="mEmpAddress"/g) || []).length !== 1) throw new Error('手机 Web OCR地址输入框ID不唯一');
assertIncludes(ocrService, 'address: result.Address ||', '腾讯云OCR返回的身份证地址未转换为 address');
assertIncludes(webApp, 'const interview = employeeStatus === 6;', 'Web 未按面试状态切换校验');
if (/name="(employmentType|feeMode|channelSource)"[^>]*required/.test(html)) throw new Error('Web 用工计费或招聘来源仍为必填');

assertIncludes(dictionaries, "6: '面试'", '后端字典缺少面试状态');
assertIncludes(service, "employeeStatus === 6 ? 'INTERVIEW'", '面试档案生命周期未设为 INTERVIEW');
assertIncludes(service, "sourceType: 'INTERVIEW'", '面试员工未同步人才库');
assertIncludes(service, "throw createError(`请先编辑并补齐入职资料", '确认入职前未校验资料完整性');
assertIncludes(service, 'address: encrypt(body.address)', '地址未加密写入');

assertIncludes(miniAddJs, 'const EMPLOYEE_STATUS_VALUES = [6, 1, 2, 5];', '小程序未将面试放在第一位');
assertIncludes(miniAddJs, 'const isInterview = employeeStatus === 6;', '小程序未支持面试简登');
assertIncludes(miniAddJs, 'address: f.address.trim() || null', '小程序未提交地址');
assertIncludes(miniAddJs, "'form.address': result.address", '小程序身份证OCR未回填地址');
if (/住宅/.test(html + miniAddWxml)) throw new Error('员工地址字段仍显示为“住宅”');
assertIncludes(miniListJs, "stage === 'interview'", '小程序员工列表缺少面试筛选');
assertIncludes(miniOnboardJs, 'missingFieldsText', '小程序入职前未提示缺失资料');

assertIncludes(schema, 'address VARCHAR(512)', '数据库缺少地址字段');
assertIncludes(migration, "COLUMN_NAME='address'", '地址迁移缺少幂等检查');
assertIncludes(deploy, 'migrate-employee-address-interview-20260811.mysql.sql', '生产部署未执行新迁移');
assertIncludes(verify, 'M16="sql/migrate-employee-address-interview-20260811.mysql.sql"', '发布包未验证新迁移');

console.log('员工地址、面试简登与入职补齐流程检查通过。');
