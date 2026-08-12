-- 员工花名册与人才库关联：未入职、离职人员自动回流，重复执行安全。
SET @employee_status_comment_sql =
  'ALTER TABLE hr_employee MODIFY COLUMN employee_status TINYINT NOT NULL DEFAULT 1 COMMENT ''1待入职 2在职 3离职 4黑名单 5未入职''';
PREPARE stmt FROM @employee_status_comment_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @lifecycle_comment_sql =
  'ALTER TABLE hr_employee MODIFY COLUMN lifecycle_status VARCHAR(30) NOT NULL DEFAULT ''DRAFT'' COMMENT ''DRAFT/PENDING_ARRIVAL/NOT_JOINED/ONBOARDING/ACTIVE/TRANSFERRING/OFFBOARDING/LEFT/CANCELLED/VOID''';
PREPARE stmt FROM @lifecycle_comment_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- MySQL 不支持循环 DDL，这里逐项检查以兼容已部署过部分字段的环境。
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='employee_id');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN employee_id BIGINT DEFAULT NULL COMMENT ''关联员工档案ID'' AFTER company_id', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='customer_id');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN customer_id BIGINT DEFAULT NULL COMMENT ''最近客户单位ID'' AFTER employee_id', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='project_id');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN project_id BIGINT DEFAULT NULL COMMENT ''最近项目ID'' AFTER customer_id', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='position_id');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN position_id BIGINT DEFAULT NULL COMMENT ''最近岗位ID'' AFTER project_id', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='recruitment_channel_id');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN recruitment_channel_id BIGINT DEFAULT NULL COMMENT ''招聘渠道ID'' AFTER position_id', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='talent_source_type');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN talent_source_type VARCHAR(30) NOT NULL DEFAULT ''MANUAL'' COMMENT ''MANUAL手工 UNJOINED未入职 RESIGNED离职回流'' AFTER candidate_status', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='employee_status_snapshot');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN employee_status_snapshot TINYINT DEFAULT NULL COMMENT ''员工状态快照'' AFTER talent_source_type', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='available_status');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN available_status TINYINT NOT NULL DEFAULT 1 COMMENT ''1可联系 2暂不考虑 3已重新入职'' AFTER employee_status_snapshot', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='resigned_at');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN resigned_at DATETIME DEFAULT NULL COMMENT ''离职时间'' AFTER available_status', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='resignation_reason');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN resignation_reason VARCHAR(255) DEFAULT NULL COMMENT ''离职原因'' AFTER resigned_at', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND COLUMN_NAME='flowed_at');
SET @ddl = IF(@has_col=0, 'ALTER TABLE talent_candidate ADD COLUMN flowed_at DATETIME DEFAULT NULL COMMENT ''最近流转时间'' AFTER resignation_reason', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND INDEX_NAME='uk_company_employee');
SET @ddl = IF(@has_idx=0, 'ALTER TABLE talent_candidate ADD UNIQUE KEY uk_company_employee (company_id,employee_id)', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND INDEX_NAME='idx_company_source_status');
SET @ddl = IF(@has_idx=0, 'ALTER TABLE talent_candidate ADD INDEX idx_company_source_status (company_id,talent_source_type,available_status)', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND INDEX_NAME='idx_company_customer');
SET @ddl = IF(@has_idx=0, 'ALTER TABLE talent_candidate ADD INDEX idx_company_customer (company_id,customer_id)', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='talent_candidate' AND INDEX_NAME='idx_company_position');
SET @ddl = IF(@has_idx=0, 'ALTER TABLE talent_candidate ADD INDEX idx_company_position (company_id,position_id)', 'SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 回填历史已离职人员。员工关联唯一键保证反复部署不会生成重复人才。
INSERT INTO talent_candidate
  (company_id,employee_id,customer_id,project_id,position_id,recruitment_channel_id,name,id_card_no,id_card_hash,phone,
   intended_position,source_channel,candidate_status,talent_source_type,employee_status_snapshot,available_status,
   resigned_at,resignation_reason,flowed_at,owner_user_id,remark)
SELECT e.company_id,e.id,j.customer_id,j.project_id,j.position_id,e.recruitment_channel_id,e.name,e.id_card_no,e.id_card_hash,e.phone,
       p.position_name,e.channel_source,1,'RESIGNED',3,1,COALESCE(r.completed_at,CONCAT(r.leave_date,' 00:00:00')),
       r.leave_reason,COALESCE(r.completed_at,NOW()),e.created_by,e.remark
FROM hr_employee e
LEFT JOIN hr_employee_job j ON j.id=(SELECT j2.id FROM hr_employee_job j2 WHERE j2.company_id=e.company_id AND j2.employee_id=e.id ORDER BY j2.id DESC LIMIT 1)
LEFT JOIN hr_position p ON p.id=j.position_id AND p.company_id=e.company_id
LEFT JOIN hr_resignation r ON r.id=(SELECT r2.id FROM hr_resignation r2 WHERE r2.company_id=e.company_id AND r2.employee_id=e.id ORDER BY r2.id DESC LIMIT 1)
WHERE e.employee_status=3 AND e.deleted_at IS NULL
ON DUPLICATE KEY UPDATE
  customer_id=VALUES(customer_id),project_id=VALUES(project_id),position_id=VALUES(position_id),
  recruitment_channel_id=VALUES(recruitment_channel_id),name=VALUES(name),id_card_no=VALUES(id_card_no),
  id_card_hash=VALUES(id_card_hash),phone=VALUES(phone),intended_position=VALUES(intended_position),
  source_channel=VALUES(source_channel),candidate_status=1,talent_source_type='RESIGNED',employee_status_snapshot=3,
  available_status=1,resigned_at=VALUES(resigned_at),resignation_reason=VALUES(resignation_reason),flowed_at=VALUES(flowed_at),
  owner_user_id=COALESCE(VALUES(owner_user_id),owner_user_id),remark=VALUES(remark),updated_at=NOW();
