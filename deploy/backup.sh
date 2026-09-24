#!/usr/bin/env bash
# 备份数据库 + 图片目录，保留 14 天。
# 容器内：docker compose exec app /app/deploy/backup.sh
# 本机：  DATA_DIR=./data ./deploy/backup.sh
#
# 默认落在 $DATA_DIR/backups —— 必须是在卷里面，否则容器一重建备份就没了。
set -euo pipefail

DATA="${DATA_DIR:-./data}"
OUT="${BACKUP_DIR:-$DATA/backups}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# 秒级时间戳：以前用分钟，同一分钟跑两次会让 VACUUM INTO 因目标已存在而失败
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$OUT"

if [ -f "$DATA/retouch.db" ]; then
  node "$HERE/backup-db.mjs" "$DATA/retouch.db" "$OUT/retouch-$STAMP.db"
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
  if ! command -v rclone >/dev/null 2>&1; then
    echo "设了 RCLONE_REMOTE 但镜像里没有 rclone，跳过同步" >&2
  else
    rclone copy "$OUT" "$RCLONE_REMOTE" --max-age 336h --transfers 4
    echo "已同步到 $RCLONE_REMOTE"
  fi
fi

LATEST="$(ls -1 "$OUT"/retouch-*.db 2>/dev/null | tail -1 || true)"
if [ -n "$LATEST" ]; then
  ln -sfn "$LATEST" "$OUT/latest.db"
  echo "最新快照软链：$OUT/latest.db"
fi

echo "备份完成 $(date '+%F %T') → $OUT"
