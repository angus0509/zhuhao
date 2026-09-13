-- 取消项目“筹备”状态：历史筹备项目直接转为进行中，不删除任何业务数据。
UPDATE labor_project
SET status = 2
WHERE status = 1;

ALTER TABLE labor_project
  MODIFY status TINYINT NOT NULL DEFAULT 2 COMMENT '2进行中 3暂停 4结束';
