#!/usr/bin/env bash
# Restaurant POS — daily database backup
#
# Schedule via cron (see deploy/crontab.example). Keeps:
#   - daily backups for 14 days
#   - weekly backups (Sundays) for 8 weeks
#   - monthly backups (1st of month) for 12 months
#
# Backups are pg_dump custom format (-Fc), restorable with pg_restore.

set -euo pipefail

# --- Config (override via /etc/default/pos-backup if present) ---------------
DB_NAME="${DB_NAME:-restaurant_pos}"
DB_USER="${DB_USER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/restaurant-pos}"

[ -f /etc/default/pos-backup ] && . /etc/default/pos-backup

# --- Setup ------------------------------------------------------------------
DATE=$(date +%Y%m%d-%H%M%S)
DAY_OF_WEEK=$(date +%u)   # 1..7 (Monday..Sunday)
DAY_OF_MONTH=$(date +%d)

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}

# --- Dump -------------------------------------------------------------------
DAILY_FILE="$BACKUP_DIR/daily/${DB_NAME}-${DATE}.dump"
echo "[backup] dumping $DB_NAME → $DAILY_FILE"
sudo -u "$DB_USER" pg_dump -Fc -d "$DB_NAME" -f "$DAILY_FILE"

# Verify the dump is non-empty
if [ ! -s "$DAILY_FILE" ]; then
  echo "[backup] ERROR: dump file is empty" >&2
  exit 1
fi

# --- Promote to weekly / monthly --------------------------------------------
# Sunday → keep a copy in weekly/
if [ "$DAY_OF_WEEK" = "7" ]; then
  cp "$DAILY_FILE" "$BACKUP_DIR/weekly/${DB_NAME}-${DATE}.dump"
fi

# 1st of month → keep a copy in monthly/
if [ "$DAY_OF_MONTH" = "01" ]; then
  cp "$DAILY_FILE" "$BACKUP_DIR/monthly/${DB_NAME}-${DATE}.dump"
fi

# --- Retention --------------------------------------------------------------
find "$BACKUP_DIR/daily"   -name "${DB_NAME}-*.dump" -mtime +14  -delete
find "$BACKUP_DIR/weekly"  -name "${DB_NAME}-*.dump" -mtime +56  -delete
find "$BACKUP_DIR/monthly" -name "${DB_NAME}-*.dump" -mtime +400 -delete

# --- Summary ----------------------------------------------------------------
SIZE=$(du -h "$DAILY_FILE" | cut -f1)
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" | wc -l)
echo "[backup] done · size=$SIZE · total_backups=$TOTAL_BACKUPS"
