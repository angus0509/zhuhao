SET NAMES utf8mb4;

USE hr_roster;

INSERT INTO hr_company
(id, company_name, unified_credit_code, contact_name, contact_phone, status)
VALUES
(1, '示例制造企业', '91330000XXXXXXXXXX', '企业管理员', '13800000000', 1)
ON DUPLICATE KEY UPDATE company_name = VALUES(company_name);

INSERT INTO hr_department
(id, company_id, parent_id, dept_name, dept_code, sort_no, status)
VALUES
(1, 1, 0, '总经办', 'CEO', 1, 1),
(2, 1, 0, '人力资源部', 'HR', 2, 1),
(3, 1, 0, '生产一部', 'MFG-1', 3, 1),
(4, 1, 0, '品质管理部', 'QA', 4, 1)
ON DUPLICATE KEY UPDATE dept_name = VALUES(dept_name), status = VALUES(status);

INSERT INTO hr_position
(id, company_id, position_name, position_code, risk_level, is_special_work, status)
VALUES
(1, 1, 'HR专员', 'HR-S', 1, 0, 1),
(2, 1, '普工', 'OP', 1, 0, 1),
(3, 1, '焊接工', 'WELD', 3, 1, 1),
(4, 1, '质检员', 'QC', 2, 0, 1),
(5, 1, '生产班长', 'LEAD', 2, 0, 1)
ON DUPLICATE KEY UPDATE position_name = VALUES(position_name), status = VALUES(status);

INSERT INTO hr_employee
(id, company_id, employee_no, name, gender, id_card_no, phone, education, bank_name, bank_card_no,
 emergency_contact, emergency_phone, employee_status)
VALUES
(1, 1, 'YG202607001', '张三', 1, '330100199001010000', '13800000000', '高中/中专', '中国工商银行', '6222000000000000000', '李四', '13900000000', 2),
(2, 1, 'YG202607002', '王芳', 2, '330100199202020000', '13700000000', '大专', '中国建设银行', '6217000000000000000', '王强', '13600000000', 2),
(3, 1, 'YG202607003', '陈强', 1, '330100198803030000', '13500000000', '初中及以下', '中国农业银行', '6228480000000000000', '陈丽', '13400000000', 2),
(4, 1, 'YG202607004', '刘敏', 2, '330100199505050000', '13300000000', '本科', NULL, NULL, NULL, NULL, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), employee_status = VALUES(employee_status);

INSERT INTO hr_employee_job
(id, company_id, employee_id, dept_id, position_id, employment_type, fee_mode, work_type, hire_date, job_status)
VALUES
(1, 1, 1, 3, 2, 1, '', 1, '2026-06-01', 1),
(2, 1, 2, 4, 4, 1, '', 1, '2026-04-15', 1),
(3, 1, 3, 3, 3, 1, '', 3, '2026-05-20', 1),
(4, 1, 4, 2, 1, 4, '', 1, '2026-07-10', 1)
ON DUPLICATE KEY UPDATE dept_id = VALUES(dept_id), position_id = VALUES(position_id), job_status = VALUES(job_status);

INSERT INTO hr_labor_contract
(id, company_id, employee_id, contract_no, contract_type, sign_status, sign_date, start_date, end_date, renewal_count)
VALUES
(1, 1, 1, 'HT202607001', 1, 1, '2026-06-01', '2026-06-01', '2027-05-31', 0),
(2, 1, 2, 'HT202607002', 1, 1, '2026-04-15', '2026-04-15', '2026-07-25', 0),
(3, 1, 3, 'HT202607003', 1, 0, NULL, '2026-05-20', '2027-05-19', 0)
ON DUPLICATE KEY UPDATE sign_status = VALUES(sign_status), end_date = VALUES(end_date);

INSERT INTO hr_social_security
(id, company_id, employee_id, social_status, social_city, social_base, fund_status, fund_base, start_month)
VALUES
(1, 1, 1, 1, '杭州', 5200.00, 1, 5200.00, '2026-06'),
(2, 1, 2, 1, '杭州', 6200.00, 1, 6200.00, '2026-04'),
(3, 1, 3, 0, NULL, 0.00, 0, 0.00, NULL)
ON DUPLICATE KEY UPDATE social_status = VALUES(social_status), social_base = VALUES(social_base);

