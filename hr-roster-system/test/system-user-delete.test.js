const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters';

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const db = require('../src/db');
const systemService = require('../src/services/system.service');

async function main() {
  const originalFirst = db.first;
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const statements = [];

  db.first = async (sql, params) => {
    if (sql.includes("r.role_code='company_admin'") && sql.includes('u.id=:operatorId')) return { id: 1 };
    if (sql.includes("r.role_code='company_admin'") && sql.includes('ur.user_id=:userId')) return null;
    if (sql.includes('FROM sys_user') && /id\s*=\s*:userId/.test(sql)) {
      return { id: 8, username: 'onsite01', realName: '驻厂甲', accountType: 'MANAGER' };
    }
    throw new Error(`未覆盖的 first 查询：${sql} ${JSON.stringify(params)}`);
  };
  db.query = async () => [];
  db.transaction = async handler => handler({
    async execute(sql, params = {}) {
      statements.push({ sql, params });
      if (sql.includes('FOR UPDATE')) return [[{ id: 1 }]];
      return [{ affectedRows: 1 }];
    }
  });

  try {
    const result = await systemService.deleteUser(1, 8, { id: 1 });
    assert.equal(result.userId, 8, '删除结果必须返回目标账号');
    assert.ok(statements.some(item => /UPDATE sys_user[\s\S]*deleted_at=NOW\(\)/.test(item.sql)), '必须软删除账号并使 Token 失效');
    assert.ok(statements.some(item => /DELETE FROM sys_user_role/.test(item.sql)), '必须清除角色授权');
    assert.ok(statements.some(item => /DELETE FROM sys_user_project/.test(item.sql)), '必须清除项目授权');
    assert.ok(statements.some(item => /UPDATE manager_login_device[\s\S]*revoked_at/.test(item.sql)), '必须撤销记住登录设备');
    assert.ok(statements.some(item => /INSERT INTO hr_operation_log/.test(item.sql) && item.params.userId === 8), '必须记录账号删除审计日志');

    await assert.rejects(
      systemService.deleteUser(1, 1, { id: 1 }),
      /不能删除当前登录账号/,
      '必须禁止删除自己'
    );

    db.first = async sql => {
      if (sql.includes('u.id=:operatorId')) return { id: 1 };
      if (sql.includes('FROM sys_user') && !sql.includes('JOIN')) return { id: 8, username: 'admin', realName: '管理员', accountType: 'MANAGER' };
      return null;
    };
    await assert.rejects(systemService.deleteUser(1, 8, { id: 1 }), /不能删除超级管理员账号/);

    db.first = async sql => {
      if (sql.includes('u.id=:operatorId')) return { id: 1 };
      if (sql.includes('FROM sys_user') && !sql.includes('JOIN')) return { id: 8, username: 'employee_8', realName: '员工甲', accountType: 'EMPLOYEE' };
      return null;
    };
    await assert.rejects(systemService.deleteUser(1, 8, { id: 1 }), /员工账号不能在系统账号管理中删除/);

    db.first = async sql => {
      if (sql.includes('u.id=:operatorId')) return null;
      throw new Error(`非管理员场景不应继续查询：${sql}`);
    };
    await assert.rejects(systemService.deleteUser(1, 8, { id: 2 }), error => error.statusCode === 403 && /只有企业管理员/.test(error.message));

    db.first = async sql => {
      if (sql.includes('u.id=:operatorId')) return { id: 1 };
      if (sql.includes('FROM sys_user') && !sql.includes('JOIN')) return { id: 8, username: 'admin02', realName: '管理员乙', accountType: 'MANAGER' };
      if (sql.includes('ur.user_id=:userId')) return { id: 8 };
      throw new Error(`最后管理员场景未覆盖：${sql}`);
    };
    db.transaction = async handler => handler({
      async execute(sql) {
        if (sql.includes('FOR UPDATE')) return [[]];
        throw new Error(`最后管理员保护失败，仍执行了删除：${sql}`);
      }
    });
    await assert.rejects(systemService.deleteUser(1, 8, { id: 1 }), /必须至少保留一个启用的企业管理员/);
  } finally {
    db.first = originalFirst;
    db.query = originalQuery;
    db.transaction = originalTransaction;
    await db.pool.end();
  }

  const routes = read('src/routes/system.routes.js');
  const controller = read('src/controllers/system.controller.js');
  const service = read('src/services/system.service.js');
  const web = read('public/app.js');
  const schema = read('sql/schema.mysql.sql');
  const migration = read('sql/migrate-system-user-soft-delete-20260825.mysql.sql');
  const deploy = read('scripts/deploy-production.sh');

  assert.match(routes, /router\.delete\('\/system\/users\/:id'/, '缺少系统账号删除接口');
  assert.match(controller, /exports\.deleteUser[\s\S]*req\.user/, '删除接口必须传入当前登录人');
  assert.match(service, /不能删除超级管理员账号/, '必须禁止删除超级管理员');
  assert.match(service, /员工账号不能在系统账号管理中删除/, '必须禁止删除员工自动账号');
  assert.match(service, /必须至少保留一个启用的企业管理员/, '必须保护最后一个企业管理员');
  assert.match(service, /deleted_at IS NULL/, '账号查询必须过滤已删除记录');
  assert.match(web, /data-delete-user=/, '系统账号列表缺少删除按钮');
  assert.match(web, /const canDelete = isCompanyAdmin/, '删除按钮只能向企业管理员展示');
  assert.match(web, /title:\s*'删除系统账号'[\s\S]*danger:\s*true/, '删除账号必须使用危险确认弹窗');
  assert.match(schema, /deleted_at DATETIME DEFAULT NULL/, 'sys_user 缺少软删除时间字段');
  assert.match(migration, /ALTER TABLE sys_user ADD COLUMN deleted_at/, '缺少幂等软删除迁移');
  assert.match(deploy, /migrate-system-user-soft-delete-20260825\.mysql\.sql/, '生产部署未执行账号软删除迁移');

  console.log('system-user-delete-tests-ok');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
