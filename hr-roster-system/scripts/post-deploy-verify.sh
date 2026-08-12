#!/bin/bash
# 上线后只读验证脚本：检查公网入口、新版页面标记，并可选执行生产容器 smoke。
# 本脚本不会创建、修改或删除员工及项目业务数据。
set -euo pipefail

BASE_URL="${BASE_URL:-https://lczpt.com}"
SECONDARY_BASE_URL="${SECONDARY_BASE_URL:-https://www.lczpt.com}"
SSH_TARGET="${SSH_TARGET:-}"
APP_CONTAINER="${APP_CONTAINER:-moluo-hr-app}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-moluo-mysql-prod}"
ONSITE_SMOKE_USER_ID="${ONSITE_SMOKE_USER_ID:-}"

for candidate in "$BASE_URL" "$SECONDARY_BASE_URL"; do
  case "$candidate" in
    http://*|https://*) ;;
    *) echo "域名地址必须以 http:// 或 https:// 开头" >&2; exit 1 ;;
  esac
done
BASE_URL="${BASE_URL%/}"
SECONDARY_BASE_URL="${SECONDARY_BASE_URL%/}"

if [ -n "$ONSITE_SMOKE_USER_ID" ] && ! [[ "$ONSITE_SMOKE_USER_ID" =~ ^[0-9]+$ ]]; then
  echo "ONSITE_SMOKE_USER_ID 必须是数字用户ID" >&2
  exit 1
fi

HOME_HTML="$(mktemp)"
ROSTER_JS="$(mktemp)"
cleanup() {
  rm -f "$HOME_HTML" "$ROSTER_JS"
}
trap cleanup EXIT

echo "[1/6] 公网健康接口..."
HEALTH_RESPONSE="$(curl -fsS --connect-timeout 15 --max-time 30 "$BASE_URL/api/health")"
if ! echo "$HEALTH_RESPONSE" | grep -Eq '"code"[[:space:]]*:[[:space:]]*0'; then
  echo "健康接口返回异常" >&2
  exit 1
fi
if ! echo "$HEALTH_RESPONSE" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"connected"'; then
  echo "健康接口未确认 database connected" >&2
  exit 1
fi
echo "  通过"

echo "[2/6] 双域名、首页与未授权拦截..."
HOME_STATUS="$(curl -sS --connect-timeout 15 --max-time 30 -o "$HOME_HTML" -w '%{http_code}' "$BASE_URL/")"
test "$HOME_STATUS" = "200" || { echo "首页状态异常: HTTP $HOME_STATUS" >&2; exit 1; }
SECONDARY_STATUS="$(curl -sS --connect-timeout 15 --max-time 30 -o /dev/null -w '%{http_code}' "$SECONDARY_BASE_URL/")"
case "$SECONDARY_STATUS" in 200|301|302|307|308) ;; *) echo "备用域名状态异常: HTTP $SECONDARY_STATUS" >&2; exit 1 ;; esac
UNAUTHORIZED_STATUS="$(curl -sS --connect-timeout 15 --max-time 30 -o /dev/null -w '%{http_code}' "$BASE_URL/api/employees")"
test "$UNAUTHORIZED_STATUS" = "401" || { echo "未授权拦截异常: HTTP $UNAUTHORIZED_STATUS" >&2; exit 1; }
echo "  主域名 HTTP 200，备用域名 HTTP ${SECONDARY_STATUS}，未授权接口 HTTP 401"

echo "[3/6] 当前品牌与构建资源..."
for marker in 优益数字化管理系统 /layout-refine.css /js/views/roster.js /interaction-polish.js; do
  if ! grep -Fq "$marker" "$HOME_HTML"; then
    echo "首页缺少当前构建标记: $marker" >&2
    exit 1
  fi
done
echo "  通过"

echo "[4/6] 网页在职花名册资源..."
ROSTER_STATUS="$(curl -sS --connect-timeout 15 --max-time 30 -o "$ROSTER_JS" -w '%{http_code}' "$BASE_URL/js/views/roster.js")"
test "$ROSTER_STATUS" = "200" || { echo "花名册资源状态异常: HTTP $ROSTER_STATUS" >&2; exit 1; }
grep -Fq 'view=activeRoster' "$ROSTER_JS" || { echo "线上花名册尚未启用 activeRoster" >&2; exit 1; }
echo "  通过"

if [ -z "$SSH_TARGET" ]; then
  echo "[5/6] 容器健康检查... 跳过（未设置 SSH_TARGET）"
  echo "[6/6] 只读 smoke... 跳过（未设置 SSH_TARGET）"
else
  echo "[5/6] 生产容器健康状态..."
  APP_HEALTH="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" docker inspect --format={{.State.Health.Status}} "$APP_CONTAINER")"
  MYSQL_HEALTH="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" docker inspect --format={{.State.Health.Status}} "$MYSQL_CONTAINER")"
  test "$APP_HEALTH" = "healthy" || { echo "应用容器状态异常: $APP_HEALTH" >&2; exit 1; }
  test "$MYSQL_HEALTH" = "healthy" || { echo "MySQL容器状态异常: $MYSQL_HEALTH" >&2; exit 1; }
  echo "  应用与 MySQL 均为 healthy"

  echo "[6/6] 生产只读 smoke..."
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" docker exec "$APP_CONTAINER" npm run smoke
  if [ -n "$ONSITE_SMOKE_USER_ID" ]; then
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" \
      docker exec -e "ONSITE_SMOKE_USER_ID=$ONSITE_SMOKE_USER_ID" "$APP_CONTAINER" npm run smoke:onsite
  else
    echo "  驻厂角色 smoke 跳过（未设置 ONSITE_SMOKE_USER_ID）"
  fi
fi

echo "上线后只读验证全部通过"
