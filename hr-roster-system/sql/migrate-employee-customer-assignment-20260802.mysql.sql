-- 员工客户单位归属迁移，可重复执行。
-- 仅处理未分配客户的员工岗位，不修改已有真实客户归属和岗位名称。
SET NAMES utf8mb4;
USE hr_roster;

-- 1. 补充客户单位字段。
SET @customer_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hr_employee_job'
    AND COLUMN_NAME = 'customer_id'
);
SET @customer_column_sql = IF(
  @customer_column_exists = 0,
  'ALTER TABLE hr_employee_job ADD COLUMN customer_id BIGINT DEFAULT NULL COMMENT ''员工所属客户单位ID'' AFTER employee_id',
  'SELECT ''customer_id column already exists'''
);
PREPARE customer_column_stmt FROM @customer_column_sql;
EXECUTE customer_column_stmt;
DEALLOCATE PREPARE customer_column_stmt;

-- 2. 补充查询索引。
SET @customer_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hr_employee_job'
    AND INDEX_NAME = 'idx_company_customer'
);
SET @customer_index_sql = IF(
  @customer_index_exists = 0,
  'ALTER TABLE hr_employee_job ADD INDEX idx_company_customer (company_id, customer_id)',
  'SELECT ''idx_company_customer already exists'''
);
PREPARE customer_index_stmt FROM @customer_index_sql;
EXECUTE customer_index_stmt;
DEALLOCATE PREPARE customer_index_stmt;

-- 3. 如果已有待分配客户被停用，在确有未分配员工的公司中重新启用。
UPDATE crm_customer cu
JOIN (
  SELECT DISTINCT company_id
  FROM hr_employee_job
  WHERE customer_id IS NULL
) pending ON pending.company_id = cu.company_id
SET cu.status = 1
WHERE cu.customer_name = '待分配客户单位'
  AND cu.status <> 1;

-- 4. 为仍不存在待分配客户的公司创建兜底客户。
INSERT INTO crm_customer (company_id, customer_name, status, remark)
SELECT pending.company_id,
       '待分配客户单位',
       1,
       '系统自动创建：存在未归属客户单位的员工岗位记录'
FROM (
  SELECT DISTINCT company_id
  FROM hr_employee_job
  WHERE customer_id IS NULL
) pending
WHERE NOT EXISTS (
  SELECT 1
  FROM crm_customer cu
  WHERE cu.company_id = pending.company_id
    AND cu.customer_name = '待分配客户单位'
    AND cu.status = 1
);

-- 5. 只回填未分配员工；已有真实客户归属不受影响。
UPDATE hr_employee_job j
JOIN (
  SELECT company_id, MIN(id) AS customer_id
  FROM crm_customer
  WHERE customer_name = '待分配客户单位'
    AND status = 1
  GROUP BY company_id
) fallback ON fallback.company_id = j.company_id
SET j.customer_id = fallback.customer_id
WHERE j.customer_id IS NULL;

-- 6. 迁移后验证。生产部署脚本要求结果必须为 0 行。
SELECT company_id, COUNT(*) AS unassigned_count
FROM hr_employee_job
WHERE customer_id IS NULL
GROUP BY company_id;
