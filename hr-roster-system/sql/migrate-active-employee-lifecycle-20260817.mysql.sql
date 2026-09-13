-- 已在职员工必须使用 ACTIVE 生命周期；重复执行不会影响其他人员状态。
START TRANSACTION;

UPDATE hr_employee
SET lifecycle_status = 'ACTIVE',
    updated_at = NOW()
WHERE employee_status = 2
  AND lifecycle_status = 'ONBOARDING'
  AND deleted_at IS NULL;

COMMIT;
