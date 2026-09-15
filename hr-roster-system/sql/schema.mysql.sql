SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS hr_roster
DEFAULT CHARACTER SET utf8mb4
DEFAULT COLLATE utf8mb4_unicode_ci;

USE hr_roster;

CREATE TABLE hr_company (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '企业ID',
  company_name VARCHAR(100) NOT NULL COMMENT '企业名称',
  unified_credit_code VARCHAR(50) DEFAULT NULL COMMENT '统一社会信用代码',
  contact_name VARCHAR(50) DEFAULT NULL COMMENT '联系人',
  contact_phone VARCHAR(20) DEFAULT NULL COMMENT '联系电话',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT='企业表';

CREATE TABLE hr_department (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '部门ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  parent_id BIGINT DEFAULT 0 COMMENT '上级部门ID',
  dept_name VARCHAR(100) NOT NULL COMMENT '部门名称',
  dept_code VARCHAR(50) DEFAULT NULL COMMENT '部门编码',
  leader_employee_id BIGINT DEFAULT NULL COMMENT '部门负责人',
  sort_no INT NOT NULL DEFAULT 0 COMMENT '排序',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_company_id (company_id),
  INDEX idx_parent_id (parent_id)
) COMMENT='部门表';

CREATE TABLE hr_position (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '岗位ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  position_name VARCHAR(100) NOT NULL COMMENT '岗位名称',
  position_code VARCHAR(50) DEFAULT NULL COMMENT '岗位编码',
  position_level VARCHAR(50) DEFAULT NULL COMMENT '岗位等级',
  risk_level TINYINT NOT NULL DEFAULT 1 COMMENT '1低 2中 3高',
  is_special_work TINYINT NOT NULL DEFAULT 0 COMMENT '0否 1是',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_company_id (company_id)
) COMMENT='岗位表';

CREATE TABLE hr_recruitment_channel (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '招聘渠道ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  channel_name VARCHAR(100) NOT NULL COMMENT '渠道名称',
  channel_type TINYINT NOT NULL DEFAULT 9 COMMENT '1内部招聘人 2合作供应商 3线上平台 4员工推荐 5线下招聘 9其他',
  recruiter_id BIGINT DEFAULT NULL COMMENT '关联招聘人',
  supplier_id BIGINT DEFAULT NULL COMMENT '关联供应商',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  remark VARCHAR(255) DEFAULT NULL COMMENT '备注',
  created_by BIGINT DEFAULT NULL COMMENT '创建人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_channel_name (company_id, channel_name),
  INDEX idx_company_channel_status (company_id, status)
) COMMENT='招聘渠道台账';

CREATE TABLE hr_employee (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '员工ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_no VARCHAR(50) NOT NULL COMMENT '员工工号',
  name VARCHAR(50) NOT NULL COMMENT '姓名',
  gender TINYINT NOT NULL DEFAULT 0 COMMENT '1男 2女 0未知',
  id_card_no VARCHAR(255) DEFAULT NULL COMMENT '身份证号，建议加密',
  id_card_hash CHAR(64) DEFAULT NULL COMMENT '身份证SHA-256摘要，用于查重和黑名单校验',
  address VARCHAR(512) DEFAULT NULL COMMENT '家庭/居住地址，AES加密存储',
  phone VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  email VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
  education VARCHAR(50) DEFAULT NULL COMMENT '学历',
  bank_name VARCHAR(100) DEFAULT NULL COMMENT '开户行',
  bank_card_no VARCHAR(255) DEFAULT NULL COMMENT '银行卡号，建议加密',
  emergency_contact VARCHAR(50) DEFAULT NULL COMMENT '紧急联系人',
  emergency_phone VARCHAR(20) DEFAULT NULL COMMENT '紧急联系电话',
  channel_source VARCHAR(100) DEFAULT NULL COMMENT '招聘渠道文本快照',
  recruitment_channel_id BIGINT DEFAULT NULL COMMENT '统一招聘渠道ID',
  recruitment_source_type TINYINT DEFAULT NULL COMMENT '招聘来源类型：1招聘人 2供应商',
  recruiter_id BIGINT DEFAULT NULL COMMENT '招聘人ID',
  supplier_id BIGINT DEFAULT NULL COMMENT '招聘供应商ID',
  source_locked TINYINT NOT NULL DEFAULT 0 COMMENT '招聘来源是否锁定：0否 1是',
  source_confirmed_at DATETIME DEFAULT NULL COMMENT '招聘来源确认时间',
  lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/INTERVIEW/PENDING_ARRIVAL/NOT_JOINED/ONBOARDING/ACTIVE/TRANSFERRING/OFFBOARDING/LEFT/CANCELLED/VOID',
  arrival_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/CONFIRMED/NO_SHOW',
  insurance_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/PROCESSING/PENDING_EFFECTIVE/ACTIVE/TERMINATING/TERMINATED/FAILED',
  contract_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SIGNED/EXPIRING/EXPIRED/TERMINATED',
  document_status VARCHAR(30) NOT NULL DEFAULT 'INCOMPLETE' COMMENT 'INCOMPLETE/COMPLETE/ABNORMAL',
  risk_level TINYINT NOT NULL DEFAULT 1 COMMENT '综合风险等级：1低 2中 3高',
  employee_status TINYINT NOT NULL DEFAULT 1 COMMENT '1待入职 2在职 3离职 4黑名单 5未入职 6面试',
  created_by BIGINT DEFAULT NULL COMMENT '录入人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_company_employee_no (company_id, employee_no),
  INDEX idx_company_status (company_id, employee_status),
  INDEX idx_company_lifecycle (company_id, lifecycle_status),
  INDEX idx_company_recruitment_channel (company_id, recruitment_channel_id),
  INDEX idx_company_recruiter (company_id, recruiter_id),
  INDEX idx_company_supplier (company_id, supplier_id),
  INDEX idx_phone (phone)
  ,UNIQUE KEY uk_company_id_card_hash (company_id, id_card_hash)
) COMMENT='员工主表';

CREATE TABLE hr_recruiter (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '招聘人ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  recruiter_no VARCHAR(32) NOT NULL COMMENT '招聘人编号',
  recruiter_name VARCHAR(50) NOT NULL COMMENT '招聘人姓名',
  phone VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  user_id BIGINT DEFAULT NULL COMMENT '关联系统账号',
  primary_project_id BIGINT DEFAULT NULL COMMENT '主要项目',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_by BIGINT DEFAULT NULL COMMENT '创建人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_recruiter_no (company_id, recruiter_no),
  INDEX idx_company_recruiter_status (company_id, status)
) COMMENT='招聘人表';

CREATE TABLE hr_recruitment_supplier (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '供应商ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  supplier_no VARCHAR(32) NOT NULL COMMENT '供应商编号',
  supplier_name VARCHAR(150) NOT NULL COMMENT '供应商名称',
  credit_code VARCHAR(32) DEFAULT NULL COMMENT '统一社会信用代码',
  contact_name VARCHAR(50) DEFAULT NULL COMMENT '联系人',
  contact_phone VARCHAR(20) DEFAULT NULL COMMENT '联系电话',
  contract_start_date DATE DEFAULT NULL COMMENT '合同开始日期',
  contract_end_date DATE DEFAULT NULL COMMENT '合同结束日期',
  risk_level TINYINT NOT NULL DEFAULT 1 COMMENT '1低 2中 3高',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_by BIGINT DEFAULT NULL COMMENT '创建人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_supplier_no (company_id, supplier_no),
  INDEX idx_company_supplier_status (company_id, status, contract_end_date)
) COMMENT='招聘供应商表';

CREATE TABLE hr_work_task (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '待办ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT DEFAULT NULL COMMENT '员工ID',
  project_id BIGINT DEFAULT NULL COMMENT '项目ID',
  task_type VARCHAR(50) NOT NULL COMMENT 'ARRIVAL/ONBOARDING_COMPLIANCE/INSURANCE/CONTRACT/DOCUMENT/OFFBOARD/INSURANCE_TERMINATION/PAYROLL_SETTLEMENT',
  task_title VARCHAR(150) NOT NULL COMMENT '待办标题',
  task_content VARCHAR(500) DEFAULT NULL COMMENT '待办说明',
  source_type VARCHAR(50) NOT NULL COMMENT '来源业务类型',
  source_id BIGINT DEFAULT NULL COMMENT '来源业务ID',
  risk_level TINYINT NOT NULL DEFAULT 1 COMMENT '1低 2中 3高',
  task_status TINYINT NOT NULL DEFAULT 0 COMMENT '0待处理 1处理中 2完成 3关闭',
  assigned_user_id BIGINT DEFAULT NULL COMMENT '责任人',
  deadline DATETIME DEFAULT NULL COMMENT '截止时间',
  completed_by BIGINT DEFAULT NULL COMMENT '完成人',
  completed_at DATETIME DEFAULT NULL COMMENT '完成时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_active_task (company_id, employee_id, task_type, source_type, source_id, task_status),
  INDEX idx_assignee_status (company_id, assigned_user_id, task_status, deadline),
  INDEX idx_employee_task (company_id, employee_id, task_status)
) COMMENT='驻厂业务统一待办表';

CREATE TABLE hr_employee_job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '任职记录ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  customer_id BIGINT DEFAULT NULL COMMENT '员工所属客户单位ID',
  project_id BIGINT DEFAULT NULL COMMENT '所属用工项目ID',
  dept_id BIGINT NOT NULL COMMENT '部门ID',
  position_id BIGINT NOT NULL COMMENT '岗位ID',
  employment_type TINYINT DEFAULT NULL COMMENT '1全职 2兼职 3劳务 4实习 5外包 6派遣，可后续补齐',
  fee_mode VARCHAR(80) NOT NULL DEFAULT '' COMMENT '费用模式，自定义文本',
  work_type TINYINT DEFAULT NULL COMMENT '1计时 2计件 3混合，可后续补齐',
  hire_date DATE DEFAULT NULL COMMENT '入职/生效日期，可后续补齐',
  probation_months INT DEFAULT 0 COMMENT '试用期月数',
  regular_date DATE DEFAULT NULL COMMENT '转正日期',
  work_location VARCHAR(100) DEFAULT NULL COMMENT '工作地点',
  direct_leader_id BIGINT DEFAULT NULL COMMENT '直属上级',
  job_status TINYINT NOT NULL DEFAULT 1 COMMENT '1当前 2历史',
  remark VARCHAR(255) DEFAULT NULL COMMENT '备注',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_id (employee_id),
  INDEX idx_company_customer (company_id, customer_id),
  INDEX idx_company_project_job (company_id, project_id, job_status),
  INDEX idx_company_dept (company_id, dept_id),
  INDEX idx_company_position (company_id, position_id)
) COMMENT='员工任职记录表';

