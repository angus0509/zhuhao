const assert = require('node:assert/strict');
const { normalizeEmploymentType, normalizeFeeMode } = require('../src/services/employee.service');

assert.equal(normalizeEmploymentType('全职'), 1);
assert.equal(normalizeEmploymentType('外包'), 5);
assert.equal(normalizeEmploymentType('派遣'), 6);
assert.equal(normalizeEmploymentType('劳务派遣'), 6);
assert.equal(normalizeEmploymentType('5'), 5);
assert.throws(() => normalizeEmploymentType(''), /用工模式不能为空/);
assert.throws(() => normalizeEmploymentType('默认派遣'), /用工模式.*无效/);

assert.equal(normalizeFeeMode('小时工服务费 2.5 元/小时'), '小时工服务费 2.5 元/小时');
assert.equal(normalizeFeeMode(' 自定义月结 '), '自定义月结');
assert.equal(normalizeFeeMode('派遣'), '派遣');
assert.equal(normalizeFeeMode(''), '');
assert.throws(() => normalizeFeeMode('超'.repeat(81)), /最多填写80个字符/);

console.log('employment-type-tests-ok');
