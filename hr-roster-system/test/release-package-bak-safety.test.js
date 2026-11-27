const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function createTarArchive(archivePath, label) {
  const payloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-backup-payload-'));
  try {
    fs.writeFileSync(path.join(payloadRoot, 'marker.txt'), label);
    execFileSync('tar', ['czf', archivePath, '-C', payloadRoot, '.']);
  } finally {
    fs.rmSync(payloadRoot, { recursive: true, force: true });
  }
}

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

const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-backup-retention-'));
try {
  const oldBackup = path.join(backupRoot, 'attachments-20261126-221459.tar.gz');
  const currentBackup = path.join(backupRoot, 'attachments-20261127-001359.tar.gz');
  const unrelatedBackup = path.join(backupRoot, 'code-backup-20261127-001358.tar.gz');
  createTarArchive(oldBackup, 'old');
  createTarArchive(currentBackup, 'current');
  createTarArchive(unrelatedBackup, 'code');

  const rotated = spawnSync(
    'bash',
    ['scripts/rotate-attachment-backups.sh', backupRoot, currentBackup],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(rotated.status, 0,
    `附件备份轮换应成功: ${rotated.stdout}\n${rotated.stderr}`);
  assert.equal(fs.existsSync(oldBackup), false, '轮换后必须删除旧附件备份');
  assert.equal(fs.existsSync(currentBackup), true, '轮换后必须保留本次附件备份');
  assert.equal(fs.existsSync(unrelatedBackup), true, '轮换不得删除代码备份');

  const externalKeep = path.join(os.tmpdir(), `attachments-external-${process.pid}.tar.gz`);
  const protectedOldBackup = path.join(backupRoot, 'attachments-20261125-000000.tar.gz');
  createTarArchive(externalKeep, 'external');
  createTarArchive(protectedOldBackup, 'protected');
  try {
    const rejected = spawnSync(
      'bash',
      ['scripts/rotate-attachment-backups.sh', backupRoot, externalKeep],
      { cwd: root, encoding: 'utf8' }
    );
    assert.notEqual(rejected.status, 0, '轮换必须拒绝保留目录外的备份文件');
    assert.equal(fs.existsSync(protectedOldBackup), true,
      '参数校验失败时不得删除任何附件备份');
  } finally {
    fs.rmSync(externalKeep, { force: true });
  }
} finally {
  fs.rmSync(backupRoot, { recursive: true, force: true });
}

const deploySource = fs.readFileSync(path.join(root, 'scripts/deploy-production.sh'), 'utf8');
const healthGateIndex = deploySource.indexOf('if [ "$HEALTH_OK" != true ]');
const rotationIndex = deploySource.indexOf('rotate-attachment-backups.sh');
assert.ok(healthGateIndex >= 0, '部署脚本必须保留健康检查失败门禁');
assert.ok(rotationIndex > healthGateIndex, '附件备份轮换只能在健康检查通过后执行');

console.log('release-package-bak-safety-tests-ok');
