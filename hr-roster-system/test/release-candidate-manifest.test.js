const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-candidate.json'), 'utf8'));
const miniRelease = JSON.parse(fs.readFileSync(path.join(root, 'wechat-miniprogram/release.json'), 'utf8'));

assert.ok(fs.existsSync(manifest.webApi.archive), '发布候选清单指向的 Web/API 包不存在');
const digest = crypto.createHash('sha256').update(fs.readFileSync(manifest.webApi.archive)).digest('hex');
assert.equal(digest, manifest.webApi.sha256, '发布候选包 SHA-256 与清单不一致');
assert.ok(
  ['passed', 'deployed-and-public-regression-passed'].includes(manifest.webApi.verificationStatus),
  'Web/API 发布包尚未通过隔离验收或生产回归'
);
assert.equal(manifest.miniprogram.version, miniRelease.version, '小程序版本与候选清单不一致');
assert.equal(manifest.miniprogram.appid, miniRelease.appid, '小程序 AppID 与候选清单不一致');
assert.deepEqual(manifest.deploymentOrder, ['web-api-deploy', 'public-regression', 'miniprogram-upload', 'four-role-uat']);

console.log('release-candidate-manifest-tests-ok');
