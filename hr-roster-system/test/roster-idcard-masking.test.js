const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const roster = fs.readFileSync(path.join(root, 'public/js/views/roster.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/employee.service.js'), 'utf8');

assert.match(service, /idCardNo:\s*showSensitive\s*\?\s*idCardNo\s*:\s*maskIdCard\(idCardNo\)/, '员工列表默认必须返回脱敏身份证号');
assert.match(roster, /data-action="reveal-id-card"/, '花名册缺少单行查看完整身份证入口');
assert.match(roster, /employee:sensitive:view/, '完整身份证入口未受独立敏感信息权限控制');
assert.match(app, /async function toggleRosterIdCard/, '花名册缺少单行身份证切换逻辑');
assert.match(app, /showSensitive=1/, '查看完整身份证时未按需请求敏感信息接口');
assert.match(app, /查看花名册身份证号/, '敏感信息请求缺少审计原因');
assert.match(app, /dataset\.maskedValue/, '隐藏完整号码时未保留该行脱敏值');

console.log('roster-idcard-masking-tests-ok');