INSERT INTO hr_employee_certificate
(id, company_id, employee_id, cert_type, cert_no, issue_date, expire_date, verify_status)
VALUES
(1, 1, 1, 1, '330100199001010000', '2010-01-01', '2030-01-01', 1),
(2, 1, 2, 2, 'JK20260415', '2026-04-15', '2026-07-22', 1),
(3, 1, 3, 1, '330100198803030000', '2010-01-01', '2030-01-01', 1)
ON DUPLICATE KEY UPDATE expire_date = VALUES(expire_date), verify_status = VALUES(verify_status);

INSERT INTO hr_recruiter
(id, company_id, recruiter_no, recruiter_name, phone, status, created_by)
VALUES
(1, 1, 'ZP001', '李明', '13800138001', 1, 1)
ON DUPLICATE KEY UPDATE recruiter_name=VALUES(recruiter_name), phone=VALUES(phone), status=VALUES(status);

INSERT INTO hr_recruitment_supplier
(id, company_id, supplier_no, supplier_name, contact_name, contact_phone, contract_start_date, contract_end_date, risk_level, status, created_by)
VALUES
(1, 1, 'GYS001', '优才人力有限公司', '王经理', '13800138002', '2026-01-01', '2026-12-31', 1, 1)
ON DUPLICATE KEY UPDATE supplier_name=VALUES(supplier_name), contract_end_date=VALUES(contract_end_date), status=VALUES(status);

