const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-candidate.json'), 'utf8'));
const miniRelease = JSON.parse(fs.readFileSync(path.join(root, 'wechat-miniprogram/release.json'), 'utf8'));
const buildReleaseScript = fs.readFileSync(path.join(root, 'scripts/build-release-package.sh'), 'utf8');
const verifyReleaseScript = fs.readFileSync(path.join(root, 'scripts/verify-release-package.sh'), 'utf8');

assert.match(buildReleaseScript, /--exclude='release-candidate\.json'/, '发布包必须排除仅供本机使用的候选清单');
assert.match(verifyReleaseScript, /FORBIDDEN=.*release-candidate\.json/, '发布包验收必须拒绝嵌入候选清单');

assert.ok(fs.existsSync(manifest.webApi.archive), '发布候选清单指向的 Web/API 包不存在');
const digest = crypto.createHash('sha256').update(fs.readFileSync(manifest.webApi.archive)).digest('hex');
assert.equal(digest, manifest.webApi.sha256, '发布候选包 SHA-256 与清单不一致');
assert.ok(
  ['passed', 'deployed-and-public-regression-passed'].includes(manifest.webApi.verificationStatus),
  'Web/API 发布包尚未通过隔离验收或生产回归'
);
assert.equal(miniRelease.version, '1.1.20', '本轮生产候选版本应为1.1.20');
assert.equal(manifest.miniprogram.version, miniRelease.version, '小程序版本与候选清单不一致');
assert.equal(manifest.miniprogram.appid, miniRelease.appid, '小程序 AppID 与候选清单不一致');
assert.equal(
  manifest.miniprogram.verificationStatus,
  'uploaded-successfully-pending-review',
  '小程序上传成功后应标记为已上传待审核'
);
assert.match(
  manifest.miniprogram.uploadedAt,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  '小程序上传成功后必须记录 UTC 上传时间'
);
assert.ok(
  Number.isInteger(manifest.miniprogram.packageSizeBytes) && manifest.miniprogram.packageSizeBytes > 0,
  '小程序上传成功后必须记录实际代码包大小'
);
assert.equal(manifest.miniprogram.reviewStatus, 'not-submitted', '本次仅上传体验版，不应标记为已提交审核');
assert.deepEqual(manifest.deploymentOrder, ['web-api-deploy', 'public-regression', 'miniprogram-upload', 'four-role-uat']);

console.log('release-candidate-manifest-tests-ok');
