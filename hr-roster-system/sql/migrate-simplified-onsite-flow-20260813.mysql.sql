SET NAMES utf8mb4;

-- 将在职员工原有合同、雇主险开放待办合并为一条员工级待办。
INSERT INTO hr_work_task
(company_id,employee_id,project_id,task_type,task_title,task_content,source_type,source_id,
 risk_level,task_status,assigned_user_id,deadline)
SELECT e.company_id,e.id,j.project_id,'ONBOARDING_COMPLIANCE',CONCAT(e.name,'合同和雇主险待确认'),
       '一键确认劳动合同已签和雇主险已增保','EMPLOYEE_ONBOARDING',e.id,3,0,
       COALESCE(MAX(t.assigned_user_id),e.created_by),MAX(t.deadline)
FROM hr_employee e
LEFT JOIN hr_employee_job j ON j.id=(
  SELECT j2.id FROM hr_employee_job j2
  WHERE j2.company_id=e.company_id AND j2.employee_id=e.id
  ORDER BY (j2.job_status=1) DESC,j2.id DESC LIMIT 1
)
LEFT JOIN hr_work_task t ON t.company_id=e.company_id AND t.employee_id=e.id
  AND t.task_type IN ('CONTRACT','INSURANCE') AND t.task_status IN (0,1)
WHERE e.employee_status=2 AND e.deleted_at IS NULL
  AND e.lifecycle_status<>'OFFBOARDING'
  AND (e.contract_status<>'SIGNED' OR e.insurance_status<>'ACTIVE')
GROUP BY e.company_id,e.id,j.project_id,e.name,e.created_by
ON DUPLICATE KEY UPDATE
  project_id=VALUES(project_id),task_title=VALUES(task_title),task_content=VALUES(task_content),
  risk_level=VALUES(risk_level),assigned_user_id=COALESCE(assigned_user_id,VALUES(assigned_user_id)),
  deadline=COALESCE(deadline,VALUES(deadline)),updated_at=NOW();

-- 保留旧待办历史，只关闭尚未完成的重复入口。
UPDATE hr_work_task legacy
JOIN (
  SELECT company_id,employee_id
  FROM hr_work_task
  WHERE task_type='ONBOARDING_COMPLIANCE' AND task_status IN (0,1)
  GROUP BY company_id,employee_id
) merged ON merged.company_id=legacy.company_id AND merged.employee_id=legacy.employee_id
SET task_status=3,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
WHERE legacy.task_type IN ('CONTRACT','INSURANCE') AND legacy.task_status IN (0,1);
