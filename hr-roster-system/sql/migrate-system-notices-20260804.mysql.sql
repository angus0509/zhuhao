SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS hr_system_notice (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '通知ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT DEFAULT NULL COMMENT '关联员工，用于员工数据范围隔离',
  project_id BIGINT DEFAULT NULL COMMENT '关联项目，用于项目数据范围隔离',
  title VARCHAR(200) NOT NULL COMMENT '通知标题',
  category VARCHAR(50) NOT NULL DEFAULT '系统通知' COMMENT '通知分类',
  notice_type VARCHAR(30) NOT NULL DEFAULT 'info' COMMENT 'info/success/warning/risk',
  target_view VARCHAR(30) DEFAULT NULL COMMENT '点击后进入的页面',
  dedupe_key VARCHAR(160) DEFAULT NULL COMMENT '业务幂等键',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_dedupe (company_id, dedupe_key),
  KEY idx_company_time (company_id, created_at),
  KEY idx_employee (company_id, employee_id, created_at),
  KEY idx_project (company_id, project_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统业务通知';
