#!/bin/bash
# 验收发布包。危险压缩包在解压前阻止。用法：sh scripts/verify-release-package.sh <包路径>
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "用法: $0 <发布包绝对路径>" >&2
  exit 1
fi

ARCHIVE="$1"

if [ ! -f "$ARCHIVE" ]; then
  echo "错误: 文件不存在 — $ARCHIVE" >&2
  exit 1
fi

echo "===== 验收发布包 ====="
echo "文件: $ARCHIVE"
echo "大小: $(ls -lh "$ARCHIVE" | awk '{print $5}')"
echo "SHA-256: $(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
echo ""

# ====================================================================
# 第 1 步：tar 内容安全审计（在解压前执行，不通过则直接退出）
# ====================================================================
echo "[1/9] tar 内容安全审计..."

TAR_DETAIL="$(tar tvzf "$ARCHIVE")"
PRE_EXTRACT_PASS=true

# macOS 扩展属性会形成 PAX 元数据并在 Linux 解压时产生大量警告。
# 使用完整流匹配且不使用 grep -q，避免 pipefail 下上游收到 SIGPIPE。
if gzip -dc "$ARCHIVE" | strings | grep -E '^[0-9]+ (LIBARCHIVE\.xattr|SCHILY\.(xattr|fflags))=' >/dev/null; then
  echo "  失败: tar 包含 macOS 扩展属性或文件标志" >&2
  PRE_EXTRACT_PASS=false
fi

# 符号链接 / 硬链接
LINK_COUNT="$(echo "$TAR_DETAIL" | awk '{print $1}' | grep -cE '^[lh]' || true)"
if [ "$LINK_COUNT" -gt 0 ]; then
  echo "  失败: tar 包含 $LINK_COUNT 个符号链接或硬链接" >&2
  echo "$TAR_DETAIL" | awk '{print $1, $NF}' | grep -E '^[lh]' >&2
  PRE_EXTRACT_PASS=false
fi

# 路径穿越: (^|/)\.\.(/|$)
PATH_TRAVERSAL="$(echo "$TAR_DETAIL" | awk '{print $NF}' | grep -E '(^|/)\.\.(/|$)' || true)"
if [ -n "$PATH_TRAVERSAL" ]; then
  echo "  失败: tar 包含路径穿越" >&2
  echo "$PATH_TRAVERSAL" >&2
  PRE_EXTRACT_PASS=false
fi

# 绝对路径
ABSOLUTE="$(echo "$TAR_DETAIL" | awk '{print $NF}' | grep '^/' || true)"
if [ -n "$ABSOLUTE" ]; then
  echo "  失败: tar 包含绝对路径" >&2
  echo "$ABSOLUTE" >&2
  PRE_EXTRACT_PASS=false
fi

if [ "$PRE_EXTRACT_PASS" != true ]; then
  echo ""
  echo "========================================"
  echo "  验收失败 — tar 内容不安全，禁止解压"
  echo "========================================"
  exit 1
fi
echo "  通过"

# ====================================================================
# 第 2 步：解压到临时目录
# ====================================================================
echo "[2/9] 解压..."
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

tar xzf "$ARCHIVE" -C "$WORKDIR"
echo "  完成"

VERIFY_PASS=true

# ====================================================================
# 第 3 步：递归检查 .env 文件
# ====================================================================
echo "[3/9] 递归检查环境文件..."
ENV_FILES="$(find "$WORKDIR" -name '.env*' -type f 2>/dev/null || true)"
if [ -n "$ENV_FILES" ]; then
  while IFS= read -r env_file; do
    base="$(basename "$env_file")"
    case "$base" in
      .env.example|.env.production.example) ;;
      *)
        echo "  失败: 敏感环境文件 — ${env_file#$WORKDIR/}" >&2
        VERIFY_PASS=false
        ;;
    esac
  done <<< "$ENV_FILES"
fi
if [ "$VERIFY_PASS" = true ]; then echo "  通过"; fi

