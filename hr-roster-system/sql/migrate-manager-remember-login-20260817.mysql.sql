-- 驻厂与管理账号安全记住登录设备凭证，可重复执行。
SET NAMES utf8mb4;
USE hr_roster;

CREATE TABLE IF NOT EXISTS manager_login_device (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '设备登录凭证ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  user_id BIGINT NOT NULL COMMENT '管理账号ID',
  token_hash CHAR(64) NOT NULL COMMENT '设备凭证SHA-256摘要，不保存明文',
  token_version INT NOT NULL DEFAULT 0 COMMENT '签发时账号会话撤销版本',
  expire_at DATETIME NOT NULL COMMENT '凭证过期时间',
  last_used_at DATETIME DEFAULT NULL COMMENT '最后续登时间',
  revoked_at DATETIME DEFAULT NULL COMMENT '撤销时间',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT '最近使用IP',
  device_info VARCHAR(255) DEFAULT NULL COMMENT '设备信息',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_manager_device_token_hash (token_hash),
  KEY idx_manager_device_user (company_id, user_id, revoked_at, expire_at),
  KEY idx_manager_device_expire (expire_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理端记住登录设备凭证';
