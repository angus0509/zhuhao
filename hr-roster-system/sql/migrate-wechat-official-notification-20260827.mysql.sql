-- 微信公众号服务号绑定与工资条通知队列，幂等迁移。
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS employee_official_binding (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  official_openid VARCHAR(128) NOT NULL,
  unionid VARCHAR(128) DEFAULT NULL,
  binding_status TINYINT NOT NULL DEFAULT 1,
  bound_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME DEFAULT NULL,
  unbound_at DATETIME DEFAULT NULL,
  unbound_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_employee_official (company_id, employee_id, binding_status),
  UNIQUE KEY uk_company_official_openid (company_id, official_openid, binding_status),
  KEY idx_official_unionid (company_id, unionid),
  CONSTRAINT fk_official_binding_company FOREIGN KEY (company_id) REFERENCES hr_company(id),
  CONSTRAINT fk_official_binding_employee FOREIGN KEY (employee_id) REFERENCES hr_employee(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工服务号绑定';

CREATE TABLE IF NOT EXISTS wechat_official_notification_job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  batch_id BIGINT DEFAULT NULL,
  payslip_id BIGINT DEFAULT NULL,
  business_type VARCHAR(40) NOT NULL,
  template_key VARCHAR(80) NOT NULL,
  salary_month VARCHAR(20) DEFAULT NULL,
  delivery_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  attempt_count TINYINT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  provider_code VARCHAR(80) DEFAULT NULL,
  provider_request_id VARCHAR(128) DEFAULT NULL,
  error_summary VARCHAR(255) DEFAULT NULL,
  dedupe_key VARCHAR(180) NOT NULL,
  sent_at DATETIME DEFAULT NULL,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_official_notification_dedupe (company_id, dedupe_key),
  KEY idx_official_notification_queue (delivery_status, next_attempt_at),
  KEY idx_official_notification_scope (company_id, employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务号通知队列';
