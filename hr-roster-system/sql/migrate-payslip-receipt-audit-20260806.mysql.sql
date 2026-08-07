SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS salary_receipt_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资条证据日志ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  user_id BIGINT NOT NULL COMMENT '签收账号ID',
  action_type VARCHAR(20) NOT NULL COMMENT 'VIEW/ACCEPT/REJECT',
  result_status TINYINT NOT NULL COMMENT '操作后的签收状态',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT '客户端IP',
  user_agent VARCHAR(255) DEFAULT NULL COMMENT '设备及客户端标识',
  evidence_hash CHAR(64) NOT NULL COMMENT 'HMAC-SHA256证据摘要',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  INDEX idx_company_employee (company_id, employee_id, created_at),
  INDEX idx_salary_detail (company_id, salary_detail_id, created_at),
  INDEX idx_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工资条查看与签收证据日志';
