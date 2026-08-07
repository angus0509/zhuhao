#!/bin/bash
# 腾讯云生产部署脚本。
# 用法：bash /tmp/deploy-production.sh <发布包绝对路径> <预期SHA-256>
set -euo pipefail
umask 077

if [ "$#" -ne 2 ]; then
  echo "用法: $0 <发布包绝对路径> <预期SHA-256>" >&2
  exit 1
fi

DEPLOY_ARCHIVE="$1"
EXPECTED_SHA256="$2"
PROJECT_DIR="/opt/moluo-hr"
BACKUP_DIR="/opt/moluo-backups"
MYSQL_CONTAINER="moluo-mysql-prod"
APP_CONTAINER="moluo-hr-app"
ENV_FILE="$PROJECT_DIR/.env.production"

test -f "$DEPLOY_ARCHIVE" || { echo "发布包不存在: $DEPLOY_ARCHIVE" >&2; exit 1; }
test -d "$PROJECT_DIR" || { echo "生产目录不存在: $PROJECT_DIR" >&2; exit 1; }
test -f "$ENV_FILE" || { echo "生产环境配置不存在: $ENV_FILE" >&2; exit 1; }
test -f "$PROJECT_DIR/docker-compose.prod.yml" || { echo "缺少 docker-compose.prod.yml" >&2; exit 1; }

ACTUAL_SHA256="$(sha256sum "$DEPLOY_ARCHIVE" | awk '{print $1}')"
test "$EXPECTED_SHA256" = "$ACTUAL_SHA256" || {
  echo "发布包SHA-256不一致，停止部署" >&2
  exit 1
}

# 解压前拒绝绝对路径、路径穿越以及符号/硬链接。
ARCHIVE_LIST="$(tar tzf "$DEPLOY_ARCHIVE")"
ARCHIVE_DETAIL="$(tar tvzf "$DEPLOY_ARCHIVE")"
if echo "$ARCHIVE_LIST" | grep -Eq '^/|(^|/)\.\.(/|$)'; then
  echo "发布包包含危险路径，停止部署" >&2
  exit 1
fi
if echo "$ARCHIVE_DETAIL" | awk '{print $1}' | grep -Eq '^[lh]'; then
  echo "发布包包含符号链接或硬链接，停止部署" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAGE_DIR="$(mktemp -d /opt/moluo-release.XXXXXX)"
cleanup() {
  rm -rf "$STAGE_DIR"
  unset MYSQL_ROOT_PASSWORD DB_PASSWORD JWT_SECRET DATA_ENCRYPT_KEY DATA_ENCRYPT_IV || true
}
trap cleanup EXIT

# 先解压到隔离目录，迁移文件与代码均从已校验发布包读取。
tar xzf "$DEPLOY_ARCHIVE" -C "$STAGE_DIR"
test -f "$STAGE_DIR/package.json" || { echo "发布包结构错误" >&2; exit 1; }

CODE_BACKUP="$BACKUP_DIR/code-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$CODE_BACKUP" \
  --exclude='.env*' \
  --exclude='node_modules' \
  --exclude='.runtime' \
  --exclude='data' \
  --exclude='uploads' \
  --exclude='*.sql' \
  --exclude='*.sql.gz' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='*.p12' \
  --exclude='*.pfx' \
  -C /opt moluo-hr
chmod 600 "$CODE_BACKUP"
test -s "$CODE_BACKUP"
tar tzf "$CODE_BACKUP" >/dev/null

# 合规附件与代码分开备份，避免代码归档重复打包敏感材料。
mkdir -p "$PROJECT_DIR/uploads"
ATTACHMENT_BACKUP="$BACKUP_DIR/attachments-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$ATTACHMENT_BACKUP" -C "$PROJECT_DIR" uploads
chmod 600 "$ATTACHMENT_BACKUP"
tar tzf "$ATTACHMENT_BACKUP" >/dev/null

ENV_SHA_BEFORE="$(sha256sum "$ENV_FILE" | awk '{print $1}')"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${MYSQL_ROOT_PASSWORD:?生产环境缺少MYSQL_ROOT_PASSWORD}"
: "${DB_PASSWORD:?生产环境缺少DB_PASSWORD}"
: "${JWT_SECRET:?生产环境缺少JWT_SECRET}"
: "${DATA_ENCRYPT_KEY:?生产环境缺少DATA_ENCRYPT_KEY}"
: "${DATA_ENCRYPT_IV:?生产环境缺少DATA_ENCRYPT_IV}"
test "${#JWT_SECRET}" -ge 32 || { echo "JWT_SECRET长度不能少于32字符" >&2; exit 1; }
test "${#DATA_ENCRYPT_KEY}" -eq 32 || { echo "DATA_ENCRYPT_KEY必须为32字符" >&2; exit 1; }
test "${#DATA_ENCRYPT_IV}" -eq 16 || { echo "DATA_ENCRYPT_IV必须为16字符" >&2; exit 1; }

