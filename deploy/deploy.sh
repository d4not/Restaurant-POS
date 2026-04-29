#!/usr/bin/env bash
# Restaurant POS — production deploy.
#
# Steps:
#   1. Snapshot the database (so a botched migration is recoverable)
#   2. Pull latest code from git
#   3. Install dependencies
#   4. Apply pending Prisma migrations (deploy mode — never resets the DB)
#   5. Build the backend
#   6. Restart the service
#
# Run as the `pos` user (or anyone with sudo). Designed to be safe to re-run.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/restaurant-pos}"
SERVICE="${SERVICE:-pos-backend}"
BRANCH="${BRANCH:-master}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-/var/backups/restaurant-pos/pre-deploy}"

echo "[deploy] app=$APP_DIR branch=$BRANCH service=$SERVICE"
cd "$APP_DIR"

# --- 1. Pre-deploy snapshot -------------------------------------------------
echo "[deploy] snapshotting database…"
mkdir -p "$SNAPSHOT_DIR"
SNAPSHOT="$SNAPSHOT_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
DB_NAME="${DB_NAME:-restaurant_pos}"
DB_USER="${DB_USER:-postgres}"
sudo -u "$DB_USER" pg_dump -Fc -d "$DB_NAME" -f "$SNAPSHOT"
echo "[deploy] snapshot: $SNAPSHOT ($(du -h "$SNAPSHOT" | cut -f1))"

# --- 2. Pull -----------------------------------------------------------------
echo "[deploy] pulling latest from origin/$BRANCH…"
git fetch origin
git checkout "$BRANCH"
LOCAL=$(git rev-parse HEAD)
git pull --ff-only origin "$BRANCH"
REMOTE=$(git rev-parse HEAD)
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[deploy] no new commits; nothing to do."
  exit 0
fi
echo "[deploy] $LOCAL → $REMOTE"

# --- 3. Install --------------------------------------------------------------
echo "[deploy] installing dependencies…"
npm ci --omit=dev
# devDependencies needed for prisma generate + tsc — install them just for build
npm ci

# --- 4. Migrate --------------------------------------------------------------
echo "[deploy] applying migrations…"
npx prisma migrate deploy
npx prisma generate

# --- 5. Build ---------------------------------------------------------------
echo "[deploy] building…"
npm run build

# Re-prune dev deps to keep node_modules small in prod
npm prune --omit=dev

# --- 6. Restart -------------------------------------------------------------
echo "[deploy] restarting $SERVICE…"
sudo systemctl restart "$SERVICE"
sleep 2
sudo systemctl is-active --quiet "$SERVICE" && echo "[deploy] $SERVICE active" || {
  echo "[deploy] ERROR: $SERVICE failed to start; rolling back is up to you."
  echo "        snapshot to restore from: $SNAPSHOT"
  exit 1
}

# --- Smoke test -------------------------------------------------------------
PORT="${PORT:-3000}"
if curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "[deploy] health check OK"
else
  echo "[deploy] WARNING: /health did not respond; check logs:"
  echo "        journalctl -u $SERVICE -n 50"
fi

echo "[deploy] done."
