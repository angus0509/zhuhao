-- 补充前端导航所需的菜单级权限码以及保险、操作日志查看权限，可重复执行。
-- 权限定义全局唯一，角色授权通过 role_code（而非固定 company_id）匹配所有启用公司下的对应角色。
SET NAMES utf8mb4;
USE hr_roster;

INSERT INTO sys_permission
(permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
VALUES
('办公中心',    'office:menu',     1, 0, '/office',        NULL, 5, 1),
('HR数字驾驶舱', 'dashboard:menu',   1, 0, '/dashboard',     NULL, 15, 1),
('公司黑名单',   'blacklist:menu',   1, 0, '/hr/blacklist',  NULL, 25, 1),
('人才库',      'talent:menu',      1, 0, '/hr/talents',    NULL, 35, 1),
('保险提示',    'insurance:menu',   1, 0, '/hr/insurance',  NULL, 45, 1),
('保险查看',    'insurance:view',   2, 0, NULL, '/api/insurance/overview', 46, 1),
('工资预支',    'advance:menu',     1, 0, '/hr/advances',   NULL, 55, 1),
('工资发放',    'payroll:menu',     1, 0, '/hr/payroll',    NULL, 65, 1),
('风险整改',    'riskCase:menu',    1, 0, '/hr/risk-cases', NULL, 75, 1),
('操作日志',    'audit:menu',       1, 0, '/hr/audit-logs', NULL, 85, 1),
('操作日志查看', 'audit:view',       2, 0, NULL, '/api/audit-logs', 86, 1),
('权限配置',    'permission:menu',  1, 0, '/system',        NULL, 95, 1)
ON DUPLICATE KEY UPDATE
  permission_name = VALUES(permission_name),
  status = 1;

-- 企业管理员：全菜单及新增按钮权限（所有启用公司的 company_admin）
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code IN (
  'office:menu','dashboard:menu','blacklist:menu','talent:menu',
  'insurance:menu','insurance:view','advance:menu','payroll:menu',
  'riskCase:menu','audit:menu','audit:view','permission:menu'
) AND p.status = 1
WHERE r.role_code = 'company_admin' AND r.status = 1;

-- HR主管：新增菜单及保险、操作日志查看权限（所有启用公司的 hr_manager）
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code IN (
  'office:menu','dashboard:menu','blacklist:menu','talent:menu',
  'insurance:menu','insurance:view','advance:menu','payroll:menu',
  'riskCase:menu','audit:menu','audit:view'
) AND p.status = 1
WHERE r.role_code = 'hr_manager' AND r.status = 1;

-- 驻厂专员：新增工作台、黑名单菜单权限（所有启用公司的 onsite_staff）
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code IN ('office:menu','blacklist:menu') AND p.status = 1
WHERE r.role_code = 'onsite_staff' AND r.status = 1;

-- 薪资专员：新增工资预支、工资发放、工作台菜单权限（所有启用公司的 payroll_staff）
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code IN ('advance:menu','payroll:menu','office:menu') AND p.status = 1
WHERE r.role_code = 'payroll_staff' AND r.status = 1;
