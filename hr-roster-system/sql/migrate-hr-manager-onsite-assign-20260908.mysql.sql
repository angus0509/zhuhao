-- HR主管增加派遣驻厂权限，可重复执行。
-- 企业管理员默认全权限；此处显式授予 HR主管，不授予驻厂专员/薪资专员。
SET NAMES utf8mb4;
USE hr_roster;

INSERT INTO sys_permission
(permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
VALUES
('派遣驻厂', 'factory:assign', 2, 0, NULL, '/api/system/projects/:id/onsite-assignees', 46, 1)
ON DUPLICATE KEY UPDATE
  permission_name=VALUES(permission_name), api_path=VALUES(api_path), status=1;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r JOIN sys_permission p ON p.permission_code='factory:assign'
WHERE r.role_code='hr_manager' AND r.status=1 AND p.status=1;