DB_BACKUP="$BACKUP_DIR/hr_roster-$(date +%Y%m%d-%H%M%S).sql.gz"
docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL_CONTAINER" \
  mysqldump -uroot --single-transaction --routines --triggers \
    --default-character-set=utf8mb4 hr_roster | gzip > "$DB_BACKUP"
chmod 600 "$DB_BACKUP"
gzip -t "$DB_BACKUP"
test -s "$DB_BACKUP"
# 不使用 grep -q，避免 pipefail 下 gzip 因下游提前退出产生 SIGPIPE 误报。
gzip -dc "$DB_BACKUP" | grep "Table structure for table" >/dev/null

run_migration() {
  local migration="$1"
  test -f "$migration" || { echo "迁移文件不存在: $migration" >&2; exit 1; }
  docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL_CONTAINER" \
    mysql -uroot --default-character-set=utf8mb4 hr_roster < "$migration"
}

# 三个迁移均为幂等操作，统一执行，避免字段存在但历史数据仍未回填。
run_migration "$STAGE_DIR/sql/migrate-employee-audit-columns-20260801.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-employee-customer-assignment-20260802.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-menu-permissions-20260801.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-system-notices-20260804.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-risk-scan-log-20260804.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-attachments-20260804.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-onsite-employee-edit-permission-20260806.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-recruitment-channel-20260806.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-payslip-receipt-audit-20260806.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-token-version-20260806.mysql.sql"
run_migration "$STAGE_DIR/sql/migrate-remove-insurance-menu-20260807.mysql.sql"

# 驻厂生命周期迁移为一次性结构升级。若核心待办表已存在则不重复执行，随后统一核对完整性。
ONSITE_MIGRATED="$(docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL_CONTAINER" \
  mysql -uroot -N -B --default-character-set=utf8mb4 information_schema -e "SELECT COUNT(*) FROM TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_work_task'")"
if [ "$ONSITE_MIGRATED" = "0" ]; then
  run_migration "$STAGE_DIR/sql/migrate-onsite-lifecycle-v1-20260805.mysql.sql"
else
  echo "驻厂生命周期核心表已存在，跳过一次性迁移并执行完整性核对"
fi

mysql_scalar() {
  local sql="$1"
  docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL_CONTAINER" \
    mysql -uroot -N -B --default-character-set=utf8mb4 hr_roster -e "$sql"
}

UNASSIGNED_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM hr_employee_job WHERE customer_id IS NULL")"
test "$UNASSIGNED_COUNT" = "0" || { echo "仍有 $UNASSIGNED_COUNT 条员工岗位未关联客户" >&2; exit 1; }

AUDIT_COLUMN_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_employee' AND COLUMN_NAME IN ('channel_source','created_by')")"
test "$AUDIT_COLUMN_COUNT" = "2" || { echo "员工审计字段迁移不完整" >&2; exit 1; }

PERMISSION_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM sys_permission WHERE permission_code IN ('office:menu','dashboard:menu','blacklist:menu','talent:menu','advance:menu','payroll:menu','riskCase:menu','audit:menu','audit:view','permission:menu') AND status=1")"
test "$PERMISSION_COUNT" = "10" || { echo "菜单及查看权限迁移不完整: $PERMISSION_COUNT/10" >&2; exit 1; }

REMOVED_INSURANCE_PERMISSION_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM sys_permission WHERE permission_code IN ('insurance:menu','insurance:view') AND status=0")"
test "$REMOVED_INSURANCE_PERMISSION_COUNT" = "2" || { echo "保险提示旧权限未完全停用" >&2; exit 1; }

NOTICE_TABLE_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_system_notice'")"
test "$NOTICE_TABLE_COUNT" = "1" || { echo "系统通知表迁移不完整" >&2; exit 1; }

RISK_SCAN_TABLE_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_risk_scan_log'")"
test "$RISK_SCAN_TABLE_COUNT" = "1" || { echo "风险扫描日志表迁移不完整" >&2; exit 1; }

ATTACHMENT_TABLE_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_attachment'")"
test "$ATTACHMENT_TABLE_COUNT" = "1" || { echo "合规附件表迁移不完整" >&2; exit 1; }

RECRUITMENT_CHANNEL_READY="$(mysql_scalar "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_recruitment_channel') + (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_employee' AND COLUMN_NAME='recruitment_channel_id')")"
test "$RECRUITMENT_CHANNEL_READY" = "2" || { echo "招聘渠道台账迁移不完整" >&2; exit 1; }

PAYSLIP_RECEIPT_LOG_READY="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='salary_receipt_log'")"
test "$PAYSLIP_RECEIPT_LOG_READY" = "1" || { echo "工资条签收证据表迁移不完整" >&2; exit 1; }

TOKEN_VERSION_READY="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='sys_user' AND COLUMN_NAME='token_version'")"
test "$TOKEN_VERSION_READY" = "1" || { echo "账号Token版本字段迁移不完整" >&2; exit 1; }

