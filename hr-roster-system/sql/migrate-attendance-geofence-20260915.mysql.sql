SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS attendance_geofences (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  fence_name VARCHAR(100) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  radius_meters INT UNSIGNED NOT NULL DEFAULT 300,
  max_accuracy_meters INT UNSIGNED NOT NULL DEFAULT 100,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_geofence_name (company_id, project_id, fence_name),
  KEY idx_attendance_geofence_project (company_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤项目电子围栏';

SET @schema_name = DATABASE();
SET @table_name = 'attendance_punches';

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='geofence_id')=0,
  'ALTER TABLE attendance_punches ADD COLUMN geofence_id BIGINT DEFAULT NULL AFTER source', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @table_name = 'attendance_correction_requests';
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='punch_id')=0,
  'ALTER TABLE attendance_correction_requests ADD COLUMN punch_id BIGINT DEFAULT NULL AFTER request_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND INDEX_NAME='uk_attendance_correction_punch')=0,
  'ALTER TABLE attendance_correction_requests ADD UNIQUE KEY uk_attendance_correction_punch (company_id, punch_id, request_type)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @table_name = 'attendance_punches';
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='latitude')=0,
  'ALTER TABLE attendance_punches ADD COLUMN latitude DECIMAL(10,7) DEFAULT NULL AFTER geofence_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='longitude')=0,
  'ALTER TABLE attendance_punches ADD COLUMN longitude DECIMAL(10,7) DEFAULT NULL AFTER latitude', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='location_accuracy')=0,
  'ALTER TABLE attendance_punches ADD COLUMN location_accuracy DECIMAL(10,2) DEFAULT NULL AFTER longitude', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='distance_meters')=0,
  'ALTER TABLE attendance_punches ADD COLUMN distance_meters INT UNSIGNED DEFAULT NULL AFTER location_accuracy', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='geofence_radius_snapshot')=0,
  'ALTER TABLE attendance_punches ADD COLUMN geofence_radius_snapshot INT UNSIGNED DEFAULT NULL AFTER distance_meters', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='geofence_status')=0,
  'ALTER TABLE attendance_punches ADD COLUMN geofence_status VARCHAR(30) NOT NULL DEFAULT ''NO_FENCE'' AFTER geofence_radius_snapshot', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME=@table_name AND COLUMN_NAME='location_reason')=0,
  'ALTER TABLE attendance_punches ADD COLUMN location_reason VARCHAR(255) DEFAULT NULL AFTER geofence_status', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
