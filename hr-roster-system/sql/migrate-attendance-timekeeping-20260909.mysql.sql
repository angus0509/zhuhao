SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS attendance_shift_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  rule_name VARCHAR(100) NOT NULL,
  work_start_time TIME NOT NULL,
  work_end_time TIME NOT NULL,
  rest_start_time TIME DEFAULT NULL,
  rest_end_time TIME DEFAULT NULL,
  standard_minutes INT UNSIGNED NOT NULL,
  late_grace_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  early_grace_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  overtime_min_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_rule_name (company_id, rule_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_schedules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  shift_rule_id BIGINT NOT NULL,
  schedule_status VARCHAR(20) NOT NULL DEFAULT 'WORK',
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_schedule (company_id, employee_id, shift_date),
  KEY idx_attendance_schedule_date (company_id, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_punches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  punch_type VARCHAR(10) NOT NULL,
  punch_time DATETIME(3) NOT NULL,
  source VARCHAR(20) NOT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_attendance_punch_request (company_id, employee_id, client_request_id),
  KEY idx_attendance_punch_time (company_id, employee_id, punch_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_daily_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  schedule_id BIGINT DEFAULT NULL,
  first_in_at DATETIME(3) DEFAULT NULL,
  last_out_at DATETIME(3) DEFAULT NULL,
  worked_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  approved_normal_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  overtime_candidate_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  approved_overtime_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  late_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  early_leave_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  result_status VARCHAR(30) NOT NULL,
  review_status VARCHAR(20) NOT NULL DEFAULT 'NONE',
  calculation_version VARCHAR(30) NOT NULL,
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by BIGINT DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_daily (company_id, employee_id, shift_date),
  KEY idx_attendance_daily_status (company_id, shift_date, result_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_correction_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  request_type VARCHAR(20) NOT NULL,
  requested_time DATETIME(3) DEFAULT NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  submitted_by_employee_id BIGINT NOT NULL,
  reviewed_by BIGINT DEFAULT NULL,
  review_comment VARCHAR(500) DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_attendance_correction_status (company_id, status, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sys_permission (permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
SELECT '考勤管理', 'attendance:menu', 1, 0, '/hr/attendance', NULL, 25, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_permission WHERE permission_code='attendance:menu');
INSERT INTO sys_permission (permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
SELECT '查看考勤', 'attendance:view', 2, 0, NULL, '/api/attendance', 26, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_permission WHERE permission_code='attendance:view');
INSERT INTO sys_permission (permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
SELECT '管理考勤', 'attendance:manage', 2, 0, NULL, '/api/attendance', 27, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_permission WHERE permission_code='attendance:manage');
INSERT INTO sys_permission (permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
SELECT '审核考勤异常', 'attendance:review', 2, 0, NULL, '/api/attendance/corrections', 28, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_permission WHERE permission_code='attendance:review');
INSERT INTO sys_permission (permission_name, permission_code, permission_type, parent_id, route_path, api_path, sort_no, status)
SELECT '导出考勤', 'attendance:export', 2, 0, NULL, '/api/attendance/export.xlsx', 29, 1
WHERE NOT EXISTS (SELECT 1 FROM sys_permission WHERE permission_code='attendance:export');

INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r JOIN sys_permission p
WHERE p.permission_code IN ('attendance:menu','attendance:view') AND r.role_code IN ('company_admin','hr_manager','onsite_staff','payroll_staff');
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r JOIN sys_permission p
WHERE p.permission_code IN ('attendance:manage','attendance:review') AND r.role_code IN ('company_admin','hr_manager','onsite_staff');
INSERT IGNORE INTO sys_role_permission (role_id, permission_id)
SELECT r.id, p.id FROM sys_role r JOIN sys_permission p
WHERE p.permission_code='attendance:export' AND r.role_code IN ('company_admin','hr_manager','payroll_staff');
