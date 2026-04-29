# Production Deployment Guide

This document covers deploying the Restaurant POS in a real café:
server setup, daily operations, updates, backups, rollback, and the desktop /
mobile clients.

If you only want to run the project locally for development, see the README's
**Quick start**. This guide is for the LAN server that the cafe terminals talk
to.

---

## 1. Architecture recap

```
                          ┌──────────────────────┐
   tablets, cashier PC ───┤ backend on LAN :3000 ├─── PostgreSQL
   ESC/POS printers   ←───┤ admin web on :5174   │
                          └──────────────────────┘
```

One Linux box (mini-PC, NUC, refurbished desktop) runs:
- PostgreSQL 16
- The Node API on port 3000
- Optionally the admin panel on port 5174 (or behind nginx on 80/443)

The cashier terminal (Electron) and waiter tablets (APK) connect to it over
Wi-Fi/Ethernet.

---

## 2. Server hardware & OS

**Minimum**:
- 2-core CPU, 4 GB RAM, 64 GB SSD
- Wired Ethernet (Wi-Fi works but is less reliable for printers)
- A static LAN IP (or DHCP reservation by MAC on your router)

**Recommended OS**: Debian 12 or Ubuntu 22.04/24.04 LTS. The deploy scripts
are written for `apt`. Arch / Fedora work too — adjust the package install
commands.

---

## 3. First-time server setup

The `deploy/setup-server.sh` script handles the OS-level work for a fresh
Debian/Ubuntu box. Run it as root.

```bash
# On the server
curl -fsSL https://raw.githubusercontent.com/d4not/Restaurant-POS/master/deploy/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh
```

It installs Node 20, PostgreSQL 16, creates the `pos` system user, generates a
random DB password, and prints the next steps.

If you'd rather see the steps before running them, open the script — it's about
80 lines of straightforward shell.

### After `setup-server.sh`

1. **Clone the repo**:
   ```bash
   sudo -u pos git clone https://github.com/d4not/Restaurant-POS.git /opt/restaurant-pos
   ```

2. **Configure the environment**:
   ```bash
   sudo cp /opt/restaurant-pos/deploy/.env.production.example /opt/restaurant-pos/.env
   sudo nano /opt/restaurant-pos/.env
   ```
   - Paste the `DATABASE_URL` that the setup script wrote to
     `/root/pos-db-credentials`.
   - Generate a JWT secret:
     ```bash
     openssl rand -base64 48
     ```
   - Set `NODE_ENV=production` and `LOG_LEVEL=info`.
   - Delete `/root/pos-db-credentials` once the value is in `.env`.
   - **Lock down the .env file**: `sudo chmod 600 /opt/restaurant-pos/.env && sudo chown pos:pos /opt/restaurant-pos/.env`.

3. **Install the systemd unit**:
   ```bash
   sudo cp /opt/restaurant-pos/deploy/pos-backend.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable pos-backend
   ```

4. **First build & start**:
   ```bash
   sudo -u pos bash /opt/restaurant-pos/deploy/deploy.sh
   ```
   The script snapshots the DB (no-op on a brand-new box), pulls, installs,
   migrates, builds, and restarts. The first run takes a few minutes.

5. **Seed initial data** (optional, for a starter menu / users):
   ```bash
   cd /opt/restaurant-pos
   sudo -u pos npx prisma db seed
   ```
   Skip this in production if you'd rather create everything from the admin
   panel — the seed adds demo users with public passwords.

6. **Verify**:
   ```bash
   curl http://localhost:3000/health        # → 200 OK
   sudo systemctl status pos-backend         # → active (running)
   ```

7. **Set up backups & cron**:
   ```bash
   sudo cp /opt/restaurant-pos/deploy/crontab.example /etc/cron.d/restaurant-pos
   sudo chmod 644 /etc/cron.d/restaurant-pos
   sudo systemctl restart cron
   ```
   Then run a backup manually once to confirm it works:
   ```bash
   sudo bash /opt/restaurant-pos/deploy/backup.sh
   ls /var/backups/restaurant-pos/daily/
   ```

8. **Lock down the firewall** (Debian/Ubuntu with `ufw`):
   ```bash
   sudo ufw allow ssh
   sudo ufw allow from 192.168.0.0/16 to any port 3000   # adjust to your LAN
   sudo ufw enable
   ```

9. **Change default credentials**: log into the admin panel as
   `admin@pos.local` / `admin123` and **immediately change the password**.
   Then change PINs of the seeded staff users (or delete them and create the
   real ones).

---

## 4. Repo strategy: don't contaminate your public repo

Your public repo (`github.com/d4not/Restaurant-POS`) holds the **product**.
Your café's data — products, prices, fotos, IPs of impresoras, JWT secret —
lives **only on the server**.

