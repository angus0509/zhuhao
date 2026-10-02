-- 项目考勤日确认、异常核实审计迁移（可重复执行）

CREATE TABLE IF NOT EXISTS attendance_daily_closures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  version_no INT UNSIGNED NOT NULL DEFAULT 0,
  confirmed_by BIGINT DEFAULT NULL,
  confirmed_at DATETIME DEFAULT NULL,
  reopened_by BIGINT DEFAULT NULL,
  reopened_at DATETIME DEFAULT NULL,
  reopen_reason VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_daily_closure (company_id, project_id, shift_date),
  KEY idx_attendance_daily_closure_status (company_id, project_id, status, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目考勤日确认状态';

CREATE TABLE IF NOT EXISTS attendance_daily_closure_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  action_type VARCHAR(20) NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  reason VARCHAR(255) DEFAULT NULL,
  operated_by BIGINT NOT NULL,
  operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_closure_request (company_id, client_request_id),
  KEY idx_attendance_closure_event_lookup (company_id, project_id, shift_date, operated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目考勤日确认事件';

CREATE TABLE IF NOT EXISTS attendance_daily_review_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  daily_result_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  action_type VARCHAR(30) NOT NULL,
  result_status VARCHAR(30) NOT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  review_comment VARCHAR(255) NOT NULL,
  operated_by BIGINT NOT NULL,
  operated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_daily_review_request (company_id, client_request_id),
  KEY idx_attendance_daily_review_lookup (company_id, project_id, shift_date, daily_result_id, operated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤每日异常核实事件';
