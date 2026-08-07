-- 驻厂人员补充员工编辑权限。幂等执行，不修改其余已配置权限。
SET NAMES utf8mb4;
USE hr_roster;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code='employee:update' AND p.status=1
WHERE r.role_code='onsite_staff' AND r.status=1;