ONSITE_TABLE_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME IN ('hr_employee_change','hr_recruiter','hr_recruitment_supplier','hr_work_task')")"
test "$ONSITE_TABLE_COUNT" = "4" || { echo "驻厂生命周期数据表迁移不完整: $ONSITE_TABLE_COUNT/4" >&2; exit 1; }

ONSITE_EMPLOYEE_COLUMN_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_employee' AND COLUMN_NAME IN ('recruitment_source_type','recruiter_id','supplier_id','source_locked','source_confirmed_at','lifecycle_status','arrival_status','insurance_status','contract_status','document_status','risk_level')")"
test "$ONSITE_EMPLOYEE_COLUMN_COUNT" = "11" || { echo "员工生命周期字段迁移不完整: $ONSITE_EMPLOYEE_COLUMN_COUNT/11" >&2; exit 1; }

OFFBOARD_COLUMN_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hr_roster' AND TABLE_NAME='hr_resignation' AND COLUMN_NAME IN ('badge_returned','tools_returned','dorm_cleared','attendance_confirmed','completed_by','completed_at')")"
test "$OFFBOARD_COLUMN_COUNT" = "6" || { echo "离职交接字段迁移不完整: $OFFBOARD_COLUMN_COUNT/6" >&2; exit 1; }

ONSITE_ROLE_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM sys_role WHERE role_code='onsite_staff' AND role_name='驻厂人员' AND status=1")"
test "$ONSITE_ROLE_COUNT" = "1" || { echo "驻厂人员角色迁移不完整" >&2; exit 1; }

ONSITE_EDIT_BROKEN="$(mysql_scalar "SELECT COUNT(*) FROM sys_role r WHERE r.role_code='onsite_staff' AND r.status=1 AND NOT EXISTS (SELECT 1 FROM sys_role_permission rp JOIN sys_permission p ON p.id=rp.permission_id AND p.status=1 WHERE rp.role_id=r.id AND p.permission_code='employee:update')")"
test "$ONSITE_EDIT_BROKEN" = "0" || { echo "驻厂人员员工编辑权限迁移不完整" >&2; exit 1; }

BROKEN_ROLE_COUNT="$(mysql_scalar "SELECT COUNT(*) FROM sys_role r WHERE r.status=1 AND r.role_code IN ('company_admin','hr_manager','onsite_staff','payroll_staff') AND ((r.role_code='company_admin' AND (SELECT COUNT(*) FROM sys_role_permission rp JOIN sys_permission p ON p.id=rp.permission_id AND p.status=1 WHERE rp.role_id=r.id AND p.permission_code IN ('office:menu','dashboard:menu','blacklist:menu','talent:menu','advance:menu','payroll:menu','riskCase:menu','audit:menu','audit:view','permission:menu'))<10) OR (r.role_code='hr_manager' AND (SELECT COUNT(*) FROM sys_role_permission rp JOIN sys_permission p ON p.id=rp.permission_id AND p.status=1 WHERE rp.role_id=r.id AND p.permission_code IN ('office:menu','dashboard:menu','blacklist:menu','talent:menu','advance:menu','payroll:menu','riskCase:menu','audit:menu','audit:view'))<9) OR (r.role_code='onsite_staff' AND (SELECT COUNT(*) FROM sys_role_permission rp JOIN sys_permission p ON p.id=rp.permission_id AND p.status=1 WHERE rp.role_id=r.id AND p.permission_code IN ('office:menu','blacklist:menu'))<2) OR (r.role_code='payroll_staff' AND (SELECT COUNT(*) FROM sys_role_permission rp JOIN sys_permission p ON p.id=rp.permission_id AND p.status=1 WHERE rp.role_id=r.id AND p.permission_code IN ('office:menu','advance:menu','payroll:menu'))<3))")"
test "$BROKEN_ROLE_COUNT" = "0" || { echo "有 $BROKEN_ROLE_COUNT 个角色权限迁移不完整" >&2; exit 1; }

# 覆盖代码前再次确认生产配置，发布包本身不包含该文件。
cp -R "$STAGE_DIR"/. "$PROJECT_DIR"/
ENV_SHA_AFTER="$(sha256sum "$ENV_FILE" | awk '{print $1}')"
test "$ENV_SHA_BEFORE" = "$ENV_SHA_AFTER" || { echo ".env.production被修改，停止部署" >&2; exit 1; }

cd "$PROJECT_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build app

HEALTH_OK=false
for attempt in $(seq 1 12); do
  HEALTH_RESPONSE="$(curl -fsS http://127.0.0.1:3120/api/health 2>/dev/null || true)"
  if echo "$HEALTH_RESPONSE" | grep -Eq '"code"[[:space:]]*:[[:space:]]*0'; then
    HEALTH_OK=true
    break
  fi
  sleep 5
done

if [ "$HEALTH_OK" != true ]; then
  echo "健康检查60秒内未通过" >&2
  docker logs --tail=50 "$APP_CONTAINER" >&2 || true
  exit 1
fi

echo "部署完成，数据库和代码备份位于: $BACKUP_DIR"
echo "请让已有用户重新登录，并人工验证四角色菜单和数据范围。"