CREATE TABLE hr_employee_change (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '员工异动单ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  change_type VARCHAR(20) NOT NULL COMMENT 'TRANSFER/OFFBOARD',
  source_project_id BIGINT DEFAULT NULL COMMENT '原项目',
  target_project_id BIGINT DEFAULT NULL COMMENT '目标项目',
  target_customer_id BIGINT DEFAULT NULL COMMENT '目标客户',
  target_position_id BIGINT DEFAULT NULL COMMENT '目标岗位',
  effective_date DATE NOT NULL COMMENT '生效日期',
  reason_text VARCHAR(500) DEFAULT NULL COMMENT '异动原因',
  change_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT '异动状态',
  created_by BIGINT DEFAULT NULL COMMENT '发起人',
  handled_by BIGINT DEFAULT NULL COMMENT '处理人',
  handled_at DATETIME DEFAULT NULL COMMENT '处理时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_change (company_id, employee_id, change_status),
  INDEX idx_target_project_change (company_id, target_project_id, change_status)
) COMMENT='员工转岗与离职异动单';

CREATE TABLE hr_labor_contract (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '合同ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  contract_no VARCHAR(80) NOT NULL COMMENT '合同编号',
  contract_type TINYINT NOT NULL COMMENT '1固定期限 2无固定期限 3劳务协议 4实习协议',
  sign_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未签 1已签 2作废',
  sign_date DATE DEFAULT NULL COMMENT '签署日期',
  start_date DATE NOT NULL COMMENT '开始日期',
  end_date DATE DEFAULT NULL COMMENT '结束日期',
  file_url VARCHAR(255) DEFAULT NULL COMMENT '合同附件',
  e_sign_record_id VARCHAR(100) DEFAULT NULL COMMENT '电子签记录ID',
  renewal_count INT NOT NULL DEFAULT 0 COMMENT '续签次数',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_contract_no (company_id, contract_no),
  INDEX idx_employee_id (employee_id),
  INDEX idx_end_date (end_date),
  INDEX idx_sign_status (sign_status)
) COMMENT='劳动合同表';

