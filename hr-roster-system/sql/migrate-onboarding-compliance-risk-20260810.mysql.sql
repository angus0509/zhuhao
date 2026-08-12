-- 将用工风险中心简化为新员工入职的劳动合同、雇主险两项合规，可重复执行。
SET NAMES utf8mb4;
USE hr_roster;

-- 为历史在职员工补齐“未签合同”风险，统一风险键避免后续重复生成。
INSERT IGNORE INTO hr_risk_alert
(company_id,employee_id,risk_type,risk_level,risk_title,risk_desc,risk_key,handle_status)
SELECT e.company_id,e.id,1,3,'新员工劳动合同待签订',
       CONCAT(e.name,'已入职，请登记已签订的劳动合同'),
       CONCAT('contract_missing:',e.id),0
FROM hr_employee e
WHERE e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM hr_labor_contract c
    WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1);

-- 为历史在职员工补齐“雇主险待增保”风险。
INSERT IGNORE INTO hr_risk_alert
(company_id,employee_id,risk_type,risk_level,risk_title,risk_desc,risk_key,handle_status)
SELECT e.company_id,e.id,7,3,'新员工雇主险待增保',
       CONCAT(e.name,'已入职，请办理雇主险增保'),
       CONCAT('employer_insurance_missing:',e.id),0
FROM hr_employee e
WHERE e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM hr_social_security s
    WHERE s.id=(SELECT s2.id FROM hr_social_security s2
      WHERE s2.company_id=e.company_id AND s2.employee_id=e.id ORDER BY s2.id DESC LIMIT 1)
      AND s.employer_insurance_status=1
      AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()));

-- 驻厂角色通过工作待办接口查看自己项目内的事项；为历史员工补齐可直接办理的合同待办。
INSERT INTO hr_work_task
(company_id,employee_id,project_id,task_type,task_title,task_content,source_type,source_id,risk_level,task_status,assigned_user_id,deadline)
SELECT e.company_id,e.id,
       (SELECT j.project_id FROM hr_employee_job j
        WHERE j.company_id=e.company_id AND j.employee_id=e.id AND j.job_status=1
        ORDER BY j.id DESC LIMIT 1),
       'CONTRACT',CONCAT(e.name,'劳动合同待签'),'登记劳动合同并确认签订状态',
       'EMPLOYEE_ONBOARDING',e.id,3,0,NULL,NULL
FROM hr_employee e
WHERE e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM hr_labor_contract c
    WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1)
  AND NOT EXISTS (SELECT 1 FROM hr_work_task t
    WHERE t.company_id=e.company_id AND t.employee_id=e.id
      AND t.task_type='CONTRACT' AND t.task_status IN (0,1));

-- 为历史员工补齐雇主险待办；不授予额外风险权限，仍沿用驻厂项目数据范围。
INSERT INTO hr_work_task
(company_id,employee_id,project_id,task_type,task_title,task_content,source_type,source_id,risk_level,task_status,assigned_user_id,deadline)
SELECT e.company_id,e.id,
       (SELECT j.project_id FROM hr_employee_job j
        WHERE j.company_id=e.company_id AND j.employee_id=e.id AND j.job_status=1
        ORDER BY j.id DESC LIMIT 1),
       'INSURANCE',CONCAT(e.name,'雇主险待增保'),'办理雇主险增保并登记结果',
       'EMPLOYEE_ONBOARDING',e.id,3,0,NULL,NULL
FROM hr_employee e
WHERE e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM hr_social_security s
    WHERE s.id=(SELECT s2.id FROM hr_social_security s2
      WHERE s2.company_id=e.company_id AND s2.employee_id=e.id ORDER BY s2.id DESC LIMIT 1)
      AND s.employer_insurance_status=1
      AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()))
  AND NOT EXISTS (SELECT 1 FROM hr_work_task t
    WHERE t.company_id=e.company_id AND t.employee_id=e.id
      AND t.task_type='INSURANCE' AND t.task_status IN (0,1));

-- 非核心风险保留历史记录但不再进入待处理队列。
UPDATE hr_risk_alert
SET handle_status=2,handle_time=NOW(),handle_remark='已移出入职合规中心'
WHERE risk_type NOT IN (1,7) AND handle_status IN (0,1);

