SET NAMES utf8mb4;
USE hr_roster;

-- 执行前请先备份数据库。本迁移用于现有生产库升级，不会删除旧字段。
ALTER TABLE hr_employee
  ADD COLUMN recruitment_source_type TINYINT DEFAULT NULL COMMENT '1招聘人 2供应商' AFTER channel_source,
  ADD COLUMN recruiter_id BIGINT DEFAULT NULL COMMENT '招聘人ID' AFTER recruitment_source_type,
  ADD COLUMN supplier_id BIGINT DEFAULT NULL COMMENT '供应商ID' AFTER recruiter_id,
  ADD COLUMN source_locked TINYINT NOT NULL DEFAULT 0 COMMENT '来源锁定' AFTER supplier_id,
  ADD COLUMN source_confirmed_at DATETIME DEFAULT NULL COMMENT '来源确认时间' AFTER source_locked,
  ADD COLUMN lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT '生命周期状态' AFTER employee_status,
  ADD COLUMN arrival_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT '到岗状态' AFTER lifecycle_status,
  ADD COLUMN insurance_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT '保险状态' AFTER arrival_status,
  ADD COLUMN contract_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT '合同状态' AFTER insurance_status,
  ADD COLUMN document_status VARCHAR(30) NOT NULL DEFAULT 'INCOMPLETE' COMMENT '资料状态' AFTER contract_status,
  ADD COLUMN risk_level TINYINT NOT NULL DEFAULT 1 COMMENT '风险等级' AFTER document_status,
  ADD INDEX idx_company_lifecycle (company_id, lifecycle_status),
  ADD INDEX idx_company_recruiter (company_id, recruiter_id),
  ADD INDEX idx_company_supplier (company_id, supplier_id);

ALTER TABLE hr_employee_job
  ADD COLUMN project_id BIGINT DEFAULT NULL COMMENT '所属用工项目ID' AFTER customer_id,
  ADD INDEX idx_company_project_job (company_id, project_id, job_status);

UPDATE hr_employee_job j
SET project_id=(SELECT MIN(p.id) FROM labor_project p WHERE p.company_id=j.company_id AND p.customer_id=j.customer_id)
WHERE project_id IS NULL AND customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hr_employee_change (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  change_type VARCHAR(20) NOT NULL,
  source_project_id BIGINT DEFAULT NULL,
  target_project_id BIGINT DEFAULT NULL,
  target_customer_id BIGINT DEFAULT NULL,
  target_position_id BIGINT DEFAULT NULL,
  effective_date DATE NOT NULL,
  reason_text VARCHAR(500) DEFAULT NULL,
  change_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  created_by BIGINT DEFAULT NULL,
  handled_by BIGINT DEFAULT NULL,
  handled_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_change (company_id, employee_id, change_status),
  INDEX idx_target_project_change (company_id, target_project_id, change_status)
) COMMENT='员工转岗与离职异动单';

CREATE TABLE IF NOT EXISTS hr_recruiter (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  recruiter_no VARCHAR(32) NOT NULL,
  recruiter_name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  user_id BIGINT DEFAULT NULL,
  primary_project_id BIGINT DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_recruiter_no (company_id, recruiter_no),
  INDEX idx_company_recruiter_status (company_id, status)
) COMMENT='招聘人表';

CREATE TABLE IF NOT EXISTS hr_recruitment_supplier (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  supplier_no VARCHAR(32) NOT NULL,
  supplier_name VARCHAR(150) NOT NULL,
  credit_code VARCHAR(32) DEFAULT NULL,
  contact_name VARCHAR(50) DEFAULT NULL,
  contact_phone VARCHAR(20) DEFAULT NULL,
  contract_start_date DATE DEFAULT NULL,
  contract_end_date DATE DEFAULT NULL,
  risk_level TINYINT NOT NULL DEFAULT 1,
  status TINYINT NOT NULL DEFAULT 1,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_supplier_no (company_id, supplier_no),
  INDEX idx_company_supplier_status (company_id, status, contract_end_date)
) COMMENT='招聘供应商表';

CREATE TABLE IF NOT EXISTS hr_work_task (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT DEFAULT NULL,
  project_id BIGINT DEFAULT NULL,
  task_type VARCHAR(50) NOT NULL,
  task_title VARCHAR(150) NOT NULL,
  task_content VARCHAR(500) DEFAULT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_id BIGINT DEFAULT NULL,
  risk_level TINYINT NOT NULL DEFAULT 1,
  task_status TINYINT NOT NULL DEFAULT 0,
  assigned_user_id BIGINT DEFAULT NULL,
  deadline DATETIME DEFAULT NULL,
  completed_by BIGINT DEFAULT NULL,
  completed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_active_task (company_id, employee_id, task_type, source_type, source_id, task_status),
  INDEX idx_assignee_status (company_id, assigned_user_id, task_status, deadline),
  INDEX idx_employee_task (company_id, employee_id, task_status)
) COMMENT='驻厂业务统一待办表';

ALTER TABLE hr_resignation
  ADD COLUMN badge_returned TINYINT NOT NULL DEFAULT 0 COMMENT '工牌已归还' AFTER handover_status,
  ADD COLUMN tools_returned TINYINT NOT NULL DEFAULT 0 COMMENT '工服工具已归还' AFTER badge_returned,
  ADD COLUMN dorm_cleared TINYINT NOT NULL DEFAULT 0 COMMENT '宿舍已清退' AFTER tools_returned,
  ADD COLUMN attendance_confirmed TINYINT NOT NULL DEFAULT 0 COMMENT '考勤已确认' AFTER dorm_cleared,
  ADD COLUMN completed_by BIGINT DEFAULT NULL COMMENT '离职闭环完成人' AFTER risk_remark,
  ADD COLUMN completed_at DATETIME DEFAULT NULL COMMENT '离职闭环时间' AFTER completed_by;

UPDATE hr_employee
SET lifecycle_status = CASE employee_status
  WHEN 1 THEN 'PENDING_ARRIVAL'
  WHEN 2 THEN 'ACTIVE'
  WHEN 3 THEN 'LEFT'
  ELSE 'DRAFT'
END,
arrival_status = CASE WHEN employee_status = 2 THEN 'CONFIRMED' ELSE 'PENDING' END;

UPDATE sys_role SET role_name='驻厂人员' WHERE role_code='onsite_staff';
