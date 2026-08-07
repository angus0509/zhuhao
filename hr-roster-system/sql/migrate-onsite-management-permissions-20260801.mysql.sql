-- 驻厂专员新增员工、批量录入、客户与项目管理权限，可重复执行。
SET NAMES utf8mb4;
USE hr_roster;

INSERT INTO sys_permission
(permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
VALUES
('批量录入员工', 'employee:batch', 2,
 (SELECT id FROM (SELECT id FROM sys_permission WHERE permission_code='employee:menu' LIMIT 1) parent_perm),
 NULL, '/api/employees/batch', 12, 1)
ON DUPLICATE KEY UPDATE
  permission_name=VALUES(permission_name), api_path=VALUES(api_path), status=1;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code IN
  ('employee:create','employee:batch','customer:view','customer:manage','project:view','project:manage')
WHERE r.company_id=1 AND r.role_code='onsite_staff' AND r.status=1 AND p.status=1;

-- 保持企业管理员全权限，并让原本可新增员工的 HR 主管继续拥有批量录入能力。
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r JOIN sys_permission p ON p.permission_code='employee:batch'
WHERE r.company_id=1 AND r.role_code='hr_manager' AND r.status=1 AND p.status=1;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r JOIN sys_permission p ON p.status=1
WHERE r.company_id=1 AND r.role_code='company_admin' AND r.status=1;
