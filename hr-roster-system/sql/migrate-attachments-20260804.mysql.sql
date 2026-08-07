SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS hr_attachment (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '附件ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  biz_type VARCHAR(30) NOT NULL COMMENT 'contract/social/certificate/risk_case',
  biz_id BIGINT NOT NULL COMMENT '关联业务ID',
  employee_id BIGINT NOT NULL COMMENT '关联员工ID，用于数据隔离',
  storage_path VARCHAR(255) NOT NULL COMMENT '服务器相对存储路径',
  original_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
  file_size BIGINT NOT NULL COMMENT '文件大小，字节',
  mime_type VARCHAR(100) NOT NULL COMMENT 'MIME类型',
  file_sha256 CHAR(64) NOT NULL COMMENT '文件完整性摘要',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0删除',
  created_by BIGINT NOT NULL COMMENT '上传人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_biz (company_id, biz_type, biz_id, status),
  KEY idx_employee (company_id, employee_id, status),
  KEY idx_hash (company_id, file_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合规附件';
