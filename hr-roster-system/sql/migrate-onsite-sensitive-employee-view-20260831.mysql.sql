-- 驻厂专员可在已授权客户/项目范围内查看和编辑员工身份证号、手机号等敏感信息。
-- 仅补充角色权限，幂等执行，不修改员工数据。
SET NAMES utf8mb4;
USE hr_roster;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code = 'employee:sensitive:view'
WHERE r.role_code = 'onsite_staff'
  AND r.status = 1
  AND p.status = 1;
