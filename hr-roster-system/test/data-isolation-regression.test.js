const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const riskController = read('src/controllers/risk.controller.js');
const riskService = read('src/services/risk.service.js');
const portalController = read('src/controllers/portal.controller.js');
const portalService = read('src/services/portal.service.js');
const operationsController = read('src/controllers/operations.controller.js');
const operationsService = read('src/services/operations.service.js');
const payrollProfileService = read('src/services/payroll-import-profile.service.js');

// 手工风险扫描必须使用当前登录人的数据范围；定时任务仍可不传 user 执行全公司扫描。
assert.match(riskController, /scanRisks\(req\.companyId,\s*req\.user\)/,
  '手工风险扫描未传入当前用户数据范围');
assert.match(riskService, /async function scanRisks\(companyId,\s*user\s*=\s*null\)/,
  '风险扫描服务未区分手工范围扫描和系统全量扫描');
assert.match(riskService, /employeeScope\(user,[\s\S]*scan_scope_e[\s\S]*scan_scope_j/,
  '风险扫描 SQL 未应用员工数据范围');

// 隐藏但保留的历史客户工单 API 也必须执行客户、项目、员工三层校验。
assert.match(portalController, /createClientService\(req\.companyId,\s*req\.body,\s*req\.operatorId,\s*req\.user\)/,
  '客户工单新增接口未传入当前用户');
assert.match(portalController, /updateClientServiceStatus\(req\.companyId,[\s\S]*req\.body,\s*req\.user\)/,
  '客户工单更新接口未传入当前用户');
for (const guard of ['assertCustomerAccess', 'assertProjectAccess', 'assertEmployeeScope']) {
  assert.match(portalService, new RegExp(`${guard}\\(`), `客户工单缺少 ${guard} 数据范围校验`);
}

// HR 主管查看操作日志时只能读取自己范围内的员工和项目日志。
assert.match(portalController, /auditLogs\(req\.companyId,\s*req\.user\)/,
  '操作日志接口未传入当前用户');
assert.match(portalService, /async function auditLogs\(companyId,\s*user\)/,
  '操作日志服务未接收用户数据范围');
assert.match(portalService, /employeeScope\(user,[\s\S]*audit_e[\s\S]*audit_j/,
  '员工类操作日志未按员工范围过滤');
assert.match(portalService, /projectScope\(user,[\s\S]*audit_p/,
  '项目和工资类操作日志未按项目范围过滤');

// 驻厂人员创建客户和首个项目后，必须自动获得该项目授权，避免保存成功后看不到。
assert.match(operationsController, /createCustomer\(req\.companyId,\s*req\.body,\s*req\.operatorId,\s*req\.user\)/,
  '新增客户未传入创建人的数据范围');
assert.match(operationsService, /async function createCustomer\(companyId,\s*body,\s*operatorId\s*=\s*0,\s*user\s*=\s*null\)/,
  '新增客户服务未接收创建人');
assert.match(operationsService, /INSERT IGNORE INTO sys_user_project[\s\S]*projectResult\.insertId/,
  '授权项目范围账号创建项目后未自动获得项目授权');

assert.match(payrollProfileService, /sip\.company_id=:companyId/, '工资字段映射查询缺少企业隔离');
assert.match(payrollProfileService, /projectScope\(user, params, 'p'\)/, '工资字段映射查询缺少项目数据范围');
assert.doesNotMatch(payrollProfileService, /WHERE\s+header_signature=:headerSignature(?![\s\S]*company_id)/,
  '工资字段映射不得仅按表头签名跨企业查询');

console.log('data-isolation-regression-tests-ok');
