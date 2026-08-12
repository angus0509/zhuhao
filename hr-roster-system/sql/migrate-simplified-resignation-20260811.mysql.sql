-- 简化离职流程：取消工资结算待办，保留历史字段和值用于兼容旧版本。
-- 幂等迁移，不删除任何离职、员工或审计数据。

UPDATE hr_work_task
SET task_status=3,
    completed_at=COALESCE(completed_at,NOW()),
    updated_at=NOW()
WHERE task_type='PAYROLL_SETTLEMENT'
  AND source_type='RESIGNATION'
  AND task_status IN (0,1);

UPDATE hr_resignation
SET settlement_status=1,
    updated_at=NOW()
WHERE completed_at IS NULL
  AND settlement_status<>1;
