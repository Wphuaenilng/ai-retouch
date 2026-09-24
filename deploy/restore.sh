#!/usr/bin/env bash
# 从快照恢复数据库（可选同时恢复图片目录）。
#
# 容器内：
#   docker compose stop app
#   docker compose exec app /app/deploy/restore.sh /data/backups/latest.db --force
#   docker compose up -d app
# 本机：
#   DATA_DIR=./data ./deploy/restore.sh ./backups/retouch-20260924-101500.db --force
#   DATA_DIR=./data ./deploy/restore.sh <快照.db> --images <images-*.tgz> --force
set -euo pipefail

DATA="${DATA_DIR:-./data}"
HERE="$(cd "$(dirname "$0")" && pwd)"

FORCE=""
IMAGES=""
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE="--force" ;;
    --images) IMAGES="${2:-}"; shift ;;
    -h|--help) sed -n '1,14p' "$0"; exit 0 ;;
    *) POS+=("$1") ;;
  esac
  shift
done

SNAP="${POS[0]:-}"
TARGET="${POS[1]:-$DATA/retouch.db}"

if [ -z "$SNAP" ]; then
  echo "用法: deploy/restore.sh <快照.db> [目标库] [--force] [--images <images-*.tgz>]" >&2
  exit 2
fi

echo "⚠️  恢复会覆盖 $TARGET —— 请先确认服务已停止（跑着的进程会把旧 WAL 写回来）。"
node "$HERE/restore.mjs" "$SNAP" "$TARGET" $FORCE

if [ -n "$IMAGES" ]; then
  if [ ! -f "$IMAGES" ]; then
    echo "图片包不存在：$IMAGES" >&2
    exit 1
  fi
  mkdir -p "$DATA"
  tar -xzf "$IMAGES" -C "$DATA"
  echo "已恢复图片目录 → $DATA/images"
fi

echo "恢复完成。启动后用 curl \$BASE/api/health 与登录一次做确认。"
