-- 工资条电子回执双存储模式，可重复执行；不改写历史FILE回执数据。
SET NAMES utf8mb4;
USE hr_roster;

SET @schema_name = DATABASE();

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt' AND COLUMN_NAME='storage_mode')=0,
  'ALTER TABLE salary_evidence_receipt ADD COLUMN storage_mode VARCHAR(20) NOT NULL DEFAULT ''FILE'' COMMENT ''FILE历史文件 DYNAMIC动态生成'' AFTER receipt_payload',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt' AND COLUMN_NAME='receipt_payload_hmac')=0,
  'ALTER TABLE salary_evidence_receipt ADD COLUMN receipt_payload_hmac CHAR(64) NULL COMMENT ''动态回执固定载荷HMAC-SHA256'' AFTER receipt_payload',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt' AND COLUMN_NAME='receipt_payload_key_version')=0,
  'ALTER TABLE salary_evidence_receipt ADD COLUMN receipt_payload_key_version VARCHAR(20) NULL COMMENT ''动态回执载荷HMAC密钥版本'' AFTER receipt_payload_hmac',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt' AND COLUMN_NAME='storage_path' AND IS_NULLABLE='NO')=1,
  'ALTER TABLE salary_evidence_receipt MODIFY COLUMN storage_path VARCHAR(500) NULL COMMENT ''FILE模式企业私有相对存储路径''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt' AND COLUMN_NAME='receipt_sha256' AND IS_NULLABLE='NO')=1,
  'ALTER TABLE salary_evidence_receipt MODIFY COLUMN receipt_sha256 CHAR(64) NULL COMMENT ''FILE模式PDF文件SHA-256''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt'
    AND CONSTRAINT_NAME='chk_salary_evidence_receipt_storage' AND CONSTRAINT_TYPE='CHECK')=0,
  'ALTER TABLE salary_evidence_receipt ADD CONSTRAINT chk_salary_evidence_receipt_storage CHECK ((storage_mode = ''FILE'' AND storage_path IS NOT NULL AND receipt_sha256 IS NOT NULL) OR (storage_mode = ''DYNAMIC'' AND storage_path IS NULL AND receipt_sha256 IS NULL))',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt'
    AND CONSTRAINT_NAME='chk_salary_evidence_receipt_dynamic_key' AND CONSTRAINT_TYPE='CHECK')=0,
  'ALTER TABLE salary_evidence_receipt ADD CONSTRAINT chk_salary_evidence_receipt_dynamic_key CHECK (storage_mode <> ''DYNAMIC'' OR receipt_payload_key_version IS NOT NULL)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=@schema_name AND TABLE_NAME='salary_evidence_receipt'
    AND CONSTRAINT_NAME='chk_salary_evidence_receipt_dynamic_hmac' AND CONSTRAINT_TYPE='CHECK')=0,
  'ALTER TABLE salary_evidence_receipt ADD CONSTRAINT chk_salary_evidence_receipt_dynamic_hmac CHECK (storage_mode <> ''DYNAMIC'' OR receipt_payload_hmac IS NOT NULL)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
