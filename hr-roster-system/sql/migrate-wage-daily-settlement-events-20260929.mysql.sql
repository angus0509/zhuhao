SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS wage_daily_payment_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  payment_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  action_type VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  run_id BIGINT DEFAULT NULL,
  closure_version INT UNSIGNED NOT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  remark VARCHAR(255) DEFAULT NULL,
  operated_by BIGINT NOT NULL,
  operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_wage_daily_payment_event_request (company_id, client_request_id, employee_id),
  KEY idx_wage_daily_payment_event_lookup (company_id, project_id, shift_date, employee_id, operated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工日结状态变更事件';

SET @schema_name = DATABASE();
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='wage_calculation_daily_lines'
    AND COLUMN_NAME='attendance_closure_id')=0,
  'ALTER TABLE wage_calculation_daily_lines ADD COLUMN attendance_closure_id BIGINT DEFAULT NULL AFTER attendance_result_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='wage_calculation_daily_lines'
    AND COLUMN_NAME='attendance_closure_version')=0,
  'ALTER TABLE wage_calculation_daily_lines ADD COLUMN attendance_closure_version INT UNSIGNED DEFAULT NULL AFTER attendance_closure_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
