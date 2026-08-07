SET NAMES utf8mb4;

USE hr_roster;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_employer_insurance_columns$$
CREATE PROCEDURE add_employer_insurance_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_social_security' AND COLUMN_NAME='employer_insurance_status') THEN
    ALTER TABLE hr_social_security ADD COLUMN employer_insurance_status TINYINT NOT NULL DEFAULT 0 COMMENT '雇主责任险 0未投保 1保障中 2已终止' AFTER supplier_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_social_security' AND COLUMN_NAME='employer_insurer') THEN
    ALTER TABLE hr_social_security ADD COLUMN employer_insurer VARCHAR(100) DEFAULT NULL COMMENT '雇主险承保机构' AFTER employer_insurance_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_social_security' AND COLUMN_NAME='employer_policy_no') THEN
    ALTER TABLE hr_social_security ADD COLUMN employer_policy_no VARCHAR(80) DEFAULT NULL COMMENT '雇主险保单号' AFTER employer_insurer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_social_security' AND COLUMN_NAME='employer_start_date') THEN
    ALTER TABLE hr_social_security ADD COLUMN employer_start_date DATE DEFAULT NULL COMMENT '雇主险生效日期' AFTER employer_policy_no;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_social_security' AND COLUMN_NAME='employer_end_date') THEN
    ALTER TABLE hr_social_security ADD COLUMN employer_end_date DATE DEFAULT NULL COMMENT '雇主险到期日期' AFTER employer_start_date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_social_security' AND COLUMN_NAME='employer_insured_amount') THEN
    ALTER TABLE hr_social_security ADD COLUMN employer_insured_amount DECIMAL(14,2) DEFAULT 0 COMMENT '雇主险保额' AFTER employer_end_date;
  END IF;
END$$

CALL add_employer_insurance_columns()$$
DROP PROCEDURE add_employer_insurance_columns$$

DELIMITER ;
