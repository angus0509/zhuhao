SET NAMES utf8mb4;

USE hr_roster;

DELIMITER $$
DROP PROCEDURE IF EXISTS add_employee_fee_mode$$
CREATE PROCEDURE add_employee_fee_mode()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='hr_employee_job' AND COLUMN_NAME='fee_mode'
  ) THEN
    ALTER TABLE hr_employee_job
      ADD COLUMN fee_mode VARCHAR(80) NOT NULL DEFAULT '' COMMENT '费用模式，自定义文本'
      AFTER employment_type;
  ELSE
    ALTER TABLE hr_employee_job
      MODIFY COLUMN fee_mode VARCHAR(80) NOT NULL DEFAULT '' COMMENT '费用模式，自定义文本';
  END IF;
END$$
CALL add_employee_fee_mode()$$
DROP PROCEDURE add_employee_fee_mode$$
DELIMITER ;

UPDATE hr_employee_job SET fee_mode='' WHERE fee_mode='0';
