SET NAMES utf8mb4;

-- 驻厂快速办理不再使用合同、雇主险和合并合规待办。
-- 保留全部历史记录，只关闭仍开放的旧入口。
UPDATE hr_work_task t
SET t.source_type='LEGACY_CLOSED',
    t.source_id=t.id,
    t.task_status=3,
    t.completed_at=COALESCE(t.completed_at,NOW()),
    t.updated_at=NOW()
WHERE t.task_type IN ('CONTRACT','INSURANCE','ONBOARDING_COMPLIANCE')
  AND t.task_status IN (0,1);

-- 历史面试人员并入待到岗，避免继续停留在已取消的面试入口。
UPDATE hr_employee
SET employee_status=1,lifecycle_status='PENDING_ARRIVAL',arrival_status='PENDING',updated_at=NOW()
WHERE employee_status=6 AND deleted_at IS NULL;
