SET NAMES utf8mb4;

USE hr_roster;

INSERT INTO sys_permission
(id, permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
VALUES
(30, '工资条发布', 'payroll:manage', 2, 0, NULL, '/api/payroll/batches/:id/publish', 71, 1)
ON DUPLICATE KEY UPDATE
  permission_name = VALUES(permission_name),
  api_path = VALUES(api_path),
  status = VALUES(status);

UPDATE sys_role
SET role_name = '驻厂专员'
WHERE company_id = 1 AND role_code = 'onsite_manager';

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code = 'payroll:manage'
WHERE r.company_id = 1 AND r.role_code IN ('company_admin', 'payroll_finance');

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code IN ('advance:view', 'advance:approve', 'payroll:view')
WHERE r.company_id = 1 AND r.role_code = 'hr_manager';
