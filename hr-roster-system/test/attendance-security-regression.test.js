const fs = require('node:fs');
const assert = require('node:assert/strict');
const service = require('../src/services/attendance.service');

const source = fs.readFileSync('src/services/attendance.service.js', 'utf8');
const routes = fs.readFileSync('src/routes/attendance.routes.js', 'utf8');
const migration = fs.readFileSync('sql/migrate-attendance-geofence-20260915.mysql.sql', 'utf8');

assert.equal(typeof service.validateShiftRule, 'function', '班次参数校验函数未导出');
assert.throws(() => service.validateShiftRule({
  ruleName: '异常班次', workStartTime: '09:00', workEndTime: '18:00', standardMinutes: -1
}), /班次参数无效/);
assert.throws(() => service.validateShiftRule({
  ruleName: '异常班次', workStartTime: '25:00', workEndTime: '18:00', standardMinutes: 480
}), /班次参数无效/);

const reviewBlock = source.match(/async function reviewCorrection[\s\S]*?\n}\n\nfunction monthRange/)?.[0] || '';
assert.match(reviewBlock, /assertProjectAccess\(/, '审核异常前未按历史项目快照校验范围');

const scheduleBlock = source.match(/async function upsertSchedule[\s\S]*?\n}\n\nasync function attendanceSummaryForPayroll/)?.[0] || '';
assert.match(scheduleBlock, /assertEmployeeScope\(/, '排班前未校验员工数据范围');
assert.match(scheduleBlock, /attendance_shift_rules[\s\S]*company_id=:companyId/, '排班未校验班次的企业归属');

const dailyBlock = source.match(/async function listDaily[\s\S]*?\n}\n\nasync function listMonthly/)?.[0] || '';
assert.match(dailyBlock, /params\.date \|\| shanghaiDate\(\)/, '日报默认日期未使用上海业务日期');
assert.match(dailyBlock, /d\.project_id=:projectId/, '日报未按历史项目快照过滤');

const employeeMonthBlock = source.match(/async function getEmployeeMonth[\s\S]*?\n}\nasync function getEmployeeToday/)?.[0] || '';
assert.match(employeeMonthBlock, /DATE_FORMAT\(shift_date, '%Y-%m'\)=:month/, '员工月报仍可能受数据库日期时区转换影响');

assert.match(migration, /attendance_correction_requests[\s\S]*punch_id/, '围栏异常未保存对应的原始打卡 ID');
assert.match(source, /c\.punch_id=p\.id/, '异常列表未按原始打卡 ID 读取围栏结果');
assert.match(routes, /get\('\/attendance\/geofences', requireAuth, requirePermission\('attendance:view'\)/, '围栏只读列表未向 attendance:view 开放');

console.log('attendance-security-regression.test.js: regression checks passed');
