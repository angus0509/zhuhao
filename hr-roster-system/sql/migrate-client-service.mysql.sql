SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS client_service_request (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '客户服务工单ID',
  company_id BIGINT NOT NULL COMMENT '劳务公司ID',
  request_no VARCHAR(50) NOT NULL COMMENT '工单编号',
  customer_id BIGINT NOT NULL COMMENT '客户单位ID',
  project_id BIGINT DEFAULT NULL COMMENT '项目ID',
  employee_id BIGINT DEFAULT NULL COMMENT '关联员工ID',
  request_type TINYINT NOT NULL COMMENT '1增员 2减员 3资料 4账单 5发票 6其他',
  request_date DATE NOT NULL COMMENT '客户提交日期',
  deadline DATE NOT NULL COMMENT '要求完成日期',
  description VARCHAR(500) NOT NULL COMMENT '事项说明',
  owner_name VARCHAR(50) NOT NULL COMMENT '负责人',
  status TINYINT NOT NULL DEFAULT 0 COMMENT '0待受理 1处理中 2待客户确认 3已完成',
  completed_at DATETIME DEFAULT NULL,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_request_no (company_id, request_no),
  INDEX idx_company_status (company_id, status),
  INDEX idx_customer_project (customer_id, project_id),
  INDEX idx_deadline (deadline)
) COMMENT='甲方客户协同服务工单';
