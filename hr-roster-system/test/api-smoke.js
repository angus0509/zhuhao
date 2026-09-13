const { signToken } = require('../src/utils/token');
const db = require('../src/db');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100/api';
const userId = Number(process.env.SMOKE_USER_ID || 1);
const companyId = Number(process.env.SMOKE_COMPANY_ID || 1);
const employeeSmokeUserId = Number(process.env.EMPLOYEE_SMOKE_USER_ID || 0);
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
  '/advances?page=1&pageSize=2&month=2026-08',
  '/payroll/overview',
  '/payroll/disputes?handleStatus=0&page=1&pageSize=20',
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

  // 可选员工端只读回归：仅在显式提供员工测试账号ID时执行，不在脚本中保存真实凭据。
  if (employeeSmokeUserId > 0) {
    const employeeUser = await db.first(
      `SELECT id,company_id companyId,username,employee_id employeeId,
              token_version tokenVersion,account_type accountType
       FROM sys_user
       WHERE id=:userId AND company_id=:companyId AND status=1
         AND account_type='EMPLOYEE'`,
      { userId: employeeSmokeUserId, companyId }
    );
    if (!employeeUser || !employeeUser.employeeId) throw new Error('员工 smoke 账号不存在、已停用或未绑定档案');
    const employeeToken = signToken({
      userId: employeeUser.id,
      companyId: employeeUser.companyId,
      username: employeeUser.username,
      employeeId: employeeUser.employeeId,
      accountType: 'EMPLOYEE',
      tokenVersion: Number(employeeUser.tokenVersion || 0)
    });
    for (const employeePath of ['/me/profile', '/me/payslips?year=2026&page=1&pageSize=20']) {
      const response = await fetch(`${baseUrl}${employeePath}`, {
        headers: { Authorization: `Bearer ${employeeToken}` }
      });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0) {
        throw new Error(`${employeePath} 员工端回归失败：HTTP ${response.status} / ${payload.message || payload.code}`);
      }
      if (employeePath.startsWith('/me/payslips')
        && (!Array.isArray(payload.data?.list) || !Number.isInteger(Number(payload.data?.total)))) {
        throw new Error(`${employeePath} 员工工资条分页响应格式无效`);
      }
      console.log(`${employeePath} employee ok`);
    }
  }
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
