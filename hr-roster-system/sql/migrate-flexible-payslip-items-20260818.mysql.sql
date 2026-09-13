-- 工资表任意字段映射与工资条动态项目快照，可重复执行。
SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS salary_import_profile (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  header_signature CHAR(64) NOT NULL,
  source_headers JSON NOT NULL,
  mapping_json JSON NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  last_used_at DATETIME DEFAULT NULL,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_project_signature (company_id, project_id, header_signature),
  KEY idx_company_project_status (company_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目工资表字段映射';

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='salary_batch' AND COLUMN_NAME='import_profile_id'
);
SET @ddl = IF(@column_exists=0,
  'ALTER TABLE salary_batch ADD COLUMN import_profile_id BIGINT DEFAULT NULL COMMENT ''导入字段映射ID'' AFTER payroll_type',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='salary_batch' AND COLUMN_NAME='source_sheet_name'
);
SET @ddl = IF(@column_exists=0,
  'ALTER TABLE salary_batch ADD COLUMN source_sheet_name VARCHAR(100) DEFAULT NULL COMMENT ''原工资表工作表名称'' AFTER import_profile_id',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='salary_detail' AND COLUMN_NAME='item_snapshot'
);
SET @ddl = IF(@column_exists=0,
  'ALTER TABLE salary_detail ADD COLUMN item_snapshot JSON DEFAULT NULL COMMENT ''原工资项目快照'' AFTER net_amount',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @column_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='salary_detail' AND COLUMN_NAME='source_row_no'
);
SET @ddl = IF(@column_exists=0,
  'ALTER TABLE salary_detail ADD COLUMN source_row_no INT DEFAULT NULL COMMENT ''原工资表行号'' AFTER item_snapshot',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
