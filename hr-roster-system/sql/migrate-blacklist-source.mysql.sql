-- 补充黑名单来源名称，兼容非系统项目来源；可重复执行。
SET @source_name_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'person_blacklist'
    AND COLUMN_NAME = 'source_name'
);
SET @source_name_sql = IF(
  @source_name_exists = 0,
  'ALTER TABLE person_blacklist ADD COLUMN source_name VARCHAR(100) DEFAULT NULL COMMENT ''来源项目或单位名称'' AFTER source_project_id',
  'SELECT ''source_name already exists'''
);
PREPARE source_name_stmt FROM @source_name_sql;
EXECUTE source_name_stmt;
DEALLOCATE PREPARE source_name_stmt;
