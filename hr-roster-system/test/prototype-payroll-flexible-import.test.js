const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');

assert.match(source, /function previewPrototypePayrollRows/, '本地原型缺少工资行预校验');
assert.match(source, /function normalizePrototypePayrollAmounts/, '本地原型缺少工资金额复算');
assert.match(source, /factoryStaff[\s\S]{0,300}projectId/, '原型员工匹配未限制所属项目');
assert.match(source, /\[2,\s*3\]\.includes\(Number\(employee\.employeeStatus\)\)/,
  '本地原型工资发放必须允许在职和已离职员工');
assert.match(source, /req\.method === 'POST' && url\.pathname === '\/api\/payroll\/batches\/preview'/,
  '本地原型缺少工资导入预览接口');
assert.match(source, /req\.method === 'POST' && url\.pathname === '\/api\/payroll\/batches'/,
  '本地原型缺少工资批次创建接口');
assert.match(source, /工资表存在错误，请修正后重新预览/, '原型创建接口未阻止错误工资表');
assert.match(source, /addLog\(db, '工资管理', 'create_batch'/, '原型工资批次创建缺少操作留痕');

console.log('prototype-payroll-flexible-import-tests-ok');
