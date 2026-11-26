const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const output = execFileSync('bash', ['scripts/build-release-package.sh'], {
  cwd: root,
  encoding: 'utf8'
});
const packagePath = output.match(/路径:\s+(\/tmp\/hr-roster-deploy-[^\s]+\.tar\.gz)/)?.[1];
assert.ok(packagePath, '发布脚本必须输出唯一发布包路径');
try {
  const archiveList = execFileSync('tar', ['tzf', packagePath], { encoding: 'utf8' });
  assert.doesNotMatch(archiveList, /\.bak-[^/\n]*$/m, '发布包不得包含任何 .bak-* 文件');
} finally {
  fs.rmSync(packagePath, { force: true });
}

const unsafeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'release-bak-test-'));
const unsafeArchive = path.join(os.tmpdir(), `release-bak-${process.pid}.tar.gz`);
try {
  fs.mkdirSync(path.join(unsafeRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(unsafeRoot, 'src', 'service.js.bak-test'), 'backup');
  execFileSync('tar', ['czf', unsafeArchive, '-C', unsafeRoot, '.']);
  const verified = spawnSync('bash', ['scripts/verify-release-package.sh', unsafeArchive], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.notEqual(verified.status, 0, '验收脚本必须拒绝含 .bak-* 的外部发布包');
  assert.match(`${verified.stdout}\n${verified.stderr}`, /\.bak-|备份文件/,
    '拒绝原因必须明确指出 .bak-* 备份文件');
} finally {
  fs.rmSync(unsafeRoot, { recursive: true, force: true });
  fs.rmSync(unsafeArchive, { force: true });
}

console.log('release-package-bak-safety-tests-ok');
