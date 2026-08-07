-- 员工归属客户单位及制造业常用岗位，可重复执行。
-- 按公司逐家处理：存在 customer_id IS NULL 的员工时，为该公司创建"待分配客户单位"并回填。
SET NAMES utf8mb4;
USE hr_roster;

-- 1. 为 hr_employee_job 补充 customer_id 列（如果不存在）
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hr_employee_job' AND COLUMN_NAME = 'customer_id'
);
SET @col_sql = IF(
  @col_exists = 0,
  'ALTER TABLE hr_employee_job ADD COLUMN customer_id BIGINT DEFAULT NULL COMMENT ''员工所属客户单位ID'' AFTER employee_id, ADD INDEX idx_company_customer (company_id, customer_id)',
  'SELECT ''customer_id column already exists'''
);
PREPARE col_stmt FROM @col_sql;
EXECUTE col_stmt;
DEALLOCATE PREPARE col_stmt;

-- 2. 为存在未分配员工的公司插入"待分配客户单位"（NOT EXISTS 防重复）
INSERT INTO crm_customer (company_id, customer_name, status, remark)
SELECT j.company_id, '待分配客户单位', 1, '系统自动创建：存在未归属客户单位的员工岗位记录'
FROM hr_employee_job j
WHERE j.customer_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm_customer cu
    WHERE cu.company_id = j.company_id
      AND cu.customer_name = '待分配客户单位'
      AND cu.status = 1
  )
GROUP BY j.company_id;

-- 3. 将未分配员工关联到"待分配客户单位"
--    仅更新 customer_id IS NULL 的行，已分配真实客户的行不受影响
UPDATE hr_employee_job j
JOIN crm_customer cu
  ON cu.company_id = j.company_id
 AND cu.customer_name = '待分配客户单位'
 AND cu.status = 1
SET j.customer_id = cu.id
WHERE j.customer_id IS NULL;

-- 4. 补充制造业常用岗位（WHERE NOT EXISTS 防重复）
INSERT INTO hr_position (company_id, position_name, position_code, risk_level, is_special_work, status)
SELECT c.id, p.position_name, p.position_code, p.risk_level, p.is_special_work, 1
FROM hr_company c
JOIN (
  SELECT '装配工' position_name, 'ASSEMBLY' position_code, 1 risk_level, 0 is_special_work
  UNION ALL SELECT '包装工', 'PACKING', 1, 0
  UNION ALL SELECT '机台操作工', 'MACHINE-OP', 2, 0
  UNION ALL SELECT '冲压工', 'STAMPING', 3, 1
  UNION ALL SELECT '注塑工', 'INJECTION', 2, 0
  UNION ALL SELECT '数控操作工', 'CNC-OP', 2, 0
  UNION ALL SELECT '仓库管理员', 'WAREHOUSE', 1, 0
  UNION ALL SELECT '叉车工', 'FORKLIFT', 3, 1
  UNION ALL SELECT '物料员', 'MATERIAL', 1, 0
  UNION ALL SELECT '设备维修工', 'MAINTENANCE', 3, 1
  UNION ALL SELECT '生产文员', 'MFG-CLERK', 1, 0
  UNION ALL SELECT '行政文员', 'ADMIN-CLERK', 1, 0
  UNION ALL SELECT '招聘专员', 'RECRUITER', 1, 0
  UNION ALL SELECT '驻厂专员', 'ONSITE-HR', 1, 0
  UNION ALL SELECT '薪酬专员', 'PAYROLL-HR', 1, 0
  UNION ALL SELECT '客服专员', 'CUSTOMER-SERVICE', 1, 0
  UNION ALL SELECT '数据录入员', 'DATA-ENTRY', 1, 0
) p
WHERE NOT EXISTS (
  SELECT 1 FROM hr_position hp WHERE hp.company_id = c.id AND hp.position_code = p.position_code
);

-- 按稳定岗位编码纠正旧客户端字符集可能造成的中文乱码
UPDATE hr_position SET position_name = CASE position_code
  WHEN 'ASSEMBLY' THEN '装配工'
  WHEN 'PACKING' THEN '包装工'
  WHEN 'MACHINE-OP' THEN '机台操作工'
  WHEN 'STAMPING' THEN '冲压工'
  WHEN 'INJECTION' THEN '注塑工'
  WHEN 'CNC-OP' THEN '数控操作工'
  WHEN 'WAREHOUSE' THEN '仓库管理员'
  WHEN 'FORKLIFT' THEN '叉车工'
  WHEN 'MATERIAL' THEN '物料员'
  WHEN 'MAINTENANCE' THEN '设备维修工'
  WHEN 'MFG-CLERK' THEN '生产文员'
  WHEN 'ADMIN-CLERK' THEN '行政文员'
  WHEN 'RECRUITER' THEN '招聘专员'
  WHEN 'ONSITE-HR' THEN '驻厂专员'
  WHEN 'PAYROLL-HR' THEN '薪酬专员'
  WHEN 'CUSTOMER-SERVICE' THEN '客服专员'
  WHEN 'DATA-ENTRY' THEN '数据录入员'
  ELSE position_name END
WHERE position_code IN ('ASSEMBLY','PACKING','MACHINE-OP','STAMPING','INJECTION','CNC-OP','WAREHOUSE','FORKLIFT','MATERIAL','MAINTENANCE','MFG-CLERK','ADMIN-CLERK','RECRUITER','ONSITE-HR','PAYROLL-HR','CUSTOMER-SERVICE','DATA-ENTRY');

-- ============================================================
-- 迁移后验证（预期结果：0 行）
-- SELECT company_id, COUNT(*) FROM hr_employee_job WHERE customer_id IS NULL GROUP BY company_id;
-- 若返回行数 > 0，说明回填未完成，应排查后再继续部署。
-- ============================================================
