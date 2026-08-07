-- 取消独立“保险提示”菜单和只读台账权限；雇主险增减继续使用 social:manage。
UPDATE sys_permission
SET status=0, permission_name=CONCAT(permission_name, IF(permission_name LIKE '%已停用%', '', '（已停用）'))
WHERE permission_code IN ('insurance:menu', 'insurance:view');

DELETE rp
FROM sys_role_permission rp
JOIN sys_permission p ON p.id=rp.permission_id
WHERE p.permission_code IN ('insurance:menu', 'insurance:view');

UPDATE sys_permission
SET permission_name='雇主险增减', api_path='/api/employees/:id/social-security', status=1
WHERE permission_code='social:manage';
