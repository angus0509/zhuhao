-- 员工工资条手写签名与工资异议证据结构。
-- 幂等迁移：仅新增表，不删除、覆盖或改写历史工资记录。
SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS salary_signature (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资条签名ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  attachment_id BIGINT NOT NULL COMMENT '签名PNG附件ID',
  signature_sha256 CHAR(64) NOT NULL COMMENT '签名文件SHA-256',
  signed_name VARCHAR(50) NOT NULL COMMENT '签名人姓名',
  statement_version VARCHAR(20) NOT NULL DEFAULT '1.0' COMMENT '确认声明版本',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT '签名IP',
  device_info VARCHAR(255) DEFAULT NULL COMMENT '设备信息',
  signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '签名时间',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0作废',
  active_salary_detail_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN status=1 THEN salary_detail_id ELSE NULL END
  ) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_salary_signature_active (company_id, active_salary_detail_id),
  KEY idx_employee_time (company_id, employee_id, signed_at),
  KEY idx_attachment (company_id, attachment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工工资条手写签名证据';

CREATE TABLE IF NOT EXISTS salary_dispute (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资异议ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  dispute_reason VARCHAR(500) NOT NULL COMMENT '异议原因',
  handle_status TINYINT NOT NULL DEFAULT 0 COMMENT '0待处理 1处理中 2已解决 3驳回',
  open_salary_detail_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN handle_status IN (0,1) THEN salary_detail_id ELSE NULL END
  ) STORED,
  handler_id BIGINT DEFAULT NULL COMMENT '处理人',
  handle_remark VARCHAR(500) DEFAULT NULL COMMENT '处理说明',
  handled_at DATETIME DEFAULT NULL COMMENT '处理时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_open_dispute (company_id, open_salary_detail_id),
  KEY idx_company_status (company_id, handle_status, created_at),
  KEY idx_employee (company_id, employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工工资异议';
