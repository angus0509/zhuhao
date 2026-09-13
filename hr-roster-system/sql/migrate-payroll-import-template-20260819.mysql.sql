-- 项目工资表模板（显式命名模板，供工资导入时主动选择），可重复执行。
SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS salary_import_template (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  name VARCHAR(50) NOT NULL,
  source_headers JSON NOT NULL,
  mapping_json JSON NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  last_used_at DATETIME DEFAULT NULL,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_project_name (company_id, project_id, name),
  KEY idx_company_project_status (company_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目工资表模板';
