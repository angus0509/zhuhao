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
  lifecycle_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/PENDING_ARRIVAL/ONBOARDING/ACTIVE/TRANSFERRING/OFFBOARDING/LEFT/CANCELLED/VOID',
  arrival_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/CONFIRMED/NO_SHOW',
  insurance_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/PROCESSING/PENDING_EFFECTIVE/ACTIVE/TERMINATING/TERMINATED/FAILED',
  contract_status VARCHAR(30) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/SIGNED/EXPIRING/EXPIRED/TERMINATED',
  document_status VARCHAR(30) NOT NULL DEFAULT 'INCOMPLETE' COMMENT 'INCOMPLETE/COMPLETE/ABNORMAL',
  risk_level TINYINT NOT NULL DEFAULT 1 COMMENT '综合风险等级：1低 2中 3高',
  employee_status TINYINT NOT NULL DEFAULT 1 COMMENT '1待入职 2在职 3离职 4黑名单',
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
  task_type VARCHAR(50) NOT NULL COMMENT 'ARRIVAL/INSURANCE/CONTRACT/DOCUMENT/OFFBOARD/INSURANCE_TERMINATION/PAYROLL_SETTLEMENT',
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
  employment_type TINYINT NOT NULL COMMENT '1全职 2兼职 3劳务 4实习 5外包 6派遣',
  fee_mode VARCHAR(80) NOT NULL DEFAULT '' COMMENT '费用模式，自定义文本',
  work_type TINYINT NOT NULL DEFAULT 1 COMMENT '1计时 2计件 3混合',
  hire_date DATE NOT NULL COMMENT '入职/生效日期',
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
  risk_type TINYINT NOT NULL COMMENT '1未签合同 2合同到期 3社保异常 4证件过期 5特殊工种 6离职流程',
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
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_company_username (company_id, username),
  INDEX idx_company_id (company_id),
  INDEX idx_employee_id (employee_id)
) COMMENT='系统用户表';

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
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1筹备 2进行中 3暂停 4结束',
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
  name VARCHAR(50) NOT NULL,
  id_card_no VARCHAR(255) DEFAULT NULL,
  id_card_hash CHAR(64) DEFAULT NULL,
  phone VARCHAR(20) NOT NULL,
  intended_position VARCHAR(100) DEFAULT NULL,
  source_channel VARCHAR(80) DEFAULT NULL,
  candidate_status TINYINT NOT NULL DEFAULT 1 COMMENT '1新线索 2跟进中 3待入职 4已入职 5淘汰',
  owner_user_id BIGINT DEFAULT NULL,
  last_follow_at DATETIME DEFAULT NULL,
  remark VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_company_phone (company_id, phone),
  INDEX idx_company_status (company_id, candidate_status),
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

CREATE TABLE salary_batch (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT NOT NULL,
  project_id BIGINT DEFAULT NULL,
  batch_no VARCHAR(50) NOT NULL,
  salary_month CHAR(7) NOT NULL,
  payroll_type TINYINT NOT NULL DEFAULT 1 COMMENT '1计时 2计件 3混合',
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

CREATE TABLE sys_user_project (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_project (user_id, project_id)
) COMMENT='账号授权项目范围';
