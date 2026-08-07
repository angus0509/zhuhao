SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS hr_risk_scan_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '扫描日志ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  scan_type VARCHAR(20) NOT NULL DEFAULT 'scheduled' COMMENT 'scheduled/manual',
  risk_count INT NOT NULL DEFAULT 0 COMMENT '扫描后未关闭风险数',
  new_risk_count INT NOT NULL DEFAULT 0 COMMENT '本次新增风险数',
  scan_status TINYINT NOT NULL DEFAULT 1 COMMENT '1成功 2失败',
  error_message VARCHAR(500) DEFAULT NULL COMMENT '失败原因',
  started_at DATETIME NOT NULL COMMENT '开始时间',
  completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '完成时间',
  KEY idx_company_time (company_id, completed_at),
  KEY idx_status_time (scan_status, completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='定时风险扫描日志';
