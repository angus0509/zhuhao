-- 工资条自有证据链结构，可重复执行；不改写历史工资条和证据。
SET NAMES utf8mb4;
USE hr_roster;

SET @schema_name = DATABASE();

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_detail' AND COLUMN_NAME='evidence_schema_version')=0,
  'ALTER TABLE salary_detail ADD COLUMN evidence_schema_version VARCHAR(20) DEFAULT NULL COMMENT ''证据快照结构版本'' AFTER receipt_at', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_detail' AND COLUMN_NAME='evidence_snapshot')=0,
  'ALTER TABLE salary_detail ADD COLUMN evidence_snapshot JSON DEFAULT NULL COMMENT ''员工实际签收的工资条快照'' AFTER evidence_schema_version', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_detail' AND COLUMN_NAME='evidence_content_sha256')=0,
  'ALTER TABLE salary_detail ADD COLUMN evidence_content_sha256 CHAR(64) DEFAULT NULL COMMENT ''工资条快照SHA-256'' AFTER evidence_snapshot', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_detail' AND COLUMN_NAME='evidence_created_at')=0,
  'ALTER TABLE salary_detail ADD COLUMN evidence_created_at DATETIME DEFAULT NULL COMMENT ''证据快照生成时间'' AFTER evidence_content_sha256', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_detail' AND INDEX_NAME='idx_evidence_content_sha256')=0,
  'ALTER TABLE salary_detail ADD KEY idx_evidence_content_sha256 (company_id,evidence_content_sha256)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_signature' AND COLUMN_NAME='challenge_id')=0,
  'ALTER TABLE salary_signature ADD COLUMN challenge_id BIGINT DEFAULT NULL COMMENT ''一次性签收挑战记录ID'' AFTER statement_version', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_signature' AND INDEX_NAME='idx_challenge')=0,
  'ALTER TABLE salary_signature ADD KEY idx_challenge (company_id,challenge_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_receipt_log' AND COLUMN_NAME='previous_evidence_hash')=0,
  'ALTER TABLE salary_receipt_log ADD COLUMN previous_evidence_hash CHAR(64) DEFAULT NULL COMMENT ''上一条证据日志摘要'' AFTER evidence_hash', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_receipt_log' AND COLUMN_NAME='payslip_content_sha256')=0,
  'ALTER TABLE salary_receipt_log ADD COLUMN payslip_content_sha256 CHAR(64) DEFAULT NULL COMMENT ''工资条内容摘要'' AFTER previous_evidence_hash', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_receipt_log' AND COLUMN_NAME='signature_sha256')=0,
  'ALTER TABLE salary_receipt_log ADD COLUMN signature_sha256 CHAR(64) DEFAULT NULL COMMENT ''签名文件摘要'' AFTER payslip_content_sha256', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_receipt_log' AND COLUMN_NAME='challenge_id')=0,
  'ALTER TABLE salary_receipt_log ADD COLUMN challenge_id BIGINT DEFAULT NULL COMMENT ''一次性签收挑战记录ID'' AFTER signature_sha256', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_receipt_log' AND COLUMN_NAME='statement_version')=0,
  'ALTER TABLE salary_receipt_log ADD COLUMN statement_version VARCHAR(20) DEFAULT NULL COMMENT ''签收声明版本'' AFTER challenge_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_receipt_log' AND COLUMN_NAME='evidence_key_version')=0,
  'ALTER TABLE salary_receipt_log ADD COLUMN evidence_key_version VARCHAR(20) DEFAULT NULL COMMENT ''证据HMAC密钥版本'' AFTER statement_version', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='salary_receipt_log' AND INDEX_NAME='idx_evidence_chain')=0,
  'ALTER TABLE salary_receipt_log ADD KEY idx_evidence_chain (company_id,salary_detail_id,employee_id,id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS salary_sign_challenge (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资条一次性签收挑战ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  user_id BIGINT NOT NULL COMMENT '员工账号ID',
  challenge_hash CHAR(64) NOT NULL COMMENT '一次性挑战凭证HMAC摘要',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0作废',
  expires_at DATETIME NOT NULL COMMENT '挑战失效时间',
  consumed_at DATETIME DEFAULT NULL COMMENT '签名成功后消费时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_payslip_employee_time (company_id,salary_detail_id,employee_id,created_at),
  KEY idx_expire (expires_at,consumed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工资条一次性签收挑战';

CREATE TABLE IF NOT EXISTS salary_evidence_receipt (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资条电子回执ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  signature_id BIGINT NOT NULL COMMENT '手写签名ID',
  challenge_id BIGINT NOT NULL COMMENT '一次性签收挑战ID',
  receipt_no VARCHAR(50) NOT NULL COMMENT '电子回执编号',
  statement_version VARCHAR(20) NOT NULL COMMENT '签收声明版本',
  payslip_content_sha256 CHAR(64) NOT NULL COMMENT '工资条内容摘要',
  signature_sha256 CHAR(64) NOT NULL COMMENT '签名文件摘要',
  evidence_chain_head CHAR(64) NOT NULL COMMENT '证据日志链头',
  receipt_payload JSON NOT NULL COMMENT '固定回执数据',
  storage_path VARCHAR(500) NOT NULL COMMENT '企业私有相对存储路径',
  receipt_sha256 CHAR(64) NOT NULL COMMENT 'PDF文件SHA-256',
  generated_at DATETIME NOT NULL COMMENT '回执生成时间',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0作废',
  created_by BIGINT NOT NULL COMMENT '签收员工账号ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_salary_evidence_receipt_detail (company_id,salary_detail_id),
  UNIQUE KEY uk_salary_evidence_receipt_no (receipt_no),
  KEY idx_employee_time (company_id,employee_id,generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工资条电子签收回执';
