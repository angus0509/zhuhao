-- 员工微信登录、一次性绑定码和登录审计结构。
-- 幂等迁移：仅新增字段、索引和表，不删除或覆盖历史数据。
SET NAMES utf8mb4;
USE hr_roster;

SET @account_type_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sys_user'
    AND COLUMN_NAME = 'account_type'
);
SET @account_type_sql = IF(
  @account_type_exists = 0,
  'ALTER TABLE sys_user ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT ''MANAGER'' COMMENT ''MANAGER管理账号 EMPLOYEE员工账号'' AFTER token_version',
  'SELECT ''account_type already exists'''
);
PREPARE account_type_stmt FROM @account_type_sql;
EXECUTE account_type_stmt;
DEALLOCATE PREPARE account_type_stmt;

SET @account_type_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sys_user'
    AND INDEX_NAME = 'idx_company_account_type'
);
SET @account_type_index_sql = IF(
  @account_type_index_exists = 0,
  'ALTER TABLE sys_user ADD INDEX idx_company_account_type (company_id, account_type, status)',
  'SELECT ''idx_company_account_type already exists'''
);
PREPARE account_type_index_stmt FROM @account_type_index_sql;
EXECUTE account_type_index_stmt;
DEALLOCATE PREPARE account_type_index_stmt;

CREATE TABLE IF NOT EXISTS employee_wechat_binding (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '微信绑定ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  user_id BIGINT NOT NULL COMMENT '员工账号ID',
  openid VARCHAR(128) NOT NULL COMMENT '小程序OpenID',
  unionid VARCHAR(128) DEFAULT NULL COMMENT '微信UnionID',
  phone VARCHAR(20) DEFAULT NULL COMMENT '绑定手机号，无手机号绑定时为空',
  binding_status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0解绑 2冻结',
  token_version INT NOT NULL DEFAULT 0 COMMENT '绑定会话撤销版本',
  active_employee_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN binding_status=1 THEN employee_id ELSE NULL END
  ) STORED,
  active_openid VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN binding_status=1 THEN openid ELSE NULL END
  ) STORED,
  bound_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '绑定时间',
  last_login_at DATETIME DEFAULT NULL COMMENT '最后登录时间',
  unbound_at DATETIME DEFAULT NULL COMMENT '解绑时间',
  unbound_by BIGINT DEFAULT NULL COMMENT '解绑操作人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_employee_active (company_id, active_employee_id),
  UNIQUE KEY uk_company_openid_active (company_id, active_openid),
  KEY idx_user (company_id, user_id),
  KEY idx_phone (company_id, phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工微信绑定历史';

CREATE TABLE IF NOT EXISTS employee_bind_code (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '一次性绑定码ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  code_hash CHAR(64) NOT NULL COMMENT '服务端HMAC-SHA256摘要',
  code_salt CHAR(32) NOT NULL COMMENT '随机盐',
  expire_at DATETIME NOT NULL COMMENT '过期时间',
  failed_attempts TINYINT NOT NULL DEFAULT 0 COMMENT '失败次数，最多5次',
  used_at DATETIME DEFAULT NULL COMMENT '使用时间',
  created_by BIGINT NOT NULL COMMENT '创建人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_employee_active (company_id, employee_id, expire_at, used_at),
  KEY idx_expire (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工一次性微信绑定码';

CREATE TABLE IF NOT EXISTS employee_login_audit (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '员工登录审计ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT DEFAULT NULL COMMENT '员工ID，未匹配时可为空',
  user_id BIGINT DEFAULT NULL COMMENT '员工账号ID，未绑定时可为空',
  ticket_nonce_hash CHAR(64) DEFAULT NULL COMMENT '一次性绑定票据nonce摘要',
  action_type VARCHAR(30) NOT NULL COMMENT 'TICKET_ISSUE/PHONE_BIND/CODE_BIND/LOGIN',
  result_code VARCHAR(40) NOT NULL COMMENT 'ISSUED/SUCCESS/FAILED/EXPIRED/LOCKED',
  phone_tail VARCHAR(4) DEFAULT NULL COMMENT '手机号末四位，不保存完整号码',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT '客户端IP',
  device_info VARCHAR(255) DEFAULT NULL COMMENT '设备信息',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '审计时间',
  UNIQUE KEY uk_ticket_nonce_hash (ticket_nonce_hash),
  KEY idx_company_employee_time (company_id, employee_id, created_at),
  KEY idx_user_time (user_id, created_at),
  KEY idx_action_result_time (action_type, result_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工微信登录与绑定审计';
