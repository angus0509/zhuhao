-- 系统账号安全删除：保留历史操作人记录，仅增加软删除标记。
SET @has_deleted_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'deleted_at'
);
SET @add_deleted_at_sql := IF(
  @has_deleted_at = 0,
  'ALTER TABLE sys_user ADD COLUMN deleted_at DATETIME DEFAULT NULL COMMENT ''软删除时间'' AFTER status',
  'SELECT ''deleted_at already exists'''
);
PREPARE stmt FROM @add_deleted_at_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_deleted_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND INDEX_NAME = 'idx_company_deleted'
);
SET @add_deleted_index_sql := IF(
  @has_deleted_index = 0,
  'ALTER TABLE sys_user ADD INDEX idx_company_deleted (company_id, deleted_at, account_type, status)',
  'SELECT ''idx_company_deleted already exists'''
);
PREPARE stmt FROM @add_deleted_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