# ====================================================================
# 第 4 步：文件清单检查
# ====================================================================
echo "[4/9] 文件清单检查..."
REQUIRED=(
  "package.json" "Dockerfile" "docker-compose.prod.yml"
  "src/app.js" "public/index.html"
  "scripts/post-deploy-verify.sh"
  "sql/schema.mysql.sql"
  "sql/migrate-employee-audit-columns-20260801.mysql.sql"
  "sql/migrate-menu-permissions-20260801.mysql.sql"
  "sql/migrate-employee-customer-assignment-20260802.mysql.sql"
  "sql/migrate-system-notices-20260804.mysql.sql"
  "sql/migrate-risk-scan-log-20260804.mysql.sql"
  "sql/migrate-attachments-20260804.mysql.sql"
  "sql/migrate-onsite-lifecycle-v1-20260805.mysql.sql"
  "sql/migrate-onsite-employee-edit-permission-20260806.mysql.sql"
  "sql/migrate-recruitment-channel-20260806.mysql.sql"
  "sql/migrate-payslip-receipt-audit-20260806.mysql.sql"
  "sql/migrate-token-version-20260806.mysql.sql"
)
for f in "${REQUIRED[@]}"; do
  if [ ! -f "$WORKDIR/$f" ]; then
    echo "  失败: 缺少 — $f" >&2
    VERIFY_PASS=false
  fi
done
FORBIDDEN=(".env" ".env.production" ".env.local" "node_modules" ".runtime" "data" "uploads")
for f in "${FORBIDDEN[@]}"; do
  if [ -e "$WORKDIR/$f" ]; then
    echo "  失败: 禁止项 — $f" >&2
    VERIFY_PASS=false
  fi
done
if find "$WORKDIR" \( -name '*.pem' -o -name '*.key' -o -name 'id_rsa' -o -name 'id_ed25519' -o -name '*.p12' -o -name '*.pfx' \) -type f 2>/dev/null | grep -q .; then
  echo "  失败: 私钥" >&2
  VERIFY_PASS=false
fi
if [ "$VERIFY_PASS" = true ]; then echo "  通过"; fi

# 文件安全检查失败时，禁止安装依赖或执行包内脚本。
if [ "$VERIFY_PASS" != true ]; then
  echo "  文件安全检查失败，禁止执行包内代码" >&2
  exit 1
fi

# ====================================================================
# 第 5 步：npm ci + check
# ====================================================================
echo "[5/9] npm ci + 项目检查..."
cd "$WORKDIR"
npm ci --omit=dev --ignore-scripts --silent 2>&1 | tail -1
# Web/API 发布包按设计不包含微信小程序源码；小程序契约在源码仓库完整检查中执行。
npm run check:web
echo "  通过"

# ====================================================================
# 第 6 步：npm audit（从 JSON 读取实际计数，high/critical > 0 阻止发布）
# ====================================================================
echo "[6/9] npm audit..."
cd "$WORKDIR"
AUDIT_JSON="$(npm audit --json 2>&1 || true)"

AUDIT_RESULT="$(echo "$AUDIT_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if 'metadata' not in data:
        print('UNAVAILABLE|' + str(data.get('message', 'npm audit未返回漏洞统计')))
        raise SystemExit
    v = data.get('metadata',{}).get('vulnerabilities',{})
    print('OK|' + str(v.get('high',0) + v.get('critical',0)))
except Exception as error:
    print('UNAVAILABLE|' + str(error))
" 2>/dev/null || echo -1)"
AUDIT_STATE="${AUDIT_RESULT%%|*}"
AUDIT_DETAIL="${AUDIT_RESULT#*|}"
HIGH_CRIT="$AUDIT_DETAIL"

LOW_COUNT="$(echo "$AUDIT_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    v = data.get('metadata',{}).get('vulnerabilities',{})
    print(v.get('low',0))
except:
    print(0)
" 2>/dev/null || echo 0)"

