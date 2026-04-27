# Restaurant POS

A self-hosted Point of Sale system for cafés and small restaurants. Designed to run on the local network: a Node.js backend, a web admin panel, an Electron POS terminal for the cashier station, and a Capacitor Android tablet app for waiters.

## Architecture

```
┌──────────────┐        ┌──────────────────┐
│  /admin      │  HTTP  │                  │   PostgreSQL
│  React/Vite  ├───────►│   /src           ├───────────────┐
└──────────────┘        │   Express + JWT  │               │
                        │   Prisma ORM     │               ▼
┌──────────────┐  HTTP  │                  │           ┌──────┐
│  /terminal   ├───────►│   :3000          │           │  DB  │
│  Electron    │        └──────────────────┘           └──────┘
└──────────────┘                ▲
                                │ HTTP (LAN)
┌──────────────────┐            │
│ /terminal-mobile ├────────────┘
│ Capacitor (APK)  │
└──────────────────┘
```

| Folder              | Stack                                   | Role                                          |
| ------------------- | --------------------------------------- | --------------------------------------------- |
| `src/`              | Node.js 20 + Express + Prisma + Zod     | REST API (`/api/v1`), JWT auth, ESC/POS print |
| `prisma/`           | PostgreSQL 16 schema + migrations + seed | Single source of truth for the data model     |
| `admin/`            | React 18 + Vite + TanStack Query        | Back-office: products, supplies, reports      |
| `terminal/`         | Electron 30 + React + node-thermal-printer | Cashier station — runs on a local PC      |
| `terminal-mobile/`  | Capacitor 7 (Android) reusing `terminal/src` | Waiter tablet — APK in landscape          |
| `apk/`              | —                                       | Pre-built debug APK (`pos-terminal-debug.apk`) |
| `docs/`             | —                                       | `SPEC.md`, `PERMISSIONS.md`, design references |

---

## Prerequisites

- **Node.js 20+** and **npm 10+**
- **PostgreSQL 16** (any local instance works)
- **Java JDK 21** + **Android SDK** — only required to *rebuild* the mobile APK
- A LAN where the backend host has a reachable address from the tablet (any private IP works — no fixed addresses required)

---

## 1. Backend API

```bash
# install root dependencies (backend + workspaces)
npm install

# create the database and copy the env template
cp .env.example .env
# then edit .env — at minimum set DATABASE_URL and JWT_SECRET

# apply migrations and seed demo data (products, supplies, users)
npx prisma migrate deploy
npx prisma db seed

# start the API on port 3000
npm run dev
```

`.env` keys (see `.env.example`):

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/restaurant_pos?schema=public"
JWT_SECRET="<at least 16 chars — generate a long random string>"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=3000
NODE_ENV="development"
LOG_LEVEL="debug"
```

The API listens on `http://localhost:3000` by default and binds to all interfaces, so any LAN client can reach it at `http://<host-ip>:3000/api/v1`.

Run the test suite:

```bash
npm test
```

---

## 2. Admin Panel

```bash
cd admin
npm install
npm run dev   # http://localhost:5174
```

Sign in with the seeded admin: **`admin@pos.local` / `admin123`**.

The admin panel reads `VITE_API_URL` if set, otherwise it auto-resolves the API on the same hostname at port 3000 (so a tablet browsing the dev preview at `192.168.x.y:5174` automatically talks to `192.168.x.y:3000`).

---

## 3. Terminal Desktop (Electron)

```bash
cd terminal
npm install
npm run dev   # opens the Electron window with hot reload
```

PIN login uses the seeded users — see [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md). Defaults: ADMIN PIN **1234**, CASHIER **2002**, WAITER **2004**.

Production build:

```bash
cd terminal
npm run build
```

The Electron renderer auto-detects the API on the same host (port 3000). To override, edit the server URL inside the **Settings** modal or set `VITE_API_URL` at build time.

---

## 4. Terminal Mobile (Android tablet)

### Option A — install the pre-built APK

A debug-signed APK is committed at [`apk/pos-terminal-debug.apk`](apk/pos-terminal-debug.apk). To use it:

1. Enable **Install unknown apps** for your file manager on the tablet.
2. Copy the APK over USB / Drive / email and tap to install.
3. Launch **POS Terminal**. The PIN screen shows the current server URL at the bottom and a **Change server** button.
4. Tap **Change server**, enter your backend URL (e.g. `http://192.168.1.42:3000/api/v1`), and tap OK.
5. Sign in with a PIN.

The URL is persisted in Capacitor Preferences and survives app restarts. There is no hardcoded LAN address — the app works on any network as long as the backend is reachable from the tablet.

### Option B — rebuild the APK yourself

Requires JDK 21 and an Android SDK with `build-tools` and `platforms;android-34`.

```bash
cd terminal-mobile
npm install

# (optional) bake in a default server URL so first-launch users
# don't have to configure it manually
echo 'VITE_MOBILE_DEFAULT_SERVER_URL=http://192.168.1.42:3000/api/v1' > .env

# build the web bundle and sync into the Android project
npm run build
npx cap sync android

# build the debug APK
cd android
ANDROID_HOME=/path/to/android-sdk \
JAVA_HOME=/path/to/jdk-21 \
./gradlew assembleDebug
```

Output: `terminal-mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

The mobile build never imports Capacitor plugins from `terminal/src` directly — the platform abstraction in [`terminal/src/platform/`](terminal/src/platform/) keeps print, storage, haptics, and network calls swappable per platform. Printing on the tablet is delegated to the backend (`POST /api/v1/print/kitchen|receipt`); the desktop terminal uses node-thermal-printer over IPC instead.

---

## Test credentials (seed data)

Created by `npx prisma db seed`. See [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) for the full role matrix.

| Role     | Name              | Email             | PIN  | Admin password |
| -------- | ----------------- | ----------------- | ---- | -------------- |
| ADMIN    | Cafe Admin        | admin@pos.local   | 1234 | `admin123`     |
| MANAGER  | Lucia Ramirez     | lucia@pos.local   | 2003 | —              |
| CASHIER  | Carlos Mendoza    | carlos@pos.local  | 2002 | —              |
| BARISTA  | Sofia Hernandez   | sofia@pos.local   | 2001 | —              |
| WAITER   | Andrea Valdez     | andrea@pos.local  | 2004 | —              |

These are demo accounts for local development — change them before any non-local deployment.

---

## Network printing

The backend speaks ESC/POS over TCP (port 9100 by default) to network thermal printers. Configure the printer addresses in the admin panel under **System → Settings**, or via the `Settings` table directly:

```
printer_kitchen_ip    e.g. 192.168.1.50
printer_kitchen_port  9100
printer_receipt_ip    e.g. 192.168.1.51
printer_receipt_port  9100
printer_paper_width   58 or 80 (mm)
```

The mobile app calls `POST /api/v1/print/kitchen` and `POST /api/v1/print/receipt`; the desktop terminal can either delegate to the same endpoints or print directly via Electron + `node-thermal-printer`.

---

## Repository layout cheatsheet

```
.
├── src/                  Express API source
├── prisma/               schema, migrations, seed
├── admin/                React admin panel
├── terminal/             Electron desktop POS
├── terminal-mobile/      Capacitor Android tablet POS
├── apk/                  Pre-built debug APK
├── tests/                Vitest + Supertest test suite
├── docs/                 Specs and design references
└── scripts/              one-off maintenance scripts
```

---

## License

No license file is included — all rights reserved unless a `LICENSE` file is added later.
