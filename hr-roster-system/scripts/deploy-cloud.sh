#!/bin/sh
set -eu

# 在云服务器项目目录执行；首次执行前先准备 .env.production。
if [ ! -f .env.production ]; then
  echo "缺少 .env.production，请从 .env.production.example 复制并填写强密码。" >&2
  exit 1
fi

set -a
. ./.env.production
set +a
: "${MYSQL_ROOT_PASSWORD:?生产环境缺少MYSQL_ROOT_PASSWORD}"
: "${DB_PASSWORD:?生产环境缺少DB_PASSWORD}"
: "${JWT_SECRET:?生产环境缺少JWT_SECRET}"
: "${DATA_ENCRYPT_KEY:?生产环境缺少DATA_ENCRYPT_KEY}"
: "${DATA_ENCRYPT_IV:?生产环境缺少DATA_ENCRYPT_IV}"
test "${#JWT_SECRET}" -ge 32 || { echo "JWT_SECRET长度不能少于32字符" >&2; exit 1; }
test "${#DATA_ENCRYPT_KEY}" -eq 32 || { echo "DATA_ENCRYPT_KEY必须为32字符" >&2; exit 1; }
test "${#DATA_ENCRYPT_IV}" -eq 16 || { echo "DATA_ENCRYPT_IV必须为16字符" >&2; exit 1; }

docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps

echo "云端容器已启动。请通过 Nginx HTTPS 反向代理到 127.0.0.1:3120。"
