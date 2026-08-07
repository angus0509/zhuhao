-- 账号会话撤销版本字段，可重复执行；使用 information_schema + PREPARE，兼容 MySQL 5.7/8.0。
SET NAMES utf8mb4;
USE hr_roster;

SET @token_version_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sys_user'
    AND COLUMN_NAME = 'token_version'
);
SET @token_version_sql = IF(
  @token_version_exists = 0,
  'ALTER TABLE sys_user ADD COLUMN token_version INT NOT NULL DEFAULT 0 COMMENT ''会话撤销版本，密码或权限变化时递增'' AFTER employee_id',
  'SELECT ''token_version already exists'''
);
PREPARE token_version_stmt FROM @token_version_sql;
EXECUTE token_version_stmt;
DEALLOCATE PREPARE token_version_stmt;
