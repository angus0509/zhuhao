#!/bin/sh
set -eu

PROJECT_DIR=${PROJECT_DIR:-/opt/moluo-hr}
BACKUP_DIR=${BACKUP_DIR:-/opt/moluo-backups}
MYSQL_CONTAINER=${MYSQL_CONTAINER:-moluo-mysql-prod}

if [ ! -f "$PROJECT_DIR/.env.production" ]; then
  echo "缺少生产环境配置：$PROJECT_DIR/.env.production" >&2
  exit 1
fi

# 读取数据库密码，不将密码暴露在 mysqldump 命令参数中。
set -a
. "$PROJECT_DIR/.env.production"
set +a

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
TEMP_FILE="$BACKUP_DIR/hr_roster-$TIMESTAMP.sql.gz.tmp"
BACKUP_FILE="$BACKUP_DIR/hr_roster-$TIMESTAMP.sql.gz"
ATTACHMENT_TEMP="$BACKUP_DIR/attachments-$TIMESTAMP.tar.gz.tmp"
ATTACHMENT_BACKUP="$BACKUP_DIR/attachments-$TIMESTAMP.tar.gz"

docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$MYSQL_CONTAINER" \
  mysqldump -uroot --single-transaction --routines --triggers --default-character-set=utf8mb4 hr_roster \
  | gzip -9 > "$TEMP_FILE"

mv "$TEMP_FILE" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

# 自动清理14天前的备份，只处理本系统固定命名的压缩文件。
find "$BACKUP_DIR" -type f -name 'hr_roster-*.sql.gz' -mtime +14 -delete

gzip -t "$BACKUP_FILE"

# 合规附件与数据库使用同一时间戳备份，恢复时可按批次配对。
mkdir -p "$PROJECT_DIR/uploads"
tar czf "$ATTACHMENT_TEMP" -C "$PROJECT_DIR" uploads
mv "$ATTACHMENT_TEMP" "$ATTACHMENT_BACKUP"
chmod 600 "$ATTACHMENT_BACKUP"
tar tzf "$ATTACHMENT_BACKUP" >/dev/null

find "$BACKUP_DIR" -type f -name 'attachments-*.tar.gz' -mtime +14 -delete

echo "$BACKUP_FILE"
echo "$ATTACHMENT_BACKUP"
