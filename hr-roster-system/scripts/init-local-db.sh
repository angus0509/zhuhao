#!/bin/sh
set -eu

# 本脚本用于重新初始化空数据库；会删除现有 hr_roster 数据库，禁止在已有业务数据的生产库执行。
DOCKER_BIN=${DOCKER_BIN:-docker}
MYSQL_CONTAINER=${MYSQL_CONTAINER:-moluo-mysql}
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:?请设置 MYSQL_ROOT_PASSWORD}

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$DOCKER_BIN" exec "$MYSQL_CONTAINER" mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "DROP DATABASE IF EXISTS hr_roster;"
"$DOCKER_BIN" exec -i "$MYSQL_CONTAINER" mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" \
  < "$PROJECT_DIR/sql/schema.mysql.sql"
"$DOCKER_BIN" exec -i "$MYSQL_CONTAINER" mysql --default-character-set=utf8mb4 -uroot -p"$MYSQL_ROOT_PASSWORD" \
  < "$PROJECT_DIR/sql/seed.mysql.sql"

echo "数据库初始化完成，字符集为 utf8mb4。"
