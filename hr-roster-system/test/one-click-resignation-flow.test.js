const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const listWxml = read('wechat-miniprogram/miniprogram/pages/employees/index.wxml');
const detailWxml = read('wechat-miniprogram/miniprogram/pages/employees/detail/index.wxml');
const resignWxml = read('wechat-miniprogram/miniprogram/pages/employees/resign/index.wxml');
const service = read('src/services/employee.service.js');

assert.match(listWxml, /一键办理离职/, '驻厂员工卡应提供一键办理离职入口');
assert.match(detailWxml, /一键办理离职/, '员工详情应提供一键办理离职入口');
assert.match(resignWxml, /已减保/, '离职单页必须包含雇主险已减保确认');
assert.match(service, /sourceType:\s*'RESIGNED'/, '离职完成后必须回流人才库');
assert.match(service, /ON DUPLICATE KEY UPDATE|SELECT[\s\S]*talent_candidate/i, '人才库回流必须具备幂等处理');

console.log('one-click-resignation-flow-tests-ok');
