const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

assert.match(source, /function prototypePayrollBatchDetailRows/, '本地原型缺少工资条员工明细生成逻辑');
assert.match(source, /payrollDetailMatch[\s\S]{0,180}\/details\$\//, '本地原型缺少工资批次详情接口');
assert.match(source, /payrollSmsMatch[\s\S]{0,180}\/sms-summary\$\//, '本地原型缺少工资短信状态接口');
assert.match(source, /payrollExportMatch[\s\S]{0,220}delivery\|receipt[\s\S]{0,80}export/, '本地原型缺少工资条导出接口');
assert.match(source, /url\.pathname === '\/api\/payroll\/disputes'/, '本地原型缺少工资异议列表接口');
assert.match(source, /phoneMasked/, '本地原型工资条手机号必须脱敏');
assert.match(source, /!\['CLOSED', 'PUBLISHED'\]\.includes\(item\.status\)/, '本地原型同项目同月应允许多次发放');

console.log('prototype-payroll-workbench-tests-ok');