-- 根据真实业务数据关闭已办结风险，修复此前提醒与合同/雇主险未关联的问题。
UPDATE hr_risk_alert r
SET r.handle_status=2,r.handle_time=NOW(),r.handle_remark='系统核验：劳动合同已签订'
WHERE r.risk_type=1 AND r.handle_status IN (0,1)
  AND EXISTS (SELECT 1 FROM hr_labor_contract c
    WHERE c.company_id=r.company_id AND c.employee_id=r.employee_id AND c.sign_status=1);

UPDATE hr_risk_alert r
SET r.handle_status=2,r.handle_time=NOW(),r.handle_remark='系统核验：雇主险保障中'
WHERE r.risk_type=7 AND r.handle_status IN (0,1)
  AND EXISTS (SELECT 1 FROM hr_social_security s
    WHERE s.id=(SELECT s2.id FROM hr_social_security s2
      WHERE s2.company_id=r.company_id AND s2.employee_id=r.employee_id ORDER BY s2.id DESC LIMIT 1)
      AND s.employer_insurance_status=1
      AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()));

-- INSERT IGNORE 遇到历史已关闭的同键提醒时不会新增，必须按真实状态重新打开。
UPDATE hr_risk_alert r
JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
SET r.handle_status=0,r.handler_id=NULL,r.handle_time=NULL,r.handle_remark='系统复查：劳动合同当前未签订'
WHERE r.risk_type=1 AND r.handle_status=2
  AND e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM hr_labor_contract c
    WHERE c.company_id=r.company_id AND c.employee_id=r.employee_id AND c.sign_status=1);

UPDATE hr_risk_alert r
JOIN hr_employee e ON e.id=r.employee_id AND e.company_id=r.company_id
SET r.handle_status=0,r.handler_id=NULL,r.handle_time=NULL,r.handle_remark='系统复查：雇主险当前未生效'
WHERE r.risk_type=7 AND r.handle_status=2
  AND e.employee_status=2 AND e.lifecycle_status<>'OFFBOARDING' AND e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM hr_social_security s
    WHERE s.id=(SELECT s2.id FROM hr_social_security s2
      WHERE s2.company_id=r.company_id AND s2.employee_id=r.employee_id ORDER BY s2.id DESC LIMIT 1)
      AND s.employer_insurance_status=1
      AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()));

-- 同步员工合规快照，保证合同、雇主险和员工生命周期三处状态一致。
UPDATE hr_employee e
SET e.contract_status='SIGNED'
WHERE e.employee_status=2 AND e.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM hr_labor_contract c
    WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1);

UPDATE hr_employee e
SET e.insurance_status='ACTIVE'
WHERE e.employee_status=2 AND e.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM hr_social_security s
    WHERE s.id=(SELECT s2.id FROM hr_social_security s2
      WHERE s2.company_id=e.company_id AND s2.employee_id=e.id ORDER BY s2.id DESC LIMIT 1)
      AND s.employer_insurance_status=1
      AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()));

UPDATE hr_employee e
SET e.lifecycle_status='ONBOARDING'
WHERE e.employee_status=2 AND e.deleted_at IS NULL
  AND (NOT EXISTS (SELECT 1 FROM hr_labor_contract c
         WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1)
    OR NOT EXISTS (SELECT 1 FROM hr_social_security s
         WHERE s.id=(SELECT s2.id FROM hr_social_security s2
           WHERE s2.company_id=e.company_id AND s2.employee_id=e.id ORDER BY s2.id DESC LIMIT 1)
           AND s.employer_insurance_status=1
           AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE())));

UPDATE hr_employee e
SET e.lifecycle_status='ACTIVE'
WHERE e.employee_status=2 AND e.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM hr_labor_contract c
    WHERE c.company_id=e.company_id AND c.employee_id=e.id AND c.sign_status=1)
  AND EXISTS (SELECT 1 FROM hr_social_security s
    WHERE s.id=(SELECT s2.id FROM hr_social_security s2
      WHERE s2.company_id=e.company_id AND s2.employee_id=e.id ORDER BY s2.id DESC LIMIT 1)
      AND s.employer_insurance_status=1
      AND (s.employer_end_date IS NULL OR s.employer_end_date>=CURRENT_DATE()));
