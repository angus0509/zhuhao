const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const service = read('src/services/employee.service.js');
const routes = read('src/routes/employee.routes.js');
const webPage = read('public/index.html');
const webApp = read('public/app.js');
const miniJs = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.js');
const miniWxml = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.wxml');
const miniDetail = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.js');
const migration = read('sql/migrate-simplified-resignation-20260811.mysql.sql');

for (const field of [
  'leaveDate',
  'leaveType',
  'leaveReason',
  'badgeReturned',
  'toolsReturned',
  'dormCleared',
  'attendanceConfirmed',
  'terminateEmployerInsurance'
]) {
  assert(miniJs.includes(field) || miniWxml.includes(field), `小程序单页离职缺少字段：${field}`);
}

assert(!/工资结算|settlementStatus|canManageSettlement/.test(miniJs + miniWxml), '小程序仍包含离职工资结算环节');
assert(miniJs.includes('确认离职并归档'), '小程序缺少一次办结确认文案');
assert(miniJs.includes("wx.setStorageSync('onsite_employee_stage', 'left')"), '小程序办结后未切换到已离职分类');
assert(miniJs.includes("wx.switchTab({ url: '/pages/employees/index' })"), '小程序办结后未返回员工列表');
assert(miniWxml.includes('<checkbox-group bindchange="onHandoverChange">'), '离职交接清单未使用勾选控件');
assert(miniWxml.includes('已减保'), '办理离职缺少已减保选项');
assert(!/请确认完成全部交接项|every\(Boolean\)/.test(miniJs), '小程序仍强制全选交接项');

assert(webPage.includes('name="terminateEmployerInsurance"'), '网页离职弹窗缺少雇主险减保选项');
assert(!/离职工资已结算|name="settlementStatus"/.test(webPage), '网页离职弹窗仍包含工资结算');
assert(!/data-complete-settlement|确认工资结算|离职工资待结算/.test(webApp), '网页待办中心仍包含离职工资结算操作');

assert(routes.includes("requirePermission('employee:resign')"), '离职进度接口未限制为离职办理权限');
assert(!routes.includes("requireAnyPermission(['employee:resign', 'payroll:manage'])"), '薪资权限仍可进入离职办理接口');
assert(!service.includes("taskType: 'PAYROLL_SETTLEMENT'"), '新离职流程仍创建工资结算待办');
assert(!service.includes('const settlementDone = Number(row.settlement_status) === 1;'), '离职完成条件仍依赖工资结算');
assert(service.includes('terminateEmployerInsurance'), '后端离职流程未接收同步减保选项');
assert(service.includes("employee_status=3,lifecycle_status='LEFT'"), '离职完成后未更新员工归档状态');
assert(service.includes("sourceType: 'RESIGNED'"), '离职员工未同步回流人才库');
assert(!service.includes('DELETE FROM hr_employee'), '离职流程不应删除花名册员工记录');
assert(!service.includes('请确认完成全部离职交接清单'), '后端仍强制全选离职交接清单');
assert(miniDetail.includes("isOffboarding ? (employerInsuranceCovered ? 75 : 90)"), '员工详情离职进度仍依赖全部交接项');

assert(migration.includes("task_type='PAYROLL_SETTLEMENT'"), '迁移未关闭历史工资结算待办');
assert(migration.includes('settlement_status=1'), '迁移未兼容历史离职结算字段');

console.log('simplified-resignation-flow-tests-ok');