MODERATE_COUNT="$(echo "$AUDIT_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    v = data.get('metadata',{}).get('vulnerabilities',{})
    print(v.get('moderate',0))
except:
    print(0)
" 2>/dev/null || echo 0)"

if [ "$AUDIT_STATE" != "OK" ]; then
  echo "  失败: npm audit 无法完成（通常为网络或仓库服务异常）：$AUDIT_DETAIL" >&2
  VERIFY_PASS=false
elif [ "$HIGH_CRIT" != "0" ]; then
  echo "  失败: npm audit 发现 ${HIGH_CRIT} 个 high/critical 漏洞，阻止发布" >&2
  VERIFY_PASS=false
fi

if [ "$VERIFY_PASS" = true ]; then
  echo "  npm audit: low=${LOW_COUNT} moderate=${MODERATE_COUNT} high/critical=0"
fi

# ====================================================================
# 第 7 步：迁移文件逐项检查
# ====================================================================
echo "[7/9] 迁移文件安全检查..."

M1="sql/migrate-employee-audit-columns-20260801.mysql.sql"
M2="sql/migrate-menu-permissions-20260801.mysql.sql"
M3="sql/migrate-employee-customer-assignment-20260802.mysql.sql"
M4="sql/migrate-system-notices-20260804.mysql.sql"
M5="sql/migrate-risk-scan-log-20260804.mysql.sql"
M6="sql/migrate-attachments-20260804.mysql.sql"
M7="sql/migrate-onsite-lifecycle-v1-20260805.mysql.sql"
M8="sql/migrate-recruitment-channel-20260806.mysql.sql"
M9="sql/migrate-payslip-receipt-audit-20260806.mysql.sql"
M10="sql/migrate-token-version-20260806.mysql.sql"

for mp in "$M1" "$M2" "$M3" "$M4" "$M5" "$M6" "$M7" "$M8" "$M9" "$M10"; do
  if [ ! -f "$WORKDIR/$mp" ]; then continue; fi
  content="$(cat "$WORKDIR/$mp")"

  # 任何形式的 DROP 关键字直接失败
  if echo "$content" | grep -qiw 'DROP'; then
    echo "  失败: $(basename "$mp") 包含 DROP 关键字" >&2
    VERIFY_PASS=false
  fi

  # DELETE FROM / TRUNCATE 直接失败
  if echo "$content" | grep -qiE '\bDELETE\b.*\bFROM\b|\bTRUNCATE\b'; then
    echo "  失败: $(basename "$mp") 包含 DELETE/TRUNCATE" >&2
    VERIFY_PASS=false
  fi
done

# M7：驻厂生命周期迁移必须包含核心表、离职交接字段和角色迁移。
C7="$(cat "$WORKDIR/$M7")"
for required in \
  'CREATE TABLE IF NOT EXISTS hr_employee_change' \
  'CREATE TABLE IF NOT EXISTS hr_recruiter' \
  'CREATE TABLE IF NOT EXISTS hr_recruitment_supplier' \
  'CREATE TABLE IF NOT EXISTS hr_work_task' \
  'badge_returned' 'tools_returned' 'dorm_cleared' 'attendance_confirmed' \
  "UPDATE sys_role SET role_name='驻厂人员'"; do
  if ! echo "$C7" | grep -q "$required"; then
    echo "  失败: $M7 缺少核心迁移项 — $required" >&2
    VERIFY_PASS=false
  fi
done

# M1: ALTER TABLE 前必须检查 information_schema
C1="$(cat "$WORKDIR/$M1")"
if echo "$C1" | grep -q 'ALTER TABLE'; then
  if ! echo "$C1" | grep -q 'information_schema.COLUMNS'; then
    echo "  失败: $M1 ALTER TABLE 前未检查 information_schema" >&2
    VERIFY_PASS=false
  fi
fi

