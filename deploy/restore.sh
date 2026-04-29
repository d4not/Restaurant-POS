#!/usr/bin/env bash
# Restaurant POS — restore a database from a backup dump.
#
# Usage:
#   deploy/restore.sh <path-to-dump>
#
# Example:
#   deploy/restore.sh /var/backups/restaurant-pos/daily/restaurant_pos-20260429-030000.dump
#
# WARNING: this DROPS and recreates the target database. The backend MUST be
# stopped before running this script. The script asks for confirmation.

set -euo pipefail

DUMP_FILE="${1:-}"
DB_NAME="${DB_NAME:-restaurant_pos}"
DB_USER="${DB_USER:-postgres}"

if [ -z "$DUMP_FILE" ]; then
  echo "Usage: $0 <path-to-dump>"
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: dump file not found: $DUMP_FILE"
  exit 1
fi

echo
echo "  About to RESTORE database:"
echo "    target db:  $DB_NAME"
echo "    from dump:  $DUMP_FILE"
echo "    dump size:  $(du -h "$DUMP_FILE" | cut -f1)"
echo
echo "  This will DROP the existing $DB_NAME database. Make sure the backend is stopped:"
echo "    sudo systemctl stop pos-backend"
echo
read -r -p "Type the database name ($DB_NAME) to confirm: " CONFIRM

if [ "$CONFIRM" != "$DB_NAME" ]; then
  echo "Aborted."
  exit 1
fi

# Drop and recreate
sudo -u "$DB_USER" psql -c "DROP DATABASE IF EXISTS $DB_NAME;"
sudo -u "$DB_USER" psql -c "CREATE DATABASE $DB_NAME;"

# Restore
sudo -u "$DB_USER" pg_restore -d "$DB_NAME" --no-owner --role="$DB_USER" "$DUMP_FILE"

echo
echo "[restore] done. Start the backend:"
echo "    sudo systemctl start pos-backend"
