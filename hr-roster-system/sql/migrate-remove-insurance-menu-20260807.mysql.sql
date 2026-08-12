-- 取消独立“保险提示”菜单和只读台账权限；雇主险增减继续使用 social:manage。
UPDATE sys_permission
SET status=0, permission_name=CONCAT(permission_name, IF(permission_name LIKE '%已停用%', '', '（已停用）'))
WHERE permission_code IN ('insurance:menu', 'insurance:view');

-- 保留历史角色授权关系，仅通过 sys_permission.status 停用入口。
-- 登录和权限配置查询都只读取 status=1 的权限，因此无需物理删除关系记录。

UPDATE sys_permission
SET permission_name='雇主险增减', api_path='/api/employees/:id/social-security', status=1
WHERE permission_code='social:manage';
