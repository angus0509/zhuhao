-- 工资条员工端查看策略：幂等新增，不删除历史数据。
SET @db_name = DATABASE();

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='salary_batch' AND COLUMN_NAME='employee_view_enabled') = 0,
  'ALTER TABLE salary_batch ADD COLUMN employee_view_enabled TINYINT NOT NULL DEFAULT 1 COMMENT ''员工端是否允许查看工资条'' AFTER source_sheet_name',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='salary_batch' AND COLUMN_NAME='view_once') = 0,
  'ALTER TABLE salary_batch ADD COLUMN view_once TINYINT NOT NULL DEFAULT 0 COMMENT ''是否阅后即焚：首次查看后不可再次打开'' AFTER employee_view_enabled',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=@db_name AND TABLE_NAME='salary_batch' AND COLUMN_NAME='view_expires_minutes') = 0,
  'ALTER TABLE salary_batch ADD COLUMN view_expires_minutes INT DEFAULT NULL COMMENT ''员工端查看有效期，NULL表示不限制'' AFTER view_once',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE salary_batch
SET employee_view_enabled=COALESCE(employee_view_enabled,1),
    view_once=COALESCE(view_once,0)
WHERE employee_view_enabled IS NULL OR view_once IS NULL;
