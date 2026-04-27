<div align="center">

<img src="docs/screenshots/logo.png" alt="Restaurant POS" width="120" />

# Restaurant POS

A self-hosted Point of Sale system for cafés and small restaurants — runs on your local network, no cloud, no subscription.

[![Node](https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-30-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Capacitor](https://img.shields.io/badge/Capacitor-7-119EFF?logo=capacitor&logoColor=white)](https://capacitorjs.com/)

</div>

---

## At a glance

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/admin-dashboard.png" alt="Admin dashboard" />
<p align="center"><sub><b>Admin panel</b> — sales, inventory, products, staff, reports</sub></p>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/terminal-floor-plan.png" alt="Terminal floor plan" />
<p align="center"><sub><b>Terminal floor plan</b> — tap a table to open a ticket</sub></p>
</td>
</tr>
<tr>
<td colspan="2">
<img src="docs/screenshots/terminal-table-detail.png" alt="Terminal table detail" />
<p align="center"><sub><b>Terminal order workspace</b> — products, ticket with course tracking, send to kitchen, split payment</sub></p>
</td>
</tr>
</table>

---

## What's in the box

| App                 | Stack                                     | Runs on                                     |
| ------------------- | ----------------------------------------- | ------------------------------------------- |
| **Backend API**     | Node 20 · Express · Prisma · Zod · JWT    | A LAN server (Linux / macOS / Windows)      |
| **Admin panel**     | React 18 · Vite · TanStack Query          | Any modern browser                          |
| **Terminal Desktop** | Electron 30 · React · `node-thermal-printer` | Cashier PC — drives USB / network printers |
| **Terminal Mobile** | Capacitor 7 · React (shared with Desktop) | Android tablet — sideload the APK          |

A single backend serves all three clients over the LAN. The two terminal builds share their UI through a thin platform-abstraction layer; only printing, storage, and haptics are implemented twice.

---

## Architecture

```
┌──────────────┐        ┌────────────────────┐
│  /admin      │  HTTPS │                    │      PostgreSQL
│  React/Vite  ├───────►│   /src             ├───────────────────┐
│  (browser)   │        │   Express + JWT    │                   │
└──────────────┘        │   Prisma + Zod     │                   ▼
                        │   ESC/POS printer  │              ┌──────────┐
┌──────────────┐  HTTP  │                    │              │   DB     │
│  /terminal   ├───────►│   :3000            │              └──────────┘
│  Electron    │        └────────────────────┘
│  (cashier)   │                  ▲
└──────────────┘                  │ HTTP (LAN)
                                  │
┌──────────────────┐              │
│ /terminal-mobile ├──────────────┘
│ Capacitor (APK)  │
│ (waiter tablet)  │
└──────────────────┘
```

| Folder              | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `src/`              | Express REST API (`/api/v1/...`), JWT auth, ESC/POS print |
| `prisma/`           | PostgreSQL schema, migrations, demo seed               |
| `admin/`            | Back-office for products, supplies, reports            |
| `terminal/`         | Cashier station — Electron, runs on a local PC         |
| `terminal-mobile/`  | Waiter tablet — Capacitor, lands on Android in landscape |
| `apk/`              | Pre-built debug APK for sideloading                    |
| `docs/`             | Specs, design references, screenshots                  |

---

## Quick start

> **Need:** Node 20+, PostgreSQL 16, and a LAN your tablet can reach. To rebuild the APK: JDK 21 and an Android SDK.

```bash
# 1 — install workspace dependencies
npm install

# 2 — set up the database
cp .env.example .env                       # edit DATABASE_URL and JWT_SECRET
npx prisma migrate deploy
npx prisma db seed                         # demo products, supplies, users

# 3 — run the API on http://0.0.0.0:3000
npm run dev
```

Then start any of the clients:

<details>
<summary><b>Admin panel</b> — http://localhost:5174</summary>

```bash
cd admin
npm install
npm run dev
```

Sign in as `admin@pos.local` / `admin123`.

</details>

<details>
<summary><b>Terminal Desktop (Electron)</b> — opens a window</summary>

```bash
cd terminal
npm install
npm run dev          # Vite + Electron with hot reload
```

PIN login uses the seeded users (see [Test credentials](#test-credentials)). The renderer auto-resolves the API on the same hostname at port 3000; override with `VITE_API_URL` or change it from the in-app **Settings** modal.

Production build:

```bash
npm run build        # packages an installer with electron-builder
```

</details>

<details>
<summary><b>Terminal Mobile (Android tablet)</b> — install the APK</summary>

A debug-signed APK is committed at [`apk/pos-terminal-debug.apk`](apk/pos-terminal-debug.apk).

1. Enable **Install unknown apps** for your file manager on the tablet.
2. Copy the APK over USB / Drive / email and tap to install.
3. Launch **POS Terminal**. The PIN screen shows the current server URL at the bottom and a **Change server** button.
4. Tap **Change server**, enter `http://<your-server-lan-ip>:3000/api/v1`, OK.
5. Sign in with a PIN.

The URL is persisted in Capacitor Preferences and survives app restarts. **No fixed IP is required** — the app works on any network as long as the backend is reachable.

</details>

<details>
<summary><b>Rebuild the APK</b></summary>

```bash
cd terminal-mobile
npm install

# (optional) bake in a default server URL so first launch skips manual setup
echo 'VITE_MOBILE_DEFAULT_SERVER_URL=http://192.168.1.42:3000/api/v1' > .env

npm run build
npx cap sync android

cd android
ANDROID_HOME=/path/to/android-sdk \
JAVA_HOME=/path/to/jdk-21 \
./gradlew assembleDebug
```

Output: `terminal-mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

</details>

---

## Configuration

### Backend (`.env`)

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/restaurant_pos?schema=public"
JWT_SECRET="<at least 16 chars — generate a long random string>"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=3000
NODE_ENV="development"
LOG_LEVEL="debug"
```

### Network printers

ESC/POS over TCP (port 9100 by default). Configure addresses from the admin panel under **System → Settings**, or the `Settings` table:

| Key                      | Example         | Notes                              |
| ------------------------ | --------------- | ---------------------------------- |
| `printer_kitchen_ip`     | `192.168.1.50`  | Kitchen comanda printer            |
| `printer_kitchen_port`   | `9100`          | TCP port                           |
| `printer_receipt_ip`     | `192.168.1.51`  | Customer receipt printer           |
| `printer_receipt_port`   | `9100`          |                                    |
| `printer_paper_width`    | `58` or `80`    | Receipt width in mm                |

The mobile build calls `POST /api/v1/print/kitchen` and `POST /api/v1/print/receipt`. The desktop build can either delegate to the same endpoints or print directly via Electron + `node-thermal-printer`.

---

## Test credentials

Seeded by `npx prisma db seed`. See [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) for the full role matrix and what each role can do.

| Role     | Name              | Email             | PIN  | Admin password |
| -------- | ----------------- | ----------------- | ---- | -------------- |
| ADMIN    | Cafe Admin        | admin@pos.local   | 1234 | `admin123`     |
| MANAGER  | Lucia Ramirez     | lucia@pos.local   | 2003 | —              |
| CASHIER  | Carlos Mendoza    | carlos@pos.local  | 2002 | —              |
| BARISTA  | Sofia Hernandez   | sofia@pos.local   | 2001 | —              |
| WAITER   | Andrea Valdez     | andrea@pos.local  | 2004 | —              |

> Demo accounts only — change them before any non-local deployment.

---

## Highlights

- **Inventory the way real cafés use it.** 3-layer unit model (purchase / inventory / recipe), weighted-average cost, multi-storage stock, transfers, write-offs, partial-bottle tare weights for liquor inventory.
- **Recipes that update with cost.** Modifier groups support both *swap* (replace an ingredient) and *add* (stack on top); recipe cost recalculates on every purchase confirmation.
- **Tax-inclusive prices.** Prices are entered as the customer pays them; the API splits subtotal and tax server-side.
- **Single-transaction sale deduction.** Closing an order updates stock, logs the movement, and updates WAC inside a single Prisma transaction.
- **Role-based gates, both in UI and API.** Waiters can't process payment; cashiers can't delete tables. PIN step-up authorizes destructive actions like cancelling a sent ticket.
- **Offline-aware tablet.** TanStack Query auto-pauses while the WiFi drops; an orange banner surfaces the state without locking the cashier out of cached data.

---

## Tests

```bash
npm test                                   # backend Vitest + Supertest suite
```

The suite covers auth, orders, payments, inventory deduction, print formatting, and PIN step-up gates.

---

## Repository layout

```
.
├── src/                  Express API source
├── prisma/               schema, migrations, seed
├── admin/                React admin panel (Vite)
├── terminal/             Electron desktop POS (Vite renderer)
├── terminal-mobile/      Capacitor Android tablet POS
├── apk/                  Pre-built debug APK
├── tests/                Vitest + Supertest suite
├── docs/                 Specs, design refs, screenshots
└── scripts/              one-off maintenance scripts
```

For deeper docs:

- [`docs/SPEC.md`](docs/SPEC.md) — backend business logic
- [`docs/FRONTEND-SPEC.md`](docs/FRONTEND-SPEC.md) — admin panel
- [`docs/TERMINAL-SPEC.md`](docs/TERMINAL-SPEC.md) — Electron terminal
- [`docs/MOBILE-SPEC.md`](docs/MOBILE-SPEC.md) — Capacitor tablet
- [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) — role matrix

---

## License

Released under the [MIT License](LICENSE).
