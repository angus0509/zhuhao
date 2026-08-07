-- 权限角色收敛为四类，可重复执行。
SET NAMES utf8mb4;
USE hr_roster;

SET @company_id = 1;

INSERT INTO sys_role (company_id, role_name, role_code, data_scope, status)
SELECT @company_id, '企业管理员', 'company_admin', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE company_id=@company_id AND role_code='company_admin');
INSERT INTO sys_role (company_id, role_name, role_code, data_scope, status)
SELECT @company_id, 'HR主管', 'hr_manager', 5, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE company_id=@company_id AND role_code='hr_manager');
INSERT INTO sys_role (company_id, role_name, role_code, data_scope, status)
SELECT @company_id, '驻厂专员', 'onsite_staff', 5, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE company_id=@company_id AND role_code='onsite_staff');
INSERT INTO sys_role (company_id, role_name, role_code, data_scope, status)
SELECT @company_id, '薪资专员', 'payroll_staff', 5, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE company_id=@company_id AND role_code='payroll_staff');

-- 将旧角色和同名重复角色的账号、权限、部门范围合并到四个标准角色。
INSERT IGNORE INTO sys_user_role (user_id, role_id)
SELECT ur.user_id, target.id
FROM sys_user_role ur
JOIN sys_role source ON source.id=ur.role_id AND source.company_id=@company_id
JOIN sys_role target ON target.company_id=source.company_id
 AND target.role_code=CASE
   WHEN source.role_code IN ('hr_staff','dept_leader') OR source.role_name='HR主管' THEN 'hr_manager'
   WHEN source.role_code='onsite_manager' OR source.role_name='驻厂专员' THEN 'onsite_staff'
   WHEN source.role_code='payroll_finance' OR source.role_name IN ('薪资专员','薪资财务') THEN 'payroll_staff'
   WHEN source.role_name='企业管理员' THEN 'company_admin'
 END
WHERE source.role_code NOT IN ('company_admin','hr_manager','onsite_staff','payroll_staff')
  AND (source.role_code IN ('hr_staff','dept_leader','onsite_manager','payroll_finance')
       OR source.role_name IN ('企业管理员','HR主管','驻厂专员','薪资专员','薪资财务'));

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT target.id, rp.permission_id
FROM sys_role_permission rp
JOIN sys_role source ON source.id=rp.role_id AND source.company_id=@company_id
JOIN sys_role target ON target.company_id=source.company_id
 AND target.role_code=CASE
   WHEN source.role_code IN ('hr_staff','dept_leader') OR source.role_name='HR主管' THEN 'hr_manager'
   WHEN source.role_code='onsite_manager' OR source.role_name='驻厂专员' THEN 'onsite_staff'
   WHEN source.role_code='payroll_finance' OR source.role_name IN ('薪资专员','薪资财务') THEN 'payroll_staff'
   WHEN source.role_name='企业管理员' THEN 'company_admin'
 END
WHERE source.role_code NOT IN ('company_admin','hr_manager','onsite_staff','payroll_staff')
  AND (source.role_code IN ('hr_staff','dept_leader','onsite_manager','payroll_finance')
       OR source.role_name IN ('企业管理员','HR主管','驻厂专员','薪资专员','薪资财务'));

INSERT IGNORE INTO sys_role_dept (role_id, dept_id)
SELECT target.id, rd.dept_id
FROM sys_role_dept rd
JOIN sys_role source ON source.id=rd.role_id AND source.company_id=@company_id
JOIN sys_role target ON target.company_id=source.company_id
 AND target.role_code=CASE
   WHEN source.role_code IN ('hr_staff','dept_leader') OR source.role_name='HR主管' THEN 'hr_manager'
   WHEN source.role_code='onsite_manager' OR source.role_name='驻厂专员' THEN 'onsite_staff'
   WHEN source.role_code='payroll_finance' OR source.role_name IN ('薪资专员','薪资财务') THEN 'payroll_staff'
   WHEN source.role_name='企业管理员' THEN 'company_admin'
 END
WHERE source.role_code NOT IN ('company_admin','hr_manager','onsite_staff','payroll_staff')
  AND (source.role_code IN ('hr_staff','dept_leader','onsite_manager','payroll_finance')
       OR source.role_name IN ('企业管理员','HR主管','驻厂专员','薪资专员','薪资财务'));

DELETE ur FROM sys_user_role ur
JOIN sys_role r ON r.id=ur.role_id
WHERE r.company_id=@company_id AND r.role_code NOT IN ('company_admin','hr_manager','onsite_staff','payroll_staff');
DELETE rp FROM sys_role_permission rp
JOIN sys_role r ON r.id=rp.role_id
WHERE r.company_id=@company_id AND r.role_code NOT IN ('company_admin','hr_manager','onsite_staff','payroll_staff');
DELETE rd FROM sys_role_dept rd
JOIN sys_role r ON r.id=rd.role_id
WHERE r.company_id=@company_id AND r.role_code NOT IN ('company_admin','hr_manager','onsite_staff','payroll_staff');
DELETE FROM sys_role
WHERE company_id=@company_id AND role_code NOT IN ('company_admin','hr_manager','onsite_staff','payroll_staff');

UPDATE sys_role SET role_name='企业管理员', status=1 WHERE company_id=@company_id AND role_code='company_admin';
UPDATE sys_role SET role_name='HR主管', status=1 WHERE company_id=@company_id AND role_code='hr_manager';
UPDATE sys_role SET role_name='驻厂专员', status=1 WHERE company_id=@company_id AND role_code='onsite_staff';
UPDATE sys_role SET role_name='薪资专员', status=1 WHERE company_id=@company_id AND role_code='payroll_staff';
