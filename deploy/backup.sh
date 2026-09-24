#!/usr/bin/env bash
# 备份数据库 + 图片目录，保留 14 天。
# 容器内：docker compose exec app /app/deploy/backup.sh
# 本机：  DATA_DIR=./data ./deploy/backup.sh
set -euo pipefail

DATA="${DATA_DIR:-./data}"
OUT="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M)"

mkdir -p "$OUT"

if [ -f "$DATA/retouch.db" ]; then
  node "$(dirname "$0")/backup-db.mjs" "$DATA/retouch.db" "$OUT/retouch-$STAMP.db"
else
  echo "跳过数据库备份：$DATA/retouch.db 不存在"
fi

if [ -d "$DATA/images" ]; then
  tar -czf "$OUT/images-$STAMP.tgz" -C "$DATA" images
  echo "已打包图片 → $OUT/images-$STAMP.tgz"
fi

# 只留 14 天
find "$OUT" -maxdepth 1 -type f \( -name 'retouch-*.db' -o -name 'images-*.tgz' \) -mtime +14 -delete

# 可选：同步到对象存储（先配好 rclone remote，命名为 oss）
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$OUT" "$RCLONE_REMOTE" --max-age 336h --transfers 4
  echo "已同步到 $RCLONE_REMOTE"
fi

echo "备份完成 $(date '+%F %T')"
