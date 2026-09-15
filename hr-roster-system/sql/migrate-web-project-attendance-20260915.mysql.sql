SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS attendance_project_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  rule_name VARCHAR(100) NOT NULL,
  work_start_time TIME NOT NULL,
  work_end_time TIME NOT NULL,
  rest_start_time TIME DEFAULT NULL,
  rest_end_time TIME DEFAULT NULL,
  standard_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 480,
  late_grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  early_grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  overtime_min_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  work_weekdays VARCHAR(20) NOT NULL,
  effective_from DATE NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_rule_effective (company_id, project_id, effective_from),
  KEY idx_attendance_project_rule_lookup (company_id, project_id, status, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_project_calendar (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  calendar_date DATE NOT NULL,
  day_type VARCHAR(20) NOT NULL,
  remark VARCHAR(255) DEFAULT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_calendar_date (company_id, project_id, calendar_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_project_geofence (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  geofence_id BIGINT NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_geofence (company_id, project_id, geofence_id),
  KEY idx_attendance_project_geofence_lookup (company_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @schema_name = DATABASE();
SET @table_name = 'attendance_geofences';
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='customer_id')=0,
  'ALTER TABLE attendance_geofences ADD COLUMN customer_id BIGINT DEFAULT NULL AFTER company_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='updated_by')=0,
  'ALTER TABLE attendance_geofences ADD COLUMN updated_by BIGINT DEFAULT NULL AFTER created_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_geofences' AND COLUMN_NAME='project_id' AND IS_NULLABLE='NO')=1,
  'ALTER TABLE attendance_geofences MODIFY COLUMN project_id BIGINT DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE attendance_geofences g
JOIN labor_project p ON p.id=g.project_id AND p.company_id=g.company_id
SET g.customer_id=p.customer_id
WHERE g.customer_id IS NULL;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND INDEX_NAME='idx_attendance_geofence_customer')=0,
  'ALTER TABLE attendance_geofences ADD KEY idx_attendance_geofence_customer (company_id, customer_id, status)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND INDEX_NAME='uk_attendance_geofence_customer_name')=0
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT company_id, customer_id, fence_name
      FROM attendance_geofences
      WHERE customer_id IS NOT NULL
      GROUP BY company_id, customer_id, fence_name
      HAVING COUNT(*) > 1
    ) duplicate_fence
  ),
  'ALTER TABLE attendance_geofences ADD UNIQUE KEY uk_attendance_geofence_customer_name (company_id, customer_id, fence_name)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO attendance_project_geofence (company_id, project_id, geofence_id, status, created_by, created_at)
SELECT g.company_id, g.project_id, g.id, g.status, g.created_by, g.created_at
FROM attendance_geofences g
JOIN labor_project p ON p.id=g.project_id AND p.company_id=g.company_id AND p.customer_id=g.customer_id
WHERE g.project_id IS NOT NULL;

SET @table_name = 'attendance_schedules';
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_schedules' AND COLUMN_NAME='project_id')=0,
  'ALTER TABLE attendance_schedules ADD COLUMN project_id BIGINT DEFAULT NULL AFTER company_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_schedules' AND COLUMN_NAME='project_rule_id')=0,
  'ALTER TABLE attendance_schedules ADD COLUMN project_rule_id BIGINT DEFAULT NULL AFTER shift_rule_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_schedules' AND COLUMN_NAME='shift_rule_id' AND IS_NULLABLE='NO')=1,
  'ALTER TABLE attendance_schedules MODIFY COLUMN shift_rule_id BIGINT DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@schema_name AND TABLE_NAME='attendance_schedules' AND CONSTRAINT_NAME='chk_attendance_schedule_rule_source')=0,
  'ALTER TABLE attendance_schedules ADD CONSTRAINT chk_attendance_schedule_rule_source CHECK ((shift_rule_id IS NOT NULL) <> (project_rule_id IS NOT NULL))', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND INDEX_NAME='idx_attendance_schedule_project_date')=0,
  'ALTER TABLE attendance_schedules ADD KEY idx_attendance_schedule_project_date (company_id, project_id, shift_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @table_name = 'attendance_punches';
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_punches' AND COLUMN_NAME='project_id')=0,
  'ALTER TABLE attendance_punches ADD COLUMN project_id BIGINT DEFAULT NULL AFTER company_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND INDEX_NAME='idx_attendance_punch_project_date')=0,
  'ALTER TABLE attendance_punches ADD KEY idx_attendance_punch_project_date (company_id, project_id, shift_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @table_name = 'attendance_daily_results';
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='attendance_daily_results' AND COLUMN_NAME='project_id')=0,
  'ALTER TABLE attendance_daily_results ADD COLUMN project_id BIGINT DEFAULT NULL AFTER company_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND INDEX_NAME='idx_attendance_daily_project_date')=0,
  'ALTER TABLE attendance_daily_results ADD KEY idx_attendance_daily_project_date (company_id, project_id, shift_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
