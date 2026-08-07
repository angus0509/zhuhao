#!/bin/bash
# 生成唯一发布包。安全检查失败时仅删除本次生成的包文件。
set -euo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$PROJECT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
PACKAGE_NAME="hr-roster-deploy-${TIMESTAMP}.tar.gz"
PACKAGE_FILE="/tmp/${PACKAGE_NAME}"
PACKAGE_VALID=false

# EXIT trap：退出时若未标记有效，删除本次生成的包
cleanup_package() {
  if [ "$PACKAGE_VALID" != true ] && [ -f "$PACKAGE_FILE" ]; then
    rm -f "$PACKAGE_FILE"
    echo "" >&2
    echo "本次发布包已删除（安全检查未通过）：$PACKAGE_FILE" >&2
  fi
}
trap cleanup_package EXIT

# 打包。显式关闭 macOS 扩展属性、ACL、文件标志和 AppleDouble 元数据，
# 避免 Linux 服务器解压时出现 LIBARCHIVE.xattr / SCHILY.fflags 警告。
COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --no-acls \
  --no-fflags \
  --no-mac-metadata \
  -czf "$PACKAGE_FILE" \
  --exclude='node_modules' \
  --exclude='.runtime' \
  --exclude='data' \
  --exclude='uploads' \
  --exclude='.DS_Store' \
  --exclude='design-qa.md' \
  --exclude='wechat-miniprogram' \
  --exclude='*.log' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='*.p12' \
  --exclude='*.pfx' \
  --exclude='id_rsa' \
  --exclude='id_ed25519' \
  --exclude='*.sql.gz' \
  --exclude='.env' \
  --exclude='.env.production' \
  --exclude='.env.local' \
  --exclude='.env.development' \
  --exclude='.env.test' \
  --exclude='.env.*.local' \
  --exclude='.env.staging' \
  .

# ---- 安全检查 1：无符号链接/硬链接 ----
TAR_DETAIL="$(tar tvzf "$PACKAGE_FILE")"
if echo "$TAR_DETAIL" | awk '{print $1}' | grep -qE '^[lh]'; then
  echo "错误: 发布包包含符号链接或硬链接" >&2
  echo "$TAR_DETAIL" | awk '{print $1, $NF}' | grep -E '^[lh]' >&2
  exit 1
fi

# ---- 安全检查 2：路径审计 ----
# 路径穿越: (^|/)\.\.(/|$)
if echo "$TAR_DETAIL" | awk '{print $NF}' | grep -qE '(^|/)\.\.(/|$)'; then
  echo "错误: 发布包包含路径穿越" >&2
  echo "$TAR_DETAIL" | awk '{print $NF}' | grep -E '(^|/)\.\.(/|$)' >&2
  exit 1
fi
# 绝对路径
if echo "$TAR_DETAIL" | awk '{print $NF}' | grep -q '^/'; then
  echo "错误: 发布包包含绝对路径" >&2
  exit 1
fi

# ---- 安全检查 3：无敏感 env 文件 ----
TAR_LIST="$(tar tzf "$PACKAGE_FILE")"
SENSITIVE_ENV="$(echo "$TAR_LIST" | grep '\.env' || true)"
if [ -n "$SENSITIVE_ENV" ]; then
  while IFS= read -r line; do
    base="$(basename "$line")"
    case "$base" in
      .env.example|.env.production.example) ;;
      *)
        echo "错误: 包内包含敏感环境文件 — $line" >&2
        exit 1
        ;;
    esac
  done <<< "$SENSITIVE_ENV"
fi

# ---- 安全检查 4：禁止项不存在 ----
for forbidden in '.env' '.env.production' '.env.local' 'node_modules' '.runtime' 'data' 'uploads'; do
  if echo "$TAR_LIST" | grep -q "^${forbidden}\(/.*\)*$"; then
    echo "错误: 包内不应包含 — $forbidden" >&2
    exit 1
  fi
done

# ---- 安全检查 5：无私钥 ----
if echo "$TAR_LIST" | grep -qE '\.(pem|key|p12|pfx)$|id_rsa|id_ed25519'; then
  echo "错误: 包内包含私钥文件" >&2
  exit 1
fi

# ---- 全部通过 ----
PACKAGE_VALID=true
trap - EXIT

SHA256VAL="$(shasum -a 256 "$PACKAGE_FILE" | awk '{print $1}')"

echo "============================================"
echo "  发布包生成完成"
echo "============================================"
echo "  路径:    $PACKAGE_FILE"
echo "  大小:    $(ls -lh "$PACKAGE_FILE" | awk '{print $5}')"
echo "  SHA-256: $SHA256VAL"
echo "============================================"
echo ""
echo "上传到服务器并校验："
echo "  scp $PACKAGE_FILE root@<生产IP>:/tmp/"
echo ""
echo "服务器端 SHA-256 校验："
echo "  EXPECTED_SHA256=\"$SHA256VAL\""
echo "  ACTUAL_SHA256=\"\$(sha256sum /tmp/${PACKAGE_NAME} | awk '{print \$1}')\""
echo "  test \"\$EXPECTED_SHA256\" = \"\$ACTUAL_SHA256\" || exit 1"
