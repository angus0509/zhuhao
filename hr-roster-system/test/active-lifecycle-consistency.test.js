const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const db = require('../src/db');
const employeeService = require('../src/services/employee.service');

async function main() {
  const originalTransaction = db.transaction;
  let transactionCalled = false;
  db.transaction = async () => {
    transactionCalled = true;
    throw new Error('直接录入在职状态不应进入数据库事务');
  };

  try {
    await assert.rejects(
      employeeService.createEmployee(1, { employeeStatus: 2 }, 1, null),
      error => error.statusCode === 400 && error.message === '新增员工请先录入为待到岗，再确认入职',
      '新增员工接口必须拒绝直接录入在职状态'
    );
    await assert.rejects(
      employeeService.createEmployee(1, { employeeStatus: 5 }, 1, null),
      error => error.statusCode === 400 && error.message === '新增员工只能选择面试或直接入职',
      '新增员工接口必须拒绝直接录入未入职状态'
    );
    assert.equal(transactionCalled, false, '直接录入在职状态必须在数据库事务前被拒绝');
  } finally {
    db.transaction = originalTransaction;
    await db.pool.end();
  }

  const root = path.resolve(__dirname, '..');
  const migrationPath = path.join(root, 'sql/migrate-active-employee-lifecycle-20260817.mysql.sql');
  assert.equal(fs.existsSync(migrationPath), true, '缺少在职员工生命周期修复迁移');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /SET\s+lifecycle_status\s*=\s*'ACTIVE'/i, '迁移必须把在职员工生命周期修正为 ACTIVE');
  assert.match(migration, /employee_status\s*=\s*2/i, '迁移只能处理已在职员工');
  assert.match(migration, /lifecycle_status\s*=\s*'ONBOARDING'/i, '迁移只能处理遗留 ONBOARDING 状态');
  assert.match(migration, /deleted_at\s+IS\s+NULL/i, '迁移不得修改已删除员工');

  const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-production.sh'), 'utf8');
  assert.match(
    deploy,
    /run_migration "\$STAGE_DIR\/sql\/migrate-active-employee-lifecycle-20260817\.mysql\.sql"/,
    '生产部署必须执行在职员工生命周期修复迁移'
  );
  assert.ok(
    deploy.indexOf('migrate-active-employee-lifecycle-20260817.mysql.sql')
      > deploy.indexOf('migrate-simplified-onsite-flow-20260813.mysql.sql'),
    'ACTIVE 修复迁移必须在所有历史驻厂迁移之后执行'
  );
  assert.match(deploy, /STALE_ACTIVE_LIFECYCLE_COUNT/, '生产部署必须核对遗留 ONBOARDING 在职员工数量');

  console.log('active-lifecycle-consistency-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