CREATE TABLE hr_social_security (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '社保记录ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  social_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未参保 1已参保 2停保',
  social_city VARCHAR(50) DEFAULT NULL COMMENT '参保城市',
  social_base DECIMAL(10,2) DEFAULT 0.00 COMMENT '社保基数',
  fund_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未缴 1已缴 2停缴',
  fund_base DECIMAL(10,2) DEFAULT 0.00 COMMENT '公积金基数',
  start_month CHAR(7) DEFAULT NULL COMMENT '开始月份',
  stop_month CHAR(7) DEFAULT NULL COMMENT '停止月份',
  supplier_name VARCHAR(100) DEFAULT NULL COMMENT '代缴供应商',
  employer_insurance_status TINYINT NOT NULL DEFAULT 0 COMMENT '雇主责任险 0未投保 1保障中 2已终止',
  employer_insurer VARCHAR(100) DEFAULT NULL COMMENT '雇主险承保机构',
  employer_policy_no VARCHAR(80) DEFAULT NULL COMMENT '雇主险保单号',
  employer_start_date DATE DEFAULT NULL COMMENT '雇主险生效日期',
  employer_end_date DATE DEFAULT NULL COMMENT '雇主险到期日期',
  employer_insured_amount DECIMAL(14,2) DEFAULT 0 COMMENT '雇主险保额',
  remark VARCHAR(255) DEFAULT NULL COMMENT '备注',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_id (employee_id),
  INDEX idx_company_status (company_id, social_status)
) COMMENT='社保公积金表';

CREATE TABLE hr_employee_certificate (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '证件ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  cert_type TINYINT NOT NULL COMMENT '1身份证 2健康证 3上岗证 4特种作业证 5学历证',
  cert_no VARCHAR(80) DEFAULT NULL COMMENT '证件编号',
  issue_date DATE DEFAULT NULL COMMENT '发证日期',
  expire_date DATE DEFAULT NULL COMMENT '到期日期',
  file_url VARCHAR(255) DEFAULT NULL COMMENT '附件',
  verify_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未核验 1已核验 2异常',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_id (employee_id),
  INDEX idx_expire_date (expire_date)
) COMMENT='员工证件表';

