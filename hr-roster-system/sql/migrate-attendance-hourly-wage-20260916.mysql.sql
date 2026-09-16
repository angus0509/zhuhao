SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS attendance_project_shift_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  project_rule_id BIGINT NOT NULL,
  shift_type VARCHAR(10) NOT NULL,
  work_start_time TIME NOT NULL,
  work_end_time TIME NOT NULL,
  rest_start_time TIME DEFAULT NULL,
  rest_end_time TIME DEFAULT NULL,
  standard_minutes SMALLINT UNSIGNED NOT NULL,
  hourly_rate DECIMAL(10,2) DEFAULT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_shift_type (company_id, project_rule_id, shift_type),
  KEY idx_attendance_project_shift_lookup (company_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目白班夜班规则';

CREATE TABLE IF NOT EXISTS attendance_allowance_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  project_rule_id BIGINT NOT NULL,
  allowance_name VARCHAR(80) NOT NULL,
  shift_scope VARCHAR(10) NOT NULL,
  calculation_type VARCHAR(20) NOT NULL,
  unit_amount DECIMAL(10,2) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_allowance_rule (company_id, project_rule_id, allowance_name, shift_scope),
  KEY idx_attendance_allowance_project (company_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目考勤工资补贴规则';

CREATE TABLE IF NOT EXISTS employee_pay_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  default_shift_type VARCHAR(10) NOT NULL,
  settlement_mode VARCHAR(20) NOT NULL,
  effective_from DATE NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_employee_pay_profile_effective (company_id, project_id, employee_id, effective_from),
  KEY idx_employee_pay_profile_lookup (company_id, project_id, status, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工项目计薪规则版本';

CREATE TABLE IF NOT EXISTS wage_calculation_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  salary_month CHAR(7) NOT NULL,
  revision_no INT UNSIGNED NOT NULL,
  status VARCHAR(20) NOT NULL,
  salary_batch_id BIGINT DEFAULT NULL,
  total_earned DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_daily_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_payable DECIMAL(14,2) NOT NULL DEFAULT 0,
  blocked_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_by BIGINT DEFAULT NULL,
  confirmed_at DATETIME DEFAULT NULL,
  UNIQUE KEY uk_wage_run_revision (company_id, project_id, salary_month, revision_no),
  KEY idx_wage_run_lookup (company_id, project_id, salary_month, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤工资计算批次';

CREATE TABLE IF NOT EXISTS wage_calculation_daily_lines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  run_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  attendance_result_id BIGINT DEFAULT NULL,
  project_rule_id BIGINT DEFAULT NULL,
  project_shift_rule_id BIGINT DEFAULT NULL,
  shift_type VARCHAR(10) DEFAULT NULL,
  settlement_mode VARCHAR(20) NOT NULL,
  worked_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  approved_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  payable_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  base_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowance_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  earned_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  daily_paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  payable_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowance_snapshot JSON DEFAULT NULL,
  calculation_status VARCHAR(20) NOT NULL,
  blocked_reason VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wage_daily_line (run_id, employee_id, shift_date),
  KEY idx_wage_daily_employee (company_id, project_id, employee_id, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工每日工资计算快照';

CREATE TABLE IF NOT EXISTS wage_daily_payments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL,
  remark VARCHAR(255) DEFAULT NULL,
  paid_by BIGINT NOT NULL,
  paid_at DATETIME NOT NULL,
  revoked_by BIGINT DEFAULT NULL,
  revoked_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wage_daily_payment (company_id, project_id, employee_id, shift_date),
  KEY idx_wage_daily_payment_status (company_id, project_id, shift_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工日结支付状态';

SET @schema_name = DATABASE();

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_schedules' AND COLUMN_NAME='shift_type')=0,
  'ALTER TABLE attendance_schedules ADD COLUMN shift_type VARCHAR(10) DEFAULT NULL AFTER project_rule_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_schedules' AND COLUMN_NAME='project_shift_rule_id')=0,
  'ALTER TABLE attendance_schedules ADD COLUMN project_shift_rule_id BIGINT DEFAULT NULL AFTER shift_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_batch' AND COLUMN_NAME='source_type')=0,
  'ALTER TABLE salary_batch ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT ''IMPORT'' AFTER payroll_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_batch' AND COLUMN_NAME='calculation_run_id')=0,
  'ALTER TABLE salary_batch ADD COLUMN calculation_run_id BIGINT DEFAULT NULL AFTER source_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_batch' AND INDEX_NAME='uk_salary_batch_calculation_run')=0,
  'ALTER TABLE salary_batch ADD UNIQUE KEY uk_salary_batch_calculation_run (company_id, calculation_run_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO attendance_project_shift_rules
  (company_id,project_id,project_rule_id,shift_type,work_start_time,work_end_time,rest_start_time,rest_end_time,
   standard_minutes,hourly_rate,status,created_by,created_at,updated_by)
SELECT company_id,project_id,id,'DAY',work_start_time,work_end_time,rest_start_time,rest_end_time,
  standard_minutes,NULL,status,created_by,created_at,updated_by
FROM attendance_project_rules;
