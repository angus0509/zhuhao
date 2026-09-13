-- 驻厂专员可在授权客户/项目范围内查看员工完整联系方式和证件信息，并可录入公司共享黑名单。
-- 迁移幂等，不修改业务数据。
SET NAMES utf8mb4;
USE hr_roster;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code IN ('employee:sensitive:view', 'blacklist:manage')
WHERE r.role_code = 'onsite_staff'
  AND r.status = 1
  AND p.status = 1;
