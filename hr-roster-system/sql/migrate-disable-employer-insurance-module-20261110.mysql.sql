-- 下线雇主险模块：停用权限并关闭未完成事项，完整保留历史记录和台账字段。
-- 本迁移可重复执行，不删除数据，不改写历史雇主险状态。
SET NAMES utf8mb4;
USE hr_roster;

UPDATE sys_permission
SET status = 0
WHERE permission_code = 'social:manage'
  AND status <> 0;

-- 先给每条开放待办分配唯一归档来源，避免修改 task_status 时触发
-- uk_active_task 联合唯一键冲突；第二步再关闭这些已归档待办。
UPDATE hr_work_task t
SET t.source_type = 'LEGACY_CLOSED',
    t.source_id = t.id,
    t.updated_at = NOW()
WHERE t.task_type IN ('INSURANCE', 'INSURANCE_TERMINATION', 'ONBOARDING_COMPLIANCE')
  AND t.task_status IN (0, 1);

UPDATE hr_work_task t
SET t.task_status = 3,
    t.completed_at = COALESCE(t.completed_at, NOW()),
    t.updated_at = NOW()
WHERE t.task_type IN ('INSURANCE', 'INSURANCE_TERMINATION', 'ONBOARDING_COMPLIANCE')
  AND t.source_type = 'LEGACY_CLOSED'
  AND t.task_status IN (0, 1);

UPDATE hr_risk_alert
SET handle_status = 2,
    handle_time = COALESCE(handle_time, NOW()),
    handle_remark = '功能已停用：雇主险事项已关闭',
    updated_at = NOW()
WHERE risk_type = 7
  AND handle_status IN (0, 1);