# M2: 必须使用 ON DUPLICATE KEY UPDATE 和 INSERT IGNORE
C2="$(cat "$WORKDIR/$M2")"
if ! echo "$C2" | grep -q 'ON DUPLICATE KEY UPDATE'; then
  echo "  失败: $M2 缺少 ON DUPLICATE KEY UPDATE" >&2
  VERIFY_PASS=false
fi
if ! echo "$C2" | grep -q 'INSERT IGNORE'; then
  echo "  失败: $M2 缺少 INSERT IGNORE" >&2
  VERIFY_PASS=false
fi

# M3: 逐项精确检查
C3="$(cat "$WORKDIR/$M3")"
# ALTER 前查 information_schema
if echo "$C3" | grep -q 'ALTER TABLE'; then
  if ! echo "$C3" | grep -q 'information_schema.COLUMNS'; then
    echo "  失败: $M3 ALTER TABLE 前未检查 information_schema" >&2
    VERIFY_PASS=false
  fi
fi
# 插入客户必须有 NOT EXISTS
if echo "$C3" | grep -q 'INSERT INTO crm_customer'; then
  if ! echo "$C3" | grep -q 'NOT EXISTS'; then
    echo "  失败: $M3 crm_customer INSERT 缺少 NOT EXISTS" >&2
    VERIFY_PASS=false
  fi
fi
# 插入岗位必须有 NOT EXISTS
if echo "$C3" | grep -q 'INSERT INTO hr_position'; then
  if ! echo "$C3" | grep -q 'NOT EXISTS'; then
    echo "  失败: $M3 hr_position INSERT 缺少 NOT EXISTS" >&2
    VERIFY_PASS=false
  fi
fi
# UPDATE hr_employee_job 必须限制在 IS NULL（跨行合并检查）
if echo "$C3" | grep -q 'UPDATE.*hr_employee_job'; then
  if ! echo "$C3" | tr '\n' ' ' | grep -q 'WHERE.*customer_id IS NULL'; then
    echo "  失败: $M3 hr_employee_job UPDATE 未限制在 customer_id IS NULL" >&2
    VERIFY_PASS=false
  fi
fi
# 必须按未分配员工所在公司创建兜底客户并防止重复。
if ! echo "$C3" | tr '\n' ' ' | grep -q 'FROM hr_employee_job.*WHERE customer_id IS NULL'; then
  echo "  失败: $M3 未按未分配员工所在公司处理" >&2
  VERIFY_PASS=false
fi
if ! echo "$C3" | grep -q 'WHERE NOT EXISTS'; then
  echo "  失败: $M3 创建兜底客户缺少 NOT EXISTS" >&2
  VERIFY_PASS=false
fi
# 必须包含真实的迁移后验证查询，而不只是说明文字。
if ! echo "$C3" | tr '\n' ' ' | grep -q 'SELECT company_id, COUNT(\*) AS unassigned_count.*WHERE customer_id IS NULL.*GROUP BY company_id'; then
  echo "  失败: $M3 缺少未分配员工验证查询" >&2
  VERIFY_PASS=false
fi

if [ "$VERIFY_PASS" = true ]; then
  echo "  迁移文件安全检查通过"
fi

# ====================================================================
# 第 8 步：示例文件确认
# ====================================================================
echo "[8/9] 示例文件..."
test -f "$WORKDIR/.env.example" || { echo "  失败: 缺少 .env.example" >&2; VERIFY_PASS=false; }
test -f "$WORKDIR/.env.production.example" || { echo "  失败: 缺少 .env.production.example" >&2; VERIFY_PASS=false; }
if [ "$VERIFY_PASS" = true ]; then echo "  通过"; fi

# ====================================================================
# 第 9 步：最终判定
# ====================================================================
echo "[9/9] 最终判定..."
if [ "$VERIFY_PASS" != true ]; then
  echo ""
  echo "========================================"
  echo "  验收失败"
  echo "========================================"
  exit 1
fi

echo ""
echo "========================================"
echo "  验收通过"
echo "========================================"
echo "  包路径: $ARCHIVE"
echo "  SHA-256: $(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
echo "========================================"
