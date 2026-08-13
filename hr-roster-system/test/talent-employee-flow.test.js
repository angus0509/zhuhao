const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assertIncludes = (source, expected, message) => {
  if (!source.includes(expected)) throw new Error(message);
};

const schema = read('sql/schema.mysql.sql');
const migration = read('sql/migrate-talent-employee-flow-20260810.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const employeeService = read('src/services/employee.service.js');
const portalService = read('src/services/portal.service.js');
const html = read('public/index.html');
const webApp = read('public/app.js');
const miniAdd = read('wechat-miniprogram/miniprogram/pages/employees/add/index.js');
const miniList = read('wechat-miniprogram/miniprogram/pages/employees/index.js');

for (const field of [
  'employee_id', 'customer_id', 'project_id', 'position_id', 'recruitment_channel_id',
  'talent_source_type', 'employee_status_snapshot', 'available_status', 'resigned_at',
  'resignation_reason', 'flowed_at'
]) {
  assertIncludes(schema, field, `人才库表缺少关联字段：${field}`);
  assertIncludes(migration, `COLUMN_NAME='${field}'`, `人才库迁移缺少幂等字段检查：${field}`);
}

assertIncludes(schema, '5未入职', '员工状态字典缺少未入职');
assertIncludes(schema, 'UNIQUE KEY uk_company_employee (company_id, employee_id)', '人才库缺少员工幂等唯一键');
assertIncludes(migration, 'WHERE e.employee_status=3', '迁移未回填历史离职员工');
assertIncludes(deploy, 'migrate-talent-employee-flow-20260810.mysql.sql', '生产部署未执行人才库流转迁移');

assertIncludes(employeeService, 'async function syncEmployeeToTalent', '后端缺少统一人才库同步函数');
assertIncludes(employeeService, 'async function linkExistingTalentToEmployee', '新增员工未关联已有手工人才');
assertIncludes(employeeService, 'id_card_hash=:idCardHash) OR phone=:phone', '人才与员工未按身份证摘要或手机号匹配');
assertIncludes(employeeService, "sourceType: 'UNJOINED'", '未入职员工未自动流转人才库');
assertIncludes(employeeService, "sourceType: 'RESIGNED'", '离职完成未自动流转人才库');
assertIncludes(employeeService, "sourceType: 'REHIRED'", '重新录用未更新人才状态');
assertIncludes(employeeService, 'ON DUPLICATE KEY UPDATE', '人才库同步不是幂等写入');
assertIncludes(employeeService, "'talent_employee_flow'", '人才流转未记录操作日志');

assertIncludes(portalService, 'talentSourceTypeName', '人才库接口缺少人才来源');
assertIncludes(portalService, 'customerName: row.customer_name', '人才库接口缺少客户单位');
assertIncludes(portalService, 'projectName: row.project_name', '人才库接口缺少项目');
assertIncludes(portalService, 'employeeStatusName:', '人才库接口缺少员工状态');
assertIncludes(portalService, 'employeeScope(user, params', '人才库关联员工未应用员工数据权限');

assertIncludes(html, '<option value="5">未入职（自动进入人才库）</option>', 'Web 新增员工缺少未入职选项');
assertIncludes(webApp, 'item.talentSourceTypeName', 'Web 人才库未展示流转来源');
assertIncludes(webApp, 'item.customerName', 'Web 人才库未展示客户单位');
assertIncludes(webApp, "'employeeStatus'", 'Web 批量录入未支持未入职状态列');
assertIncludes(employeeService, 'const employeeStatusMap = { 待入职: 1, 直接入职: 2, 在职: 2, 未入职: 5, 面试: 6 };', '后端批量录入未映射面试状态');
assertIncludes(miniAdd, 'const EMPLOYEE_STATUS_VALUES = [6, 1, 2, 5];', '小程序未将面试设为默认状态');
assertIncludes(miniList, "isUnjoined", '小程序驻厂页面未识别未入职回流状态');
assertIncludes(miniList, "'未入职·已入人才库'", '小程序未入职回流提示缺失');

console.log('员工未入职、离职回流与人才库关联契约检查通过。');