CREATE TABLE hr_resignation (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '离职记录ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  apply_date DATE DEFAULT NULL COMMENT '申请日期',
  leave_date DATE NOT NULL COMMENT '实际离职日期',
  leave_type TINYINT NOT NULL COMMENT '1主动离职 2辞退 3协商解除 4合同到期',
  leave_reason VARCHAR(255) DEFAULT NULL COMMENT '离职原因',
  handover_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未交接 1交接中 2已完成',
  badge_returned TINYINT NOT NULL DEFAULT 0 COMMENT '工牌已归还',
  tools_returned TINYINT NOT NULL DEFAULT 0 COMMENT '工服工具已归还',
  dorm_cleared TINYINT NOT NULL DEFAULT 0 COMMENT '宿舍已清退',
  attendance_confirmed TINYINT NOT NULL DEFAULT 0 COMMENT '考勤已确认',
  settlement_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未结算 1已结算',
  risk_remark VARCHAR(255) DEFAULT NULL COMMENT '离职风险备注',
  completed_by BIGINT DEFAULT NULL COMMENT '离职闭环完成人',
  completed_at DATETIME DEFAULT NULL COMMENT '离职闭环时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_id (employee_id),
  INDEX idx_leave_date (leave_date)
) COMMENT='离职记录表';

CREATE TABLE hr_risk_alert (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '风险ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  risk_type TINYINT NOT NULL COMMENT '1未签合同 2合同到期 3历史社保 4证件过期 5特殊工种 6离职流程 7雇主险异常',
  risk_level TINYINT NOT NULL COMMENT '1低 2中 3高',
  risk_title VARCHAR(100) NOT NULL COMMENT '风险标题',
  risk_desc VARCHAR(255) DEFAULT NULL COMMENT '风险描述',
  risk_key VARCHAR(120) DEFAULT NULL COMMENT '风险唯一键',
  handle_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未处理 1处理中 2已处理 3忽略',
  handler_id BIGINT DEFAULT NULL COMMENT '处理人',
  handle_time DATETIME DEFAULT NULL COMMENT '处理时间',
  handle_remark VARCHAR(255) DEFAULT NULL COMMENT '处理说明',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_risk_key (company_id, risk_key),
  INDEX idx_company_status (company_id, handle_status),
  INDEX idx_employee_id (employee_id),
  INDEX idx_risk_level (risk_level)
) COMMENT='风险预警表';

CREATE TABLE hr_operation_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  operator_id BIGINT DEFAULT NULL COMMENT '操作人',
  operator_name VARCHAR(50) DEFAULT NULL COMMENT '操作人姓名',
  module_name VARCHAR(50) NOT NULL COMMENT '模块名称',
  biz_type VARCHAR(50) NOT NULL COMMENT '业务类型',
  biz_id BIGINT NOT NULL COMMENT '业务ID',
  action_type VARCHAR(50) NOT NULL COMMENT '操作类型',
  before_data JSON DEFAULT NULL COMMENT '修改前',
  after_data JSON DEFAULT NULL COMMENT '修改后',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT 'IP',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_operator (company_id, operator_id),
  INDEX idx_biz (biz_type, biz_id),
  INDEX idx_created_at (created_at)
) COMMENT='操作日志表';

