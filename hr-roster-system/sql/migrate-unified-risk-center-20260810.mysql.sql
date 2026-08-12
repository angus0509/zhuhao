-- 合并“风险预警”和“风险整改”为唯一的“用工风险中心”，可重复执行。
-- 保留旧角色已有授权：凡拥有 riskCase:menu 的角色，自动补充 risk:menu。
SET NAMES utf8mb4;
USE hr_roster;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT old_rp.role_id, new_p.id
FROM sys_role_permission old_rp
JOIN sys_permission old_p
  ON old_p.id=old_rp.permission_id
 AND old_p.permission_code='riskCase:menu'
JOIN sys_permission new_p
  ON new_p.permission_code='risk:menu'
WHERE new_p.status=1;

UPDATE sys_permission
SET permission_name='用工风险中心',
    route_path='/hr/risks',
    sort_no=20,
    status=1
WHERE permission_code='risk:menu';

UPDATE sys_permission
SET permission_name='风险整改（已合并）',
    status=0
WHERE permission_code='riskCase:menu';
