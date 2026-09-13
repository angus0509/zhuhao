SET NAMES utf8mb4;

-- 员工和人才库手机号改为选填，支持先建档、入职后再补充。
ALTER TABLE hr_employee MODIFY COLUMN phone VARCHAR(20) NULL COMMENT '手机号，选填';
ALTER TABLE talent_candidate MODIFY COLUMN phone VARCHAR(20) NULL COMMENT '手机号，选填';
