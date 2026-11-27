#!/bin/bash
# 部署成功后轮换附件全量备份，仅保留本次已验证备份。
set -euo pipefail
umask 077

if [ "$#" -ne 2 ]; then
  echo "用法: $0 <备份目录绝对路径> <本次附件备份绝对路径>" >&2
  exit 1
fi

BACKUP_DIR="$1"
KEEP_BACKUP="$2"

case "$BACKUP_DIR" in /*) ;; *) echo "备份目录必须是绝对路径" >&2; exit 1 ;; esac
case "$KEEP_BACKUP" in /*) ;; *) echo "保留文件必须是绝对路径" >&2; exit 1 ;; esac

test -d "$BACKUP_DIR" || { echo "备份目录不存在: $BACKUP_DIR" >&2; exit 1; }
BACKUP_DIR_REAL="$(CDPATH= cd -- "$BACKUP_DIR" && pwd -P)"
KEEP_DIR_REAL="$(CDPATH= cd -- "$(dirname -- "$KEEP_BACKUP")" && pwd -P)"
KEEP_NAME="$(basename -- "$KEEP_BACKUP")"

test "$KEEP_DIR_REAL" = "$BACKUP_DIR_REAL" || {
  echo "保留文件必须位于备份目录直属层级" >&2
  exit 1
}
case "$KEEP_NAME" in attachments-*.tar.gz) ;; *)
  echo "保留文件名不符合附件备份规则" >&2
  exit 1
;; esac

KEEP_REAL="$BACKUP_DIR_REAL/$KEEP_NAME"
test ! -L "$KEEP_REAL" || { echo "保留文件不能是符号链接" >&2; exit 1; }
test -f "$KEEP_REAL" || { echo "保留文件不存在: $KEEP_REAL" >&2; exit 1; }
test -s "$KEEP_REAL" || { echo "保留文件为空: $KEEP_REAL" >&2; exit 1; }
tar tzf "$KEEP_REAL" >/dev/null

DELETED=0
while IFS= read -r -d '' candidate; do
  [ "$candidate" = "$KEEP_REAL" ] && continue
  rm -- "$candidate"
  DELETED=$((DELETED + 1))
done < <(find "$BACKUP_DIR_REAL" -maxdepth 1 -type f -name 'attachments-*.tar.gz' -print0)

echo "附件备份轮换完成：保留 ${KEEP_NAME}，删除旧备份 ${DELETED} 份"
