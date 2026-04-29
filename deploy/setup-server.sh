#!/usr/bin/env bash
# Restaurant POS — first-time server setup.
#
# Run ONCE on a fresh server (Debian/Ubuntu) as root. This script is idempotent —
# safe to re-run if you need to fix a step.
#
# Steps:
#   1. Install Node 20, PostgreSQL 16, build tools
#   2. Create the `pos` system user
#   3. Create the database and a non-superuser role
#   4. Lay out /opt/restaurant-pos and /var/log/restaurant-pos
#   5. Install the systemd unit
#
# After this script: clone the repo into /opt/restaurant-pos, copy
# deploy/.env.production.example to /opt/restaurant-pos/.env, fill it in, and
# run deploy/deploy.sh.

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Run as root: sudo $0"
  exit 1
fi

APP_USER="pos"
APP_DIR="/opt/restaurant-pos"
LOG_DIR="/var/log/restaurant-pos"
DB_NAME="restaurant_pos"
DB_USER="pos_app"

# --- 1. Packages ------------------------------------------------------------
echo "[setup] installing packages…"
apt-get update
apt-get install -y curl git build-essential ca-certificates gnupg lsb-release

# Node.js 20 LTS (NodeSource)
if ! command -v node >/dev/null || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# PostgreSQL 16
if ! command -v psql >/dev/null; then
  apt-get install -y postgresql-16 postgresql-client-16
fi

systemctl enable --now postgresql

# --- 2. App user ------------------------------------------------------------
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  echo "[setup] creating user $APP_USER…"
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

# --- 3. Database ------------------------------------------------------------
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)

# Create role + db (idempotent)
sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -lqt | cut -d\| -f1 | grep -qw "$DB_NAME"; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

# Save the generated password where we can read it back to put in .env
echo "[setup] DB password generated. Use this in /opt/restaurant-pos/.env:"
echo
echo "    DATABASE_URL=\"postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public\""
echo
echo "(also written to /root/pos-db-credentials — delete it once you've copied it into .env)"
umask 077
echo "DATABASE_URL=\"postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public\"" > /root/pos-db-credentials

# --- 4. Layout --------------------------------------------------------------
mkdir -p "$APP_DIR" "$LOG_DIR" /var/backups/restaurant-pos
chown "$APP_USER:$APP_USER" "$APP_DIR" "$LOG_DIR"
chown postgres:postgres /var/backups/restaurant-pos

# --- 5. systemd unit (operator copies it after the repo is cloned) ----------
echo
echo "[setup] done."
echo
echo "Next steps:"
echo "  1. sudo -u $APP_USER git clone https://github.com/d4not/Restaurant-POS.git $APP_DIR"
echo "  2. sudo cp $APP_DIR/deploy/.env.production.example $APP_DIR/.env"
echo "  3. sudo nano $APP_DIR/.env       # paste DATABASE_URL from /root/pos-db-credentials, generate JWT_SECRET"
echo "  4. sudo cp $APP_DIR/deploy/pos-backend.service /etc/systemd/system/"
echo "  5. sudo systemctl daemon-reload && sudo systemctl enable pos-backend"
echo "  6. sudo -u $APP_USER bash $APP_DIR/deploy/deploy.sh"
echo "  7. (optional) sudo cp $APP_DIR/deploy/crontab.example /etc/cron.d/restaurant-pos"
