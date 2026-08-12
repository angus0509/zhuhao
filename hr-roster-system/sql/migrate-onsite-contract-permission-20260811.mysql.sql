-- 驻厂人员补充劳动合同登记权限。仅扩大其授权项目内的合同操作，不改变数据范围。
SET NAMES utf8mb4;
USE hr_roster;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM sys_role r
JOIN sys_permission p ON p.permission_code='contract:manage' AND p.status=1
WHERE r.role_code='onsite_staff' AND r.status=1;
