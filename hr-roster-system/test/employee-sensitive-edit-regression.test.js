const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/services/employee.service.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'sql/migrate-onsite-sensitive-employee-view-20260831.mysql.sql'), 'utf8');

assert.match(service, /function resolveSensitiveEmployeeFields\(employee, body = \{\}, canViewSensitiveEmployee = false\)/);
assert.match(service, /if \(!canViewSensitiveEmployee\) return current;/);
assert.match(service, /Object\.prototype\.hasOwnProperty\.call\(body, field\)/);
assert.match(service, /idCardNo: provided\('idCardNo'\) \? String\(body\.idCardNo\)\.trim\(\)\.toUpperCase\(\) : current\.idCardNo/);
assert.match(service, /const sensitiveBody = resolveSensitiveEmployeeFields\(employee, body, canViewSensitiveEmployee\);/);
assert.match(service, /deptId: Number\(normalizedBody\.deptId \|\| 0\) \|\| null/);
assert.match(migration, /r\.role_code = 'onsite_staff'/);
assert.match(migration, /p\.permission_code = 'employee:sensitive:view'/);

console.log('employee-sensitive-edit-regression-tests-ok');
