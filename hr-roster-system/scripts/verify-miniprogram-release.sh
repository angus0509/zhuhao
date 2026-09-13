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

HEALTH_STATUS="$(curl -sS --connect-timeout 15 --max-time 30 -o /dev/null -w '%{http_code}' "$API_BASE_URL/health")"
test "$HEALTH_STATUS" = "200" || { echo "生产 API 健康状态异常: HTTP $HEALTH_STATUS" >&2; exit 1; }

ROSTER_SOURCE="$(curl -fsS --connect-timeout 15 --max-time 30 "https://lczpt.com/js/views/roster.js")"
# 线上代码使用模板字符串动态拼接 view=activeRoster，检查功能标记而非不存在的固定查询字面量。
echo "$ROSTER_SOURCE" | grep -Eq "activeRoster" || {
  echo "生产 Web/API 尚未部署本轮版本，禁止先上传小程序" >&2
  exit 1
}

echo "小程序上传前检查通过"
echo "版本: $VERSION"
echo "AppID: $APPID"
echo "说明: $DESCRIPTION"
echo "下一步上传命令（本脚本不会执行）:"
printf '"%s" upload --project "%s" --version "%s" --desc "%s" --lang zh\n' \
  "$DEVTOOLS_CLI" "$PROJECT_DIR/wechat-miniprogram" "$VERSION" "$DESCRIPTION"
