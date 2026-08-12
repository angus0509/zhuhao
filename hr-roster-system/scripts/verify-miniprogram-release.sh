#!/bin/bash
# 小程序上传前只读检查；不执行 upload。
set -euo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
RELEASE_FILE="$PROJECT_DIR/wechat-miniprogram/release.json"
DEVTOOLS_CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"

test -f "$RELEASE_FILE" || { echo "缺少小程序 release.json" >&2; exit 1; }
test -x "$DEVTOOLS_CLI" || { echo "未找到微信开发者工具 CLI" >&2; exit 1; }

VERSION="$(node -p "require('$RELEASE_FILE').version")"
DESCRIPTION="$(node -p "require('$RELEASE_FILE').description")"
APPID="$(node -p "require('$RELEASE_FILE').appid")"
API_BASE_URL="$(node -p "require('$RELEASE_FILE').apiBaseUrl")"

node "$PROJECT_DIR/test/miniprogram-release-candidate.test.js"

HEALTH_RESPONSE="$(curl -fsS --connect-timeout 15 --max-time 30 "$API_BASE_URL/health")"
echo "$HEALTH_RESPONSE" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"connected"' || {
  echo "生产 API 数据库未连接" >&2
  exit 1
}

ROSTER_SOURCE="$(curl -fsS --connect-timeout 15 --max-time 30 "https://lczpt.com/js/views/roster.js")"
echo "$ROSTER_SOURCE" | grep -Fq 'view=activeRoster' || {
  echo "生产 Web/API 尚未部署本轮版本，禁止先上传小程序" >&2
  exit 1
}

echo "小程序上传前检查通过"
echo "版本: $VERSION"
echo "AppID: $APPID"
echo "说明: $DESCRIPTION"
echo "下一步上传命令（本脚本不会执行）:"
printf '%q ' "$DEVTOOLS_CLI" upload --project "$PROJECT_DIR/wechat-miniprogram" --version "$VERSION" --desc "$DESCRIPTION" --lang zh
echo
