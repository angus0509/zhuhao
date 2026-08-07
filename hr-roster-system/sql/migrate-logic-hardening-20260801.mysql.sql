SET NAMES utf8mb4;

USE hr_roster;

-- 工资复核与工资制单/发布分离，避免草稿工资批次越级发布。
INSERT INTO sys_permission
(permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
VALUES
('工资批次复核', 'payroll:review', 2, 0, NULL, '/api/payroll/batches/:id/review', 72, 1)
ON DUPLICATE KEY UPDATE
  permission_name=VALUES(permission_name),
  api_path=VALUES(api_path),
  status=VALUES(status);

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r
JOIN sys_permission p ON p.permission_code='payroll:review'
WHERE r.company_id=1 AND r.role_code IN ('company_admin', 'hr_manager');

-- 企业管理员始终拥有全部有效权限，避免误配置后无法继续管理系统。
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r
CROSS JOIN sys_permission p
WHERE r.company_id=1 AND r.role_code='company_admin' AND p.status=1;
