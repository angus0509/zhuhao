-- 停用合同、雇主险旧待办与风险通知：保留历史记录，仅关闭未完成项。
-- 幂等执行，不删除业务数据。
SET NAMES utf8mb4;
USE hr_roster;

UPDATE hr_work_task
SET task_status = 3,
    completed_at = COALESCE(completed_at, NOW()),
    updated_at = NOW()
WHERE task_type IN ('CONTRACT', 'INSURANCE', 'ONBOARDING_COMPLIANCE')
  AND task_status IN (0, 1);

UPDATE hr_risk_alert
SET handle_status = 2,
    handle_time = COALESCE(handle_time, NOW()),
    handle_remark = '功能已停用：合同/雇主险风险通知已关闭',
    updated_at = NOW()
WHERE risk_type IN (1, 2, 3, 7)
  AND handle_status IN (0, 1);
