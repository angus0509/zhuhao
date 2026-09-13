const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('sql/migrate-onsite-sensitive-blacklist-permission-20260829.mysql.sql');
const deploy = read('scripts/deploy-production.sh');
const onsiteJs = read('wechat-miniprogram/miniprogram/pages/employees/index.js');
const onsiteWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const detailJs = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.js');
const employeeController = read('src/controllers/employee.controller.js');

assert.match(migration, /employee:sensitive:view/, '驻厂角色迁移必须包含员工敏感信息查看权限');
assert.match(migration, /blacklist:manage/, '驻厂角色迁移必须包含黑名单管理权限');
assert.match(migration, /role_code\s*=\s*'onsite_staff'/, '迁移必须限定驻厂专员角色');
assert.match(deploy, /migrate-onsite-sensitive-blacklist-permission-20260829\.mysql\.sql/, '生产部署必须执行权限迁移');

assert.match(onsiteJs, /canViewSensitive/, '驻厂员工页应根据权限控制敏感信息');
assert.match(onsiteJs, /blacklist:manage/, '黑名单入口必须使用 blacklist:manage 权限');
assert.match(onsiteJs, /personName|idCardNo|blacklistReason/, '黑名单表单应包含姓名、身份证号和原因字段');
assert.match(onsiteJs, /url:\s*['"]\/blacklist['"]/, '小程序应调用黑名单接口');
assert.match(onsiteWxml, /录入黑名单/, '驻厂员工页应提供录入黑名单入口');
assert.match(onsiteWxml, /身份证号码|黑名单原因/, '黑名单弹窗应显示必填字段');
assert.doesNotMatch(onsiteJs, /setStorageSync\([^)]*(?:idCardNo|身份证)/, '敏感身份证号不得写入小程序缓存');

assert.match(detailJs, /showSensitive=1/, '员工详情查看完整信息必须走受保护接口');
assert.match(employeeController, /employee:sensitive:view/, '后端必须校验员工敏感信息查看权限');
assert.match(employeeController, /recordSensitiveAccess/, '敏感信息查看必须记录审计日志');

console.log('onsite-sensitive-blacklist-tests-ok');
