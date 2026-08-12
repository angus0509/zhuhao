const { signToken } = require('../src/utils/token');
const db = require('../src/db');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100/api';
const userId = Number(process.env.SMOKE_USER_ID || 1);
const companyId = Number(process.env.SMOKE_COMPANY_ID || 1);
let token = '';
const paths = [
  '/auth/me',
  '/bootstrap',
  '/summary',
  '/operations/home',
  '/notices?limit=10',
  '/notices?limit=invalid',
  '/customers?page=1&pageSize=2',
  '/customers?page=invalid&pageSize=NaN',
  '/projects?page=1&pageSize=2',
  '/factory-staff?page=1&pageSize=2',
  '/blacklist?page=1&pageSize=2',
  '/employees?page=1&pageSize=2',
  '/employees?page=invalid&pageSize=NaN',
  '/employees/mine?page=1&pageSize=2',
  '/advances?page=1&pageSize=2',
  '/payroll/overview',
  '/risk-alerts',
  '/risk-cases',
  '/talents',
  '/employment-records',
  '/audit-logs',
  '/analytics/dashboard',
  '/permissions/overview',
  '/system/users',
  '/system/roles',
  '/system/departments',
  '/system/permissions',
  '/system/projects'
];

async function main() {
  const user = await db.first(
    'SELECT id,company_id companyId,username,employee_id employeeId,token_version tokenVersion FROM sys_user WHERE id=:userId AND company_id=:companyId AND status=1',
    { userId, companyId }
  );
  if (!user) throw new Error('只读 smoke 用户不存在或已停用');
  token = signToken({
    userId: user.id,
    companyId: user.companyId,
    username: user.username,
    employeeId: user.employeeId || null,
    tokenVersion: Number(user.tokenVersion || 0)
  });
  let employeeId = null;
  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(`${path} 回归失败：HTTP ${response.status} / ${payload.message || payload.code}`);
    }
    if (path === '/employees?page=1&pageSize=2') {
      employeeId = Number(payload.data?.list?.[0]?.id || 0) || null;
    }
    console.log(`${path} ok`);
  }

  // 员工详情包含招聘来源、合同、保险、任职和风险联表，必须纳入只读生产回归。
  if (employeeId) {
    const detailPath = `/employees/${employeeId}`;
    const response = await fetch(`${baseUrl}${detailPath}`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok || payload.code !== 0) {
      throw new Error(`${detailPath} 回归失败：HTTP ${response.status} / ${payload.message || payload.code}`);
    }
    console.log(`${detailPath} ok`);
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
