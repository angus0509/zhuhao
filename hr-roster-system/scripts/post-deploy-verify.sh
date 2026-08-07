#!/bin/bash
# 上线后只读验证脚本：检查公网入口、新版页面标记，并可选执行生产容器 smoke。
# 本脚本不会创建、修改或删除员工及项目业务数据。
set -euo pipefail

BASE_URL="${BASE_URL:-https://www.lczpt.com}"
SSH_TARGET="${SSH_TARGET:-}"
APP_CONTAINER="${APP_CONTAINER:-moluo-hr-app}"
MYSQL_CONTAINER="${MYSQL_CONTAINER:-moluo-mysql-prod}"
ONSITE_SMOKE_USER_ID="${ONSITE_SMOKE_USER_ID:-}"

case "$BASE_URL" in
  http://*|https://*) ;;
  *)
    echo "BASE_URL 必须以 http:// 或 https:// 开头" >&2
    exit 1
    ;;
esac
BASE_URL="${BASE_URL%/}"

if [ -n "$ONSITE_SMOKE_USER_ID" ] && ! [[ "$ONSITE_SMOKE_USER_ID" =~ ^[0-9]+$ ]]; then
  echo "ONSITE_SMOKE_USER_ID 必须是数字用户ID" >&2
  exit 1
fi

HOME_HTML="$(mktemp)"
cleanup() {
  rm -f "$HOME_HTML"
}
trap cleanup EXIT

echo "[1/5] 公网健康接口..."
HEALTH_RESPONSE="$(curl -fsS --connect-timeout 15 --max-time 30 "$BASE_URL/api/health")"
if ! echo "$HEALTH_RESPONSE" | grep -Eq '"code"[[:space:]]*:[[:space:]]*0'; then
  echo "健康接口返回异常" >&2
  exit 1
fi
echo "  通过"

echo "[2/5] 首页与未授权拦截..."
HOME_STATUS="$(curl -sS --connect-timeout 15 --max-time 30 -o "$HOME_HTML" -w '%{http_code}' "$BASE_URL/")"
test "$HOME_STATUS" = "200" || { echo "首页状态异常: HTTP $HOME_STATUS" >&2; exit 1; }
UNAUTHORIZED_STATUS="$(curl -sS --connect-timeout 15 --max-time 30 -o /dev/null -w '%{http_code}' "$BASE_URL/api/employees")"
test "$UNAUTHORIZED_STATUS" = "401" || { echo "未授权拦截异常: HTTP $UNAUTHORIZED_STATUS" >&2; exit 1; }
echo "  首页 HTTP 200，未授权接口 HTTP 401"

echo "[3/5] 驻厂新版页面标记..."
for marker in transferProjectSelect recruitmentSourcesView tasksView 发起离职流程; do
  if ! grep -Fq "$marker" "$HOME_HTML"; then
    echo "首页缺少新版标记: $marker" >&2
    exit 1
  fi
done
echo "  通过"

if [ -z "$SSH_TARGET" ]; then
  echo "[4/5] 容器健康检查... 跳过（未设置 SSH_TARGET）"
  echo "[5/5] 只读 smoke... 跳过（未设置 SSH_TARGET）"
else
  echo "[4/5] 生产容器健康状态..."
  APP_HEALTH="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" docker inspect --format={{.State.Health.Status}} "$APP_CONTAINER")"
  MYSQL_HEALTH="$(ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" docker inspect --format={{.State.Health.Status}} "$MYSQL_CONTAINER")"
  test "$APP_HEALTH" = "healthy" || { echo "应用容器状态异常: $APP_HEALTH" >&2; exit 1; }
  test "$MYSQL_HEALTH" = "healthy" || { echo "MySQL容器状态异常: $MYSQL_HEALTH" >&2; exit 1; }
  echo "  应用与 MySQL 均为 healthy"

  echo "[5/5] 生产只读 smoke..."
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" docker exec "$APP_CONTAINER" npm run smoke
  if [ -n "$ONSITE_SMOKE_USER_ID" ]; then
    ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" \
      docker exec -e "ONSITE_SMOKE_USER_ID=$ONSITE_SMOKE_USER_ID" "$APP_CONTAINER" npm run smoke:onsite
  else
    echo "  驻厂角色 smoke 跳过（未设置 ONSITE_SMOKE_USER_ID）"
  fi
fi

echo "上线后只读验证全部通过"