The deploy scripts assume this model:
- `/opt/restaurant-pos` is a `git clone` of the public repo on the server
- `/opt/restaurant-pos/.env` is **outside** of git (already in `.gitignore`)
- All operational data is in PostgreSQL — also outside of git
- Updates flow one-way: GitHub → server (via `git pull`)

You make changes on your dev machine → push to GitHub → run
`deploy/deploy.sh` on the server. Nothing café-specific ever touches the
public repo.

If you need versioned overrides (custom logo, branded receipt header, etc.)
the cleanest pattern is a second **private** repo (`Restaurant-POS-mycafe`) that
contains just the `.env` template, custom assets, and notes. Clone it as
`/opt/restaurant-pos-overrides/` and symlink files into place. For most cases
you don't need this — keep it simple.

---

## 5. Day-2 operations

### Updating to a newer commit
```bash
sudo -u pos bash /opt/restaurant-pos/deploy/deploy.sh
```
This is safe to re-run; it's a no-op when there's nothing new on the branch.
The script always takes a pre-deploy DB snapshot in
`/var/backups/restaurant-pos/pre-deploy/` so you can roll back.

### Backups
- Cron runs `deploy/backup.sh` daily at 03:00.
- Retention: 14 daily, 8 weekly, 12 monthly (~14 months total).
- Storage path: `/var/backups/restaurant-pos/`.
- **Validate quarterly**: pick a backup, restore it to a scratch DB, browse
  the data in `psql`. Backups you've never tested are not backups.

```bash
# Manual backup (e.g., before a risky change)
sudo bash /opt/restaurant-pos/deploy/backup.sh
```

### Restoring from a backup
```bash
sudo systemctl stop pos-backend
sudo bash /opt/restaurant-pos/deploy/restore.sh /var/backups/restaurant-pos/daily/restaurant_pos-XXXXXXXX.dump
sudo systemctl start pos-backend
```
The restore script asks for confirmation (you have to type the DB name) before
dropping the database.

### Logs
- Service stdout/stderr: `journalctl -u pos-backend -f` (live tail).
- Persistent file logs: `/var/log/restaurant-pos/backend.log` and
  `backend.err.log` (the systemd unit appends to them).
- Cron / backup logs: `/var/log/restaurant-pos/backup.log`.

### Restarting / stopping
```bash
sudo systemctl restart pos-backend
sudo systemctl stop pos-backend
sudo systemctl status pos-backend
```

---

## 6. Rolling back a bad deploy

If something breaks after `deploy.sh`:

```bash
# 1. Stop the service
sudo systemctl stop pos-backend

# 2. Restore the pre-deploy DB snapshot
ls /var/backups/restaurant-pos/pre-deploy/ | tail -3
sudo bash /opt/restaurant-pos/deploy/restore.sh \
  /var/backups/restaurant-pos/pre-deploy/pre-deploy-YYYYMMDD-HHMMSS.dump

# 3. Roll the code back one commit
cd /opt/restaurant-pos
sudo -u pos git log --oneline -5            # find the good commit
sudo -u pos git reset --hard <good-commit-sha>

# 4. Rebuild and restart
sudo -u pos npm ci
sudo -u pos npm run build
sudo systemctl start pos-backend
```

---

## 7. Database safety rules (read this before iterating)

These are non-negotiable:

1. **In production never run `prisma migrate dev`, `prisma migrate reset`, or
   `prisma db push`.** Only `prisma migrate deploy`. The other commands can
   wipe the database when they detect drift.
2. **Always snapshot before a migration**. `deploy.sh` does this automatically.
   For ad-hoc work: `sudo -u postgres pg_dump -Fc -d restaurant_pos > before.dump`.
3. **Schema changes that drop columns or tables are a two-step deploy**:
   - Step 1: release code that doesn't use the column anymore.
   - Step 2: in the next release, ship the migration that drops it.
   This way a rollback to the previous code keeps working.
4. **The app DB user (`pos_app`) does not own the schema.** It only has
   `SELECT/INSERT/UPDATE/DELETE`. Migrations run as a separate
   superuser-ish role (`postgres`) — limits the blast radius if the app is
   compromised.

---

## 8. Network & printers

### Static IP for the server
Easiest is a DHCP reservation by MAC on the router. The terminals will then
always find the server at the same address. If you set a static IP on the
server itself, also set the router's DNS or use the IP directly.

### Printer configuration
ESC/POS over TCP (port 9100). In the admin panel under
**System → Settings**, set:
- `printer_kitchen_ip` (e.g., 192.168.1.50)
- `printer_kitchen_port` (default 9100)
- `printer_receipt_ip`
- `printer_receipt_port`
- `printer_paper_width` (58 or 80 mm)

Test prints from **System → Settings → Printers**.