CREATE TABLE hr_system_notice (
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

CREATE TABLE hr_risk_scan_log (
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

CREATE TABLE hr_attachment (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '附件ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  biz_type VARCHAR(30) NOT NULL COMMENT 'contract/social/certificate/risk_case',
  biz_id BIGINT NOT NULL COMMENT '关联业务ID',
  employee_id BIGINT NOT NULL COMMENT '关联员工ID，用于数据隔离',
  storage_path VARCHAR(255) NOT NULL COMMENT '服务器相对存储路径',
  original_name VARCHAR(255) NOT NULL COMMENT '原始文件名',
  file_size BIGINT NOT NULL COMMENT '文件大小，字节',
  mime_type VARCHAR(100) NOT NULL COMMENT 'MIME类型',
  file_sha256 CHAR(64) NOT NULL COMMENT '文件完整性摘要',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0删除',
  created_by BIGINT NOT NULL COMMENT '上传人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_biz (company_id, biz_type, biz_id, status),
  KEY idx_employee (company_id, employee_id, status),
  KEY idx_hash (company_id, file_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合规附件';

CREATE TABLE sys_user (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '用户ID',
  company_id BIGINT DEFAULT NULL COMMENT '企业ID，平台管理员可为空',
  username VARCHAR(50) NOT NULL COMMENT '账号',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
  real_name VARCHAR(50) DEFAULT NULL COMMENT '姓名',
  phone VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  employee_id BIGINT DEFAULT NULL COMMENT '关联员工ID',
  token_version INT NOT NULL DEFAULT 0 COMMENT '会话撤销版本，密码或权限变化时递增',
  account_type VARCHAR(20) NOT NULL DEFAULT 'MANAGER' COMMENT 'MANAGER管理账号 EMPLOYEE员工账号',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间，删除后账号不可登录且不在账号列表展示',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_username (company_id, username),
  INDEX idx_company_id (company_id),
  INDEX idx_company_account_type (company_id, account_type, status),
  INDEX idx_employee_id (employee_id)
) COMMENT='系统用户表';

CREATE TABLE manager_login_device (
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

CREATE TABLE employee_wechat_binding (
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
  INDEX idx_user (company_id, user_id),
  INDEX idx_phone (company_id, phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工微信绑定历史';

CREATE TABLE employee_bind_code (
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
  INDEX idx_employee_active (company_id, employee_id, expire_at, used_at),
  INDEX idx_expire (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工一次性微信绑定码';

CREATE TABLE employee_login_audit (
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
  INDEX idx_company_employee_time (company_id, employee_id, created_at),
  INDEX idx_user_time (user_id, created_at),
  INDEX idx_action_result_time (action_type, result_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工微信登录与绑定审计';

CREATE TABLE sys_role (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '角色ID',
  company_id BIGINT DEFAULT NULL COMMENT '企业ID，系统内置角色可为空',
  role_name VARCHAR(50) NOT NULL COMMENT '角色名称',
  role_code VARCHAR(50) NOT NULL COMMENT '角色编码',
  data_scope TINYINT NOT NULL DEFAULT 1 COMMENT '1全部 2本部门及下级 3本部门 4本人 5授权项目',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_role_code (company_id, role_code)
) COMMENT='角色表';

CREATE TABLE sys_permission (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '权限ID',
  permission_name VARCHAR(80) NOT NULL COMMENT '权限名称',
  permission_code VARCHAR(100) NOT NULL COMMENT '权限编码',
  permission_type TINYINT NOT NULL COMMENT '1菜单 2按钮 3接口',
  parent_id BIGINT DEFAULT 0 COMMENT '上级权限ID',
  route_path VARCHAR(150) DEFAULT NULL COMMENT '前端路由',
  api_path VARCHAR(150) DEFAULT NULL COMMENT '接口路径',
  sort_no INT NOT NULL DEFAULT 0 COMMENT '排序',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_permission_code (permission_code)
) COMMENT='权限表';

CREATE TABLE sys_user_role (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT '用户ID',
  role_id BIGINT NOT NULL COMMENT '角色ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_role (user_id, role_id)
) COMMENT='用户角色关联表';

CREATE TABLE sys_role_permission (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  role_id BIGINT NOT NULL COMMENT '角色ID',
  permission_id BIGINT NOT NULL COMMENT '权限ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role_permission (role_id, permission_id)
) COMMENT='角色权限关联表';

CREATE TABLE sys_role_dept (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  role_id BIGINT NOT NULL COMMENT '角色ID',
  dept_id BIGINT NOT NULL COMMENT '部门ID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role_dept (role_id, dept_id)
) COMMENT='角色自定义数据部门范围表';

CREATE TABLE sys_sensitive_access_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '被查看员工ID',
  operator_id BIGINT NOT NULL COMMENT '查看人ID',
  field_name VARCHAR(50) NOT NULL COMMENT '查看字段',
  reason VARCHAR(255) NOT NULL COMMENT '查看原因',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT 'IP地址',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_employee (company_id, employee_id),
  INDEX idx_operator_id (operator_id),
  INDEX idx_created_at (created_at)
) COMMENT='敏感信息查看日志表';

CREATE TABLE crm_customer (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL COMMENT '劳务公司ID',
  customer_name VARCHAR(120) NOT NULL,
  unified_credit_code VARCHAR(50) DEFAULT NULL,
  contact_name VARCHAR(50) DEFAULT NULL,
  contact_phone VARCHAR(20) DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1合作中 2暂停 3终止',
  remark VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_customer_name (company_id, customer_name),
  INDEX idx_company_status (company_id, status)
) COMMENT='客户企业表';

CREATE TABLE labor_project (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  project_code VARCHAR(50) NOT NULL,
  project_name VARCHAR(120) NOT NULL,
  service_type TINYINT NOT NULL COMMENT '1劳务派遣 2岗位外包 3灵活用工 4RPO',
  factory_name VARCHAR(120) DEFAULT NULL,
  factory_address VARCHAR(255) DEFAULT NULL,
  manager_user_id BIGINT DEFAULT NULL,
  start_date DATE DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 2 COMMENT '2进行中 3暂停 4结束',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_project_code (company_id, project_code),
  INDEX idx_company_customer (company_id, customer_id),
  INDEX idx_company_status (company_id, status)
) COMMENT='劳务项目表';

CREATE TABLE factory_staff (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  factory_area VARCHAR(80) DEFAULT NULL,
  workshop VARCHAR(80) DEFAULT NULL,
  shift_name VARCHAR(50) DEFAULT NULL,
  dormitory VARCHAR(80) DEFAULT NULL,
  entry_date DATE NOT NULL,
  exit_date DATE DEFAULT NULL,
  onsite_manager_id BIGINT DEFAULT NULL,
  onsite_status TINYINT NOT NULL DEFAULT 1 COMMENT '1待进厂 2在厂 3请假 4已离厂',
  remark VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_company_project_status (company_id, project_id, onsite_status),
  INDEX idx_employee_id (employee_id)
) COMMENT='驻厂人员表';

CREATE TABLE person_blacklist (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL COMMENT '同一劳务公司内全公司共享',
  person_name VARCHAR(50) NOT NULL,
  id_card_no VARCHAR(255) NOT NULL COMMENT 'AES加密身份证号',
  id_card_hash CHAR(64) NOT NULL COMMENT '身份证SHA-256摘要',
  phone VARCHAR(20) DEFAULT NULL,
  blacklist_reason VARCHAR(500) NOT NULL,
  risk_level TINYINT NOT NULL DEFAULT 2 COMMENT '1提示 2高风险 3禁止录用',
  source_project_id BIGINT DEFAULT NULL,
  evidence_url VARCHAR(500) DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1生效 0解除',
  created_by BIGINT DEFAULT NULL,
  released_by BIGINT DEFAULT NULL,
  released_at DATETIME DEFAULT NULL,
  release_reason VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_id_card_hash (company_id, id_card_hash),
  INDEX idx_company_status (company_id, status)
) COMMENT='全公司共享人员黑名单';

CREATE TABLE talent_candidate (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT DEFAULT NULL COMMENT '关联员工档案ID',
  customer_id BIGINT DEFAULT NULL COMMENT '最近客户单位ID',
  project_id BIGINT DEFAULT NULL COMMENT '最近项目ID',
  position_id BIGINT DEFAULT NULL COMMENT '最近岗位ID',
  recruitment_channel_id BIGINT DEFAULT NULL COMMENT '招聘渠道ID',
  name VARCHAR(50) NOT NULL,
  id_card_no VARCHAR(255) DEFAULT NULL,
  id_card_hash CHAR(64) DEFAULT NULL,
  phone VARCHAR(20) DEFAULT NULL,
  intended_position VARCHAR(100) DEFAULT NULL,
  source_channel VARCHAR(80) DEFAULT NULL,
  candidate_status TINYINT NOT NULL DEFAULT 1 COMMENT '1新线索 2跟进中 3待入职 4已入职 5淘汰',
  talent_source_type VARCHAR(30) NOT NULL DEFAULT 'MANUAL' COMMENT 'MANUAL手工 UNJOINED未入职 RESIGNED离职回流',
  employee_status_snapshot TINYINT DEFAULT NULL COMMENT '员工状态快照',
  available_status TINYINT NOT NULL DEFAULT 1 COMMENT '1可联系 2暂不考虑 3已重新入职',
  resigned_at DATETIME DEFAULT NULL COMMENT '离职时间',
  resignation_reason VARCHAR(255) DEFAULT NULL COMMENT '离职原因',
  flowed_at DATETIME DEFAULT NULL COMMENT '最近流转时间',
  owner_user_id BIGINT DEFAULT NULL,
  last_follow_at DATETIME DEFAULT NULL,
  remark VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_company_phone (company_id, phone),
  INDEX idx_company_status (company_id, candidate_status),
  UNIQUE KEY uk_company_employee (company_id, employee_id),
  INDEX idx_company_source_status (company_id, talent_source_type, available_status),
  INDEX idx_company_customer (company_id, customer_id),
  INDEX idx_company_position (company_id, position_id),
  INDEX idx_id_card_hash (id_card_hash)
) COMMENT='人才库';

CREATE TABLE salary_advance (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT DEFAULT NULL,
  employee_id BIGINT NOT NULL,
  apply_no VARCHAR(50) NOT NULL,
  apply_amount DECIMAL(12,2) NOT NULL,
  approved_amount DECIMAL(12,2) DEFAULT NULL,
  apply_reason VARCHAR(255) NOT NULL,
  advance_status TINYINT NOT NULL DEFAULT 1 COMMENT '1待审批 2已通过 3已驳回 4已放款 5已扣回 6已取消',
  approver_id BIGINT DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  approval_remark VARCHAR(255) DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  paid_by BIGINT DEFAULT NULL,
  outstanding_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_apply_no (company_id, apply_no),
  INDEX idx_company_status (company_id, advance_status),
  INDEX idx_employee_id (employee_id)
) COMMENT='工资预支申请';

CREATE TABLE salary_import_profile (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  header_signature CHAR(64) NOT NULL,
  source_headers JSON NOT NULL,
  mapping_json JSON NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  last_used_at DATETIME DEFAULT NULL,
  created_by BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_project_signature (company_id, project_id, header_signature),
  KEY idx_company_project_status (company_id, project_id, status)
) COMMENT='项目工资表字段映射';

CREATE TABLE salary_import_template (
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
) COMMENT='项目工资表模板';

CREATE TABLE salary_batch (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT DEFAULT NULL,
  batch_no VARCHAR(50) NOT NULL,
  salary_month CHAR(7) NOT NULL,
  payroll_type TINYINT NOT NULL DEFAULT 1 COMMENT '1计时 2计件 3混合',
  import_profile_id BIGINT DEFAULT NULL COMMENT '导入字段映射ID',
  source_sheet_name VARCHAR(100) DEFAULT NULL COMMENT '原工资表工作表名称',
  employee_view_enabled TINYINT NOT NULL DEFAULT 1 COMMENT '员工端是否允许查看工资条',
  view_once TINYINT NOT NULL DEFAULT 0 COMMENT '是否阅后即焚：首次查看后不可再次打开',
  view_expires_minutes INT DEFAULT NULL COMMENT '员工端查看有效期，NULL表示不限制',
  batch_status TINYINT NOT NULL DEFAULT 1 COMMENT '1草稿 2核算中 3待复核 4待发放 5已发放 6已归档',
  total_gross DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_net DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by BIGINT DEFAULT NULL,
  paid_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_batch_no (company_id, batch_no),
  INDEX idx_company_month (company_id, salary_month)
) COMMENT='工资批次';

CREATE TABLE salary_detail (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  batch_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  base_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  position_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  performance_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowance_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  piece_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime_15_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime_20_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime_30_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  social_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
  advance_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  item_snapshot JSON DEFAULT NULL COMMENT '原工资项目快照',
  source_row_no INT DEFAULT NULL COMMENT '原工资表行号',
  receipt_status TINYINT NOT NULL DEFAULT 0 COMMENT '0未发送 1待签收 2已签收 3拒签',
  receipt_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_batch_employee (batch_id, employee_id),
  INDEX idx_company_employee (company_id, employee_id)
) COMMENT='工资明细及工资条签收';

CREATE TABLE salary_receipt_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资条证据日志ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  user_id BIGINT NOT NULL COMMENT '签收账号ID',
  action_type VARCHAR(20) NOT NULL COMMENT 'VIEW/ACCEPT/REJECT',
  result_status TINYINT NOT NULL COMMENT '操作后的签收状态',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT '客户端IP',
  user_agent VARCHAR(255) DEFAULT NULL COMMENT '设备及客户端标识',
  evidence_hash CHAR(64) NOT NULL COMMENT 'HMAC-SHA256证据摘要',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  INDEX idx_company_employee (company_id, employee_id, created_at),
  INDEX idx_salary_detail (company_id, salary_detail_id, created_at),
  INDEX idx_user_time (user_id, created_at)
) COMMENT='工资条查看与签收证据日志';

CREATE TABLE salary_signature (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资条签名ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  attachment_id BIGINT NOT NULL COMMENT '签名PNG附件ID',
  signature_sha256 CHAR(64) NOT NULL COMMENT '签名文件SHA-256',
  signed_name VARCHAR(50) NOT NULL COMMENT '签名人姓名',
  statement_version VARCHAR(20) NOT NULL DEFAULT '1.0' COMMENT '确认声明版本',
  ip_address VARCHAR(50) DEFAULT NULL COMMENT '签名IP',
  device_info VARCHAR(255) DEFAULT NULL COMMENT '设备信息',
  signed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '签名时间',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0作废',
  active_salary_detail_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN status=1 THEN salary_detail_id ELSE NULL END
  ) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_salary_signature_active (company_id, active_salary_detail_id),
  INDEX idx_employee_time (company_id, employee_id, signed_at),
  INDEX idx_attachment (company_id, attachment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工工资条手写签名证据';

CREATE TABLE salary_dispute (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '工资异议ID',
  company_id BIGINT NOT NULL COMMENT '企业ID',
  salary_detail_id BIGINT NOT NULL COMMENT '工资明细ID',
  employee_id BIGINT NOT NULL COMMENT '员工ID',
  dispute_reason VARCHAR(500) NOT NULL COMMENT '异议原因',
  handle_status TINYINT NOT NULL DEFAULT 0 COMMENT '0待处理 1处理中 2已解决 3驳回',
  open_salary_detail_id BIGINT GENERATED ALWAYS AS (
    CASE WHEN handle_status IN (0,1) THEN salary_detail_id ELSE NULL END
  ) STORED,
  handler_id BIGINT DEFAULT NULL COMMENT '处理人',
  handle_remark VARCHAR(500) DEFAULT NULL COMMENT '处理说明',
  handled_at DATETIME DEFAULT NULL COMMENT '处理时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_open_dispute (company_id, open_salary_detail_id),
  INDEX idx_company_status (company_id, handle_status, created_at),
  INDEX idx_employee (company_id, employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工工资异议';

CREATE TABLE employee_sms_verification (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT DEFAULT NULL COMMENT '唯一匹配的在职员工ID',
  purpose VARCHAR(30) NOT NULL DEFAULT 'EMPLOYEE_LOGIN',
  phone_hash CHAR(64) NOT NULL COMMENT '企业维度手机号HMAC',
  phone_tail CHAR(4) DEFAULT NULL COMMENT '手机号后四位',
  code_hash CHAR(64) NOT NULL COMMENT '验证码HMAC',
  expires_at DATETIME NOT NULL,
  failed_attempts TINYINT NOT NULL DEFAULT 0,
  send_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SENT/FAILED/SUPPRESSED',
  provider_request_id VARCHAR(100) DEFAULT NULL,
  consumed_at DATETIME DEFAULT NULL,
  request_ip_hash CHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_company_phone_time (company_id,phone_hash,created_at),
  KEY idx_company_ip_time (company_id,request_ip_hash,created_at),
  KEY idx_expiry_status (expires_at,consumed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工短信验证码';

CREATE TABLE sms_delivery_job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL COMMENT '企业ID',
  employee_id BIGINT NOT NULL COMMENT '收件员工ID',
  batch_id BIGINT DEFAULT NULL COMMENT '工资批次ID',
  payslip_id BIGINT DEFAULT NULL COMMENT '工资条ID',
  business_type VARCHAR(30) NOT NULL COMMENT 'PAYSLIP_PUBLISHED/PAYSLIP_REMINDER',
  template_key VARCHAR(40) NOT NULL,
  salary_month CHAR(7) DEFAULT NULL,
  phone_hash CHAR(64) DEFAULT NULL COMMENT '实际发送号码HMAC',
  phone_tail CHAR(4) DEFAULT NULL,
  delivery_status VARCHAR(25) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SENDING/SENT/FAILED/SKIPPED_NO_PHONE/CANCELLED',
  attempt_count TINYINT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at DATETIME DEFAULT NULL,
  provider_code VARCHAR(80) DEFAULT NULL,
  provider_request_id VARCHAR(100) DEFAULT NULL,
  provider_serial_no VARCHAR(100) DEFAULT NULL,
  error_summary VARCHAR(255) DEFAULT NULL,
  dedupe_key VARCHAR(180) NOT NULL,
  created_by BIGINT DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_dedupe (company_id,dedupe_key),
  KEY idx_pending (delivery_status,next_attempt_at),
  KEY idx_batch_status (company_id,batch_id,delivery_status),
  KEY idx_employee_time (company_id,employee_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='短信发送队列与留痕';

CREATE TABLE sys_user_project (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_project (user_id, project_id)
) COMMENT='账号授权项目范围';

CREATE TABLE attendance_project_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  rule_name VARCHAR(100) NOT NULL,
  work_start_time TIME NOT NULL,
  work_end_time TIME NOT NULL,
  rest_start_time TIME DEFAULT NULL,
  rest_end_time TIME DEFAULT NULL,
  standard_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 480,
  late_grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  early_grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  overtime_min_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  work_weekdays VARCHAR(20) NOT NULL,
  effective_from DATE NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_rule_effective (company_id, project_id, effective_from),
  KEY idx_attendance_project_rule_lookup (company_id, project_id, status, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目考勤规则版本';

CREATE TABLE attendance_project_calendar (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  calendar_date DATE NOT NULL,
  day_type VARCHAR(20) NOT NULL,
  remark VARCHAR(255) DEFAULT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_calendar_date (company_id, project_id, calendar_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目考勤特殊日期';

CREATE TABLE attendance_project_geofence (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  geofence_id BIGINT NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_project_geofence (company_id, project_id, geofence_id),
  KEY idx_attendance_project_geofence_lookup (company_id, project_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目与客户围栏关联';

CREATE TABLE attendance_geofences (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  project_id BIGINT DEFAULT NULL COMMENT '兼容历史项目围栏来源',
  fence_name VARCHAR(100) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  radius_meters INT UNSIGNED NOT NULL DEFAULT 300,
  max_accuracy_meters INT UNSIGNED NOT NULL DEFAULT 100,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_geofence_customer_name (company_id, customer_id, fence_name),
  KEY idx_attendance_geofence_customer (company_id, customer_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户考勤电子围栏';

CREATE TABLE attendance_shift_rules (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工手工班次规则';

CREATE TABLE attendance_schedules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT DEFAULT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  shift_rule_id BIGINT DEFAULT NULL,
  project_rule_id BIGINT DEFAULT NULL,
  schedule_status VARCHAR(20) NOT NULL DEFAULT 'WORK',
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_schedule (company_id, employee_id, shift_date),
  KEY idx_attendance_schedule_date (company_id, shift_date),
  KEY idx_attendance_schedule_project_date (company_id, project_id, shift_date),
  CONSTRAINT chk_attendance_schedule_rule_source CHECK ((shift_rule_id IS NOT NULL) <> (project_rule_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工考勤排班';

CREATE TABLE attendance_punches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT DEFAULT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  punch_type VARCHAR(10) NOT NULL,
  punch_time DATETIME(3) NOT NULL,
  source VARCHAR(20) NOT NULL,
  geofence_id BIGINT DEFAULT NULL,
  latitude DECIMAL(10,7) DEFAULT NULL,
  longitude DECIMAL(10,7) DEFAULT NULL,
  location_accuracy DECIMAL(10,2) DEFAULT NULL,
  distance_meters INT UNSIGNED DEFAULT NULL,
  geofence_radius_snapshot INT UNSIGNED DEFAULT NULL,
  geofence_status VARCHAR(30) NOT NULL DEFAULT 'NO_FENCE',
  location_reason VARCHAR(255) DEFAULT NULL,
  client_request_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_attendance_punch_request (company_id, employee_id, client_request_id),
  KEY idx_attendance_punch_time (company_id, employee_id, punch_time),
  KEY idx_attendance_punch_project_date (company_id, project_id, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤打卡记录';

CREATE TABLE attendance_daily_results (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT DEFAULT NULL,
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
  KEY idx_attendance_daily_status (company_id, shift_date, result_status),
  KEY idx_attendance_daily_project_date (company_id, project_id, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤每日结果';

CREATE TABLE attendance_correction_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  request_type VARCHAR(20) NOT NULL,
  punch_id BIGINT DEFAULT NULL,
  requested_time DATETIME(3) DEFAULT NULL,
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  submitted_by_employee_id BIGINT NOT NULL,
  reviewed_by BIGINT DEFAULT NULL,
  review_comment VARCHAR(500) DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_attendance_correction_punch (company_id, punch_id, request_type),
  KEY idx_attendance_correction_status (company_id, status, shift_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='考勤异常申请与审核';
