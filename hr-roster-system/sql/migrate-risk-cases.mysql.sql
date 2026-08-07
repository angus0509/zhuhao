-- 生产环境增量升级：用工风险整改闭环
CREATE TABLE IF NOT EXISTS hr_risk_case (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '整改任务ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  source_alert_id BIGINT NOT NULL COMMENT '来源风险预警ID',
  owner_name VARCHAR(50) NOT NULL COMMENT '整改责任人',
  owner_dept VARCHAR(100) DEFAULT NULL COMMENT '责任部门',
  deadline DATE NOT NULL COMMENT '整改期限',
  corrective_measure TEXT NOT NULL COMMENT '整改措施',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0待整改 1整改中 2待复核 3已关闭',
  evidence_note TEXT DEFAULT NULL COMMENT '整改证据说明',
  review_note TEXT DEFAULT NULL COMMENT '复核结论',
  created_by BIGINT DEFAULT NULL COMMENT '创建人',
  reviewed_by BIGINT DEFAULT NULL COMMENT '复核人',
  reviewed_at DATETIME DEFAULT NULL COMMENT '复核时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_company_status (company_id, status),
  INDEX idx_source_alert (source_alert_id),
  INDEX idx_deadline (deadline)
) COMMENT='用工风险整改闭环表';