### Tablets
1. Sideload `apk/pos-terminal-debug.apk` on each Android tablet.
2. Tap **Change server** on the PIN screen, enter
   `http://<server-lan-ip>:3000/api/v1`.
3. Sign in with a PIN.
The URL persists across app restarts.

---

## 9. Building the desktop terminal (Electron)

On a developer box (not the server):

```bash
cd terminal
npm install
npm run build:linux         # → release/POS Terminal-0.1.0.AppImage
                            #   release/restaurant-pos-terminal_0.1.0_amd64.deb
npm run build:win           # → release/POS Terminal Setup 0.1.0.exe (cross-build)
npm run build:mac           # → release/POS Terminal-0.1.0.dmg (only on macOS)
```

The output lands in `terminal/release/`.

### Caveats
- **Arch Linux**: building the `.deb` needs `libxcrypt-compat` (the bundled
  `fpm` tool needs `libcrypt.so.1`, which is not on Arch by default). Install
  it from AUR, or build only the AppImage with `electron-builder --linux AppImage`.
- **Mac DMG**: `electron-builder` can only produce a usable DMG when run on
  macOS — code signing requires it.
- **Windows installer from Linux**: works with the bundled wine, but signing
  the installer requires a Windows code-signing certificate.

### Distributing the Electron build
For a single café, copy the AppImage onto the cashier PC and create a desktop
shortcut. For multiple cafés, you can host the AppImage on a private server
and write an updater (electron-builder supports auto-update via
`electron-updater` and a static file server).

The AppImage is single-file and portable; no install required:
```bash
chmod +x "POS Terminal-0.1.0.AppImage"
./POS\ Terminal-0.1.0.AppImage
```

---

## 10. Building the Android APK

```bash
cd terminal-mobile
npm install
npm run build
npx cap sync android
cd android
ANDROID_HOME=/path/to/android-sdk JAVA_HOME=/path/to/jdk-21 ./gradlew assembleDebug
```
Output: `android/app/build/outputs/apk/debug/app-debug.apk`.

For a release-signed APK (Play Store / better-trusted sideload):
1. Generate a keystore: `keytool -genkey -v -keystore release.keystore -alias pos -keyalg RSA -keysize 2048 -validity 10000`.
2. Add signing config to `android/app/build.gradle`.
3. `./gradlew assembleRelease`.

The committed `apk/pos-terminal-debug.apk` is debug-signed — fine for internal
sideload, not suitable for Play Store.

---

## 11. Troubleshooting

### Service won't start
```bash
sudo journalctl -u pos-backend -n 100
```
Common causes:
- `.env` not readable by `pos` user: `sudo chown pos:pos /opt/restaurant-pos/.env`
- `DATABASE_URL` wrong / DB unreachable: `sudo -u pos psql "$DATABASE_URL" -c '\\l'`
- Port 3000 already in use: `sudo ss -tlnp | grep 3000`

### Tablets can't reach the server
- Confirm tablet and server are on the same Wi-Fi network.
- Confirm firewall allows the LAN: `sudo ufw status`.
- From the tablet's browser, open `http://<server-ip>:3000/health`. If that
  doesn't work, the network is the problem, not the app.

### Prisma migration fails
```bash
# Check pending migrations
cd /opt/restaurant-pos && sudo -u pos npx prisma migrate status

# If a migration is in a "failed" state, you have to fix it manually:
# - Read the migration SQL and apply the fix in psql
# - Mark the migration as applied: prisma migrate resolve --applied <name>
# - Or rollback DB to the snapshot and revert the code.
```

### Printer doesn't print
- Ping the printer IP from the server: `ping 192.168.1.50`.
- Telnet to its port: `nc -zv 192.168.1.50 9100`.
- Test from the admin panel: **System → Settings → Test print**.

---

## 12. Production checklist

Before opening the café:

- [ ] `JWT_SECRET` is a fresh random 48+ char string (not the dev placeholder)
- [ ] `NODE_ENV=production`, `LOG_LEVEL=info`
- [ ] `DATABASE_URL` uses a non-superuser PostgreSQL role
- [ ] `admin@pos.local` password changed from the seed default
- [ ] All staff PINs are real, not the `200X` seed PINs
- [ ] Backups run daily and at least one has been restored to verify
- [ ] Firewall allows only LAN to port 3000
- [ ] Server has a static LAN IP / DHCP reservation
- [ ] systemd unit installed and `pos-backend` is enabled (auto-start on boot)
- [ ] Printer IPs configured in admin panel and test prints work
- [ ] Each tablet has the APK installed and the server URL set
- [ ] Cashier PC has the AppImage / installer and a desktop shortcut
- [ ] Business name, address, RFC set in admin (for receipt header)
- [ ] You've practiced a rollback once on a non-prod box
