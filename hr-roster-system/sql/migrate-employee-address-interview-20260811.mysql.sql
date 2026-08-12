-- 新增员工地址、面试状态，并允许用工/计费信息后续补齐。
SET @has_address = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_employee' AND COLUMN_NAME='address'
);
SET @ddl = IF(
  @has_address=0,
  'ALTER TABLE hr_employee ADD COLUMN address VARCHAR(512) DEFAULT NULL COMMENT ''家庭/居住地址，AES加密存储'' AFTER id_card_hash',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE hr_employee
  MODIFY COLUMN employee_status TINYINT NOT NULL DEFAULT 1 COMMENT '1待入职 2在职 3离职 4黑名单 5未入职 6面试',
  MODIFY COLUMN lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/INTERVIEW/PENDING_ARRIVAL/NOT_JOINED/ONBOARDING/ACTIVE/TRANSFERRING/OFFBOARDING/LEFT/CANCELLED/VOID';

ALTER TABLE hr_employee_job
  MODIFY COLUMN employment_type TINYINT DEFAULT NULL COMMENT '1全职 2兼职 3劳务 4实习 5外包 6派遣，可后续补齐',
  MODIFY COLUMN work_type TINYINT DEFAULT NULL COMMENT '1计时 2计件 3混合，可后续补齐',
  MODIFY COLUMN hire_date DATE DEFAULT NULL COMMENT '入职/生效日期，可后续补齐';
