#!/bin/bash
# 仅规范公开静态目录的读取权限，避免严格 umask 使 Nginx 无法直接提供新增资源。
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "用法: $0 <public目录>" >&2
  exit 1
fi

PUBLIC_DIR="$1"
test -d "$PUBLIC_DIR" || { echo "公开静态目录不存在: $PUBLIC_DIR" >&2; exit 1; }

find "$PUBLIC_DIR" -type d -exec chmod 755 {} +
find "$PUBLIC_DIR" -type f -exec chmod 644 {} +
