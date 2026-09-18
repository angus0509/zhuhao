const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve('scripts/collaboration-status.sh');
assert.equal(fs.existsSync(script), true, '缺少协作状态检查脚本');

const source = fs.readFileSync(script, 'utf8');
assert.doesNotMatch(
  source,
  /git\s+(?:reset|clean|checkout)|rm\s+-[a-z]*r|\.env|cat\s+/i,
  '协作检查脚本包含写操作或敏感文件读取'
);

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'collaboration-status-'));
const run = (command, args) => spawnSync(command, args, { cwd: repo, encoding: 'utf8' });

try {
  assert.equal(run('git', ['init', '-b', 'codex/safe-test']).status, 0);
  fs.mkdirSync(path.join(repo, 'public'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'public/app.js'), 'console.log("safe");\n');
  fs.writeFileSync(path.join(repo, '.env'), 'DO_NOT_PRINT=secret-marker\n');
  assert.equal(run('git', ['add', 'public/app.js']).status, 0);
  assert.equal(
    run('git', [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'test: seed repository'
    ]).status,
    0
  );

  fs.appendFileSync(path.join(repo, 'public/app.js'), 'console.log("dirty");\n');
  const statusBefore = run('git', ['status', '--short']).stdout;
  const result = spawnSync('bash', [script, repo], { encoding: 'utf8' });
  const statusAfter = run('git', ['status', '--short']).stdout;

  assert.equal(result.status, 0, result.stderr);
  assert.equal(statusAfter, statusBefore, '脚本不得改变工作区状态');
  assert.match(result.stdout, /branch=codex\/safe-test/);
  assert.match(result.stdout, /owner=Codex/);
  assert.match(result.stdout, /head=[0-9a-f]{7,40}/);
  assert.match(result.stdout, /worktree_state=dirty/);
  assert.match(result.stdout, /tracked_changes=1/);
  assert.match(result.stdout, /high_conflict_files=public\/app\.js/);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-marker|DO_NOT_PRINT/);
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

console.log('collaboration-status-script-tests-ok');