INSERT INTO sys_permission
(id, permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
VALUES
(1, '员工管理', 'employee:menu', 1, 0, '/hr/employees', NULL, 10, 1),
(2, '查看员工', 'employee:view', 2, 1, NULL, '/api/employees', 11, 1),
(3, '新增员工', 'employee:create', 2, 1, NULL, '/api/employees', 12, 1),
(4, '编辑员工', 'employee:update', 2, 1, NULL, '/api/employees/:id', 13, 1),
(5, '员工调岗', 'employee:transfer', 2, 1, NULL, '/api/employees/:id/job-transfer', 14, 1),
(6, '员工离职', 'employee:resign', 2, 1, NULL, '/api/employees/:id/resign', 15, 1),
(7, '导出员工', 'employee:export', 2, 1, NULL, '/api/export/employees.csv', 16, 1),
(8, '用工风险中心', 'risk:menu', 1, 0, '/hr/risks', NULL, 20, 1),
(9, '查看风险', 'risk:view', 2, 8, NULL, '/api/risk-alerts', 21, 1),
(10, '扫描风险', 'risk:scan', 2, 8, NULL, '/api/risk-alerts/scan', 22, 1),
(11, '处理风险', 'risk:handle', 2, 8, NULL, '/api/risk-alerts/:id/handle', 23, 1),
(12, '合同管理', 'contract:manage', 2, 1, NULL, '/api/employees/:id/contracts', 30, 1),
(13, '雇主险增减', 'social:manage', 2, 1, NULL, '/api/employees/:id/social-security', 31, 1),
(14, '证件管理', 'cert:manage', 2, 1, NULL, '/api/employees/:id/certificates', 32, 1),
(15, '系统管理', 'system:menu', 1, 0, '/system', NULL, 90, 1),
(16, '角色权限管理', 'system:role', 2, 15, NULL, '/api/system/roles', 91, 1),
(17, '客户查看', 'customer:view', 2, 0, NULL, '/api/customers', 40, 1),
(18, '客户管理', 'customer:manage', 2, 0, NULL, '/api/customers', 41, 1),
(19, '项目查看', 'project:view', 2, 0, NULL, '/api/projects', 42, 1),
(20, '项目管理', 'project:manage', 2, 0, NULL, '/api/projects', 43, 1),
(21, '驻厂人员查看', 'factory:view', 2, 0, NULL, '/api/factory-staff', 44, 1),
(22, '驻厂人员管理', 'factory:manage', 2, 0, NULL, '/api/factory-staff', 45, 1),
(23, '黑名单查看', 'blacklist:view', 2, 0, NULL, '/api/blacklist', 50, 1),
(24, '黑名单管理', 'blacklist:manage', 2, 0, NULL, '/api/blacklist', 51, 1),
(25, '预支查看', 'advance:view', 2, 0, NULL, '/api/advances', 60, 1),
(26, '预支申请', 'advance:create', 2, 0, NULL, '/api/advances', 61, 1),
(27, '预支审批', 'advance:approve', 2, 0, NULL, '/api/advances/:id/approve', 62, 1),
(28, '预支放款', 'advance:pay', 2, 0, NULL, '/api/advances/:id/pay', 63, 1),
(29, '工资查看', 'payroll:view', 2, 0, NULL, '/api/payroll/overview', 70, 1),
(30, '工资批次管理与发布', 'payroll:manage', 2, 0, NULL, '/api/payroll/batches', 71, 1),
(31, '查看员工敏感信息', 'employee:sensitive:view', 2, 1, NULL, '/api/employees/:id?showSensitive=1', 17, 1),
(32, '工资批次复核', 'payroll:review', 2, 0, NULL, '/api/payroll/batches/:id/review', 72, 1),
(53, '批量录入员工', 'employee:batch', 2, 1, NULL, '/api/employees/batch', 12, 1),
(54, '保险查看（已停用）', 'insurance:view', 2, 0, NULL, '/api/insurance/overview', 46, 0),
(55, '操作日志查看', 'audit:view', 2, 0, NULL, '/api/audit-logs', 86, 1)
ON DUPLICATE KEY UPDATE permission_name = VALUES(permission_name), status = VALUES(status);

INSERT INTO sys_role
(id, company_id, role_name, role_code, data_scope, status)
VALUES
(1, 1, '企业管理员', 'company_admin', 1, 1),
(2, 1, 'HR主管', 'hr_manager', 2, 1),
(3, 1, '驻厂人员', 'onsite_staff', 5, 1),
(4, 1, '薪资专员', 'payroll_staff', 5, 1)
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name), role_code = VALUES(role_code), data_scope = VALUES(data_scope), status = VALUES(status);

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT 1, id FROM sys_permission;

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT 2, id FROM sys_permission
WHERE permission_code IN (
  'employee:menu', 'employee:view', 'employee:create', 'employee:update', 'employee:transfer',
  'employee:batch', 'employee:resign', 'employee:export', 'contract:manage', 'social:manage', 'cert:manage',
  'employee:sensitive:view', 'risk:menu', 'risk:view', 'risk:scan', 'risk:handle',
  'customer:view', 'project:view', 'factory:view', 'blacklist:view',
  'advance:view', 'advance:approve', 'payroll:view', 'payroll:review',
  'audit:view'
);

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT 3, id FROM sys_permission
WHERE permission_code IN (
  'employee:menu', 'employee:view', 'employee:create', 'employee:batch', 'employee:update',
  'employee:transfer', 'employee:resign', 'contract:manage', 'social:manage',
  'customer:view', 'customer:manage', 'project:view', 'project:manage',
  'factory:view', 'factory:manage', 'blacklist:view',
  'advance:view', 'advance:create'
);

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT 4, id FROM sys_permission
WHERE permission_code IN ('employee:view', 'project:view', 'advance:view', 'advance:approve', 'advance:pay', 'payroll:view', 'payroll:manage');

-- 部门范围角色默认覆盖示例公司的现有部门；企业管理员可在后台缩小授权范围。
INSERT IGNORE INTO sys_role_dept (role_id, dept_id)
SELECT r.id, d.id FROM sys_role r
JOIN hr_department d ON d.company_id=r.company_id AND d.status=1
WHERE r.company_id=1 AND r.role_code = 'hr_manager';

INSERT INTO sys_user
(id, company_id, username, password_hash, real_name, phone, employee_id, status)
VALUES
(1, 1, 'admin', 'pbkdf2$120000$hr-roster-admin-2026$tt7eDveQX2fRZp7kr/bzRU+hoYxTyyZN97cf5+ZlpCc=', '企业管理员', '13800000000', NULL, 1)
ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), real_name = VALUES(real_name), status = VALUES(status);

INSERT IGNORE INTO sys_user_role (user_id, role_id)
VALUES (1, 1);
