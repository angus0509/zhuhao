-- 统一招聘渠道台账：保留员工自由文本快照，同时建立可统计、可关联的渠道主数据。
CREATE TABLE IF NOT EXISTS hr_recruitment_channel (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '招聘渠道ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  channel_name VARCHAR(100) NOT NULL COMMENT '渠道名称',
  channel_type TINYINT NOT NULL DEFAULT 9 COMMENT '1内部招聘人 2合作供应商 3线上平台 4员工推荐 5线下招聘 9其他',
  recruiter_id BIGINT DEFAULT NULL COMMENT '关联招聘人',
  supplier_id BIGINT DEFAULT NULL COMMENT '关联供应商',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  remark VARCHAR(255) DEFAULT NULL COMMENT '备注',
  created_by BIGINT DEFAULT NULL COMMENT '创建人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_channel_name (company_id, channel_name),
  KEY idx_company_channel_status (company_id, status),
  KEY idx_channel_recruiter (company_id, recruiter_id),
  KEY idx_channel_supplier (company_id, supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='招聘渠道台账';

SET @has_recruitment_channel_id = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hr_employee' AND COLUMN_NAME = 'recruitment_channel_id'
);
SET @add_recruitment_channel_id = IF(
  @has_recruitment_channel_id = 0,
  'ALTER TABLE hr_employee ADD COLUMN recruitment_channel_id BIGINT DEFAULT NULL COMMENT ''统一招聘渠道ID'' AFTER channel_source, ADD INDEX idx_company_recruitment_channel (company_id, recruitment_channel_id)',
  'SELECT ''recruitment_channel_id already exists'''
);
PREPARE stmt FROM @add_recruitment_channel_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE hr_employee MODIFY COLUMN channel_source VARCHAR(100) DEFAULT NULL COMMENT '招聘渠道文本快照';

-- 将历史自由文本渠道归档为渠道台账，并回填关联ID；不改写员工历史文本。
INSERT INTO hr_recruitment_channel (company_id, channel_name, channel_type, status, created_by)
SELECT company_id, TRIM(channel_source), 9, 1, MIN(created_by)
FROM hr_employee
WHERE channel_source IS NOT NULL AND TRIM(channel_source) <> '' AND deleted_at IS NULL
GROUP BY company_id, TRIM(channel_source)
ON DUPLICATE KEY UPDATE channel_name = VALUES(channel_name);

UPDATE hr_employee e
JOIN hr_recruitment_channel rc
  ON rc.company_id = e.company_id AND rc.channel_name = TRIM(e.channel_source)
SET e.recruitment_channel_id = rc.id
WHERE e.recruitment_channel_id IS NULL AND e.channel_source IS NOT NULL AND TRIM(e.channel_source) <> '';
