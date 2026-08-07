-- 为员工主表补充渠道来源和创建人字段，可重复执行。
SET NAMES utf8mb4;
USE hr_roster;

SET @channel_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hr_employee' AND COLUMN_NAME = 'channel_source'
);
SET @channel_sql = IF(
  @channel_exists = 0,
  'ALTER TABLE hr_employee ADD COLUMN channel_source VARCHAR(80) DEFAULT NULL COMMENT ''渠道来源'' AFTER emergency_phone',
  'SELECT ''channel_source already exists'''
);
PREPARE channel_stmt FROM @channel_sql;
EXECUTE channel_stmt;
DEALLOCATE PREPARE channel_stmt;

SET @createdby_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hr_employee' AND COLUMN_NAME = 'created_by'
);
SET @createdby_sql = IF(
  @createdby_exists = 0,
  'ALTER TABLE hr_employee ADD COLUMN created_by BIGINT DEFAULT NULL COMMENT ''录入人'' AFTER employee_status',
  'SELECT ''created_by already exists'''
);
PREPARE createdby_stmt FROM @createdby_sql;
EXECUTE createdby_stmt;
DEALLOCATE PREPARE createdby_stmt;
