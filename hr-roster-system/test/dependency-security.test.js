const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

function majorMinorPatch(version) {
  const match = String(version).replace(/^[^0-9]*/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

function atLeast(version, minimum) {
  const actual = majorMinorPatch(version);
  const required = majorMinorPatch(minimum);
  return actual[0] > required[0]
    || (actual[0] === required[0] && (actual[1] > required[1]
      || (actual[1] === required[1] && actual[2] >= required[2])));
}

const declaredMulter = pkg.dependencies && pkg.dependencies.multer;
const lockedMulter = lock.packages && lock.packages['node_modules/multer']
  && lock.packages['node_modules/multer'].version;
const lockedQs = lock.packages && lock.packages['node_modules/qs']
  && lock.packages['node_modules/qs'].version;

if (!atLeast(declaredMulter, '2.3.0')) {
  throw new Error(`multer 声明版本必须至少为 2.3.0，当前为 ${declaredMulter}`);
}
if (!atLeast(lockedMulter, '2.3.0')) {
  throw new Error(`multer 锁定版本必须至少为 2.3.0，当前为 ${lockedMulter}`);
}
if (!atLeast(lockedQs, '6.16.0')) {
  throw new Error(`qs 锁定版本必须至少为 6.16.0，当前为 ${lockedQs}`);
}

console.log('dependency-security: passed');
