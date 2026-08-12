const { signToken } = require('../src/utils/token');
const db = require('../src/db');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100/api';
const userId = Number(process.env.ONSITE_SMOKE_USER_ID || 0);
const companyId = Number(process.env.SMOKE_COMPANY_ID || 1);

if (!userId) {
  console.error('缺少 ONSITE_SMOKE_USER_ID');
  process.exit(1);
}

let token = '';
const paths = [
  '/auth/me',
  '/bootstrap',
  '/operations/home',
  '/notices?limit=5',
  '/employees?page=1&pageSize=2',
  '/employees/mine?page=1&pageSize=2',
  '/customers?page=1&pageSize=2',
  '/projects?page=1&pageSize=2',
  '/factory-staff?page=1&pageSize=2'
];

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(`${path} 驻厂角色回归失败：HTTP ${response.status} / ${payload.message || payload.code}`);
  }
  return payload.data;
}

async function main() {
  const user = await db.first(
    'SELECT id,company_id companyId,username,employee_id employeeId,token_version tokenVersion FROM sys_user WHERE id=:userId AND company_id=:companyId AND status=1',
    { userId, companyId }
  );
  if (!user) throw new Error('驻厂 smoke 用户不存在或已停用');
  token = signToken({
    userId: user.id,
    companyId: user.companyId,
    username: user.username,
    employeeId: user.employeeId || null,
    tokenVersion: Number(user.tokenVersion || 0)
  });
  const me = await request('/auth/me');
  if (!me.roles?.some(role => role.roleCode === 'onsite_staff')) {
    throw new Error('测试账号未绑定驻厂专员角色');
  }
  console.log('/auth/me onsite_staff ok');
  for (const path of paths.slice(1)) {
    await request(path);
    console.log(`${path} ok`);
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
