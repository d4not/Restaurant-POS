# Restaurant POS System

## Project Structure
- `/src` — Backend (Express API)
- `/admin` — Frontend admin panel (React + Vite)
- `/terminal` — POS terminal desktop (Electron + React)
- `/terminal-mobile` — POS terminal tablet (Capacitor + React, shares code from terminal/src/)
- `/prisma` — Database schema and migrations
- `/docs` — Specifications and design references
- `/.claude/steering` — Context docs for technical decisions

---

## Backend

### Stack
- Node.js 20+ with TypeScript (strict mode)
- Express.js + Zod validation
- PostgreSQL 16 + Prisma ORM
- Auth: JWT with PIN login (terminal) and email/password login (admin)
- Testing: Vitest + Supertest

### Commands
- `npm run dev` — start API server with tsx watch
- `npm run build` — compile TypeScript
- `npm run test` — run all tests
- `npx prisma migrate dev` — run migrations
- `npx prisma generate` — regenerate Prisma client
- `npx prisma db seed` — seed database

### Architecture
- `src/modules/<module>/` — each module has: routes.ts, controller.ts, service.ts, schema.ts
- Business logic in service.ts, never in controllers
- Transactions for any operation that modifies multiple tables
- Error handling: custom AppError classes, caught by global error middleware

### Code Rules
- ES modules only, never CommonJS
- File naming: kebab-case
- All monetary values as integers in centavos — NEVER floats
- Use decimal.js for all arithmetic (costs, quantities, conversions)
- Prices are TAX-INCLUSIVE: base = price / (1 + rate/100), tax = price - base
- Dates stored as UTC
- snake_case for all DB tables and columns

### API Conventions
- RESTful: /api/v1/<resource>
- Response: { success: boolean, data?: T, error?: { message, code } }
- Pagination: cursor-based with ?cursor=&limit=
- HTTP codes: 200, 201, 400, 401, 403, 404, 409, 422, 500

---

## Admin Panel (/admin)

### Stack
- React 18+ with TypeScript (strict mode)
- Vite, React Router v6, TanStack Query, Zustand, Recharts

### Commands
- `cd admin && npm run dev` — start dev server
- `cd admin && npm run build` — production build

### Design
- YOU MUST use the CSS classes and variables from @docs/mockup-style.css
- Fonts: Playfair Display (headings), DM Sans (body)
- Warm light theme: cream bg, dark brown sidebar, gold accent
- No UI frameworks (no Tailwind, no MUI)

---

## POS Terminal Desktop (/terminal)

### Stack
- Electron 30+ (main process)
- React + TypeScript + Vite (renderer)
- node-thermal-printer for ESC/POS printing
- TanStack Query, Zustand

### Commands
- `cd terminal && npm run dev` — start Electron in dev mode
- `cd terminal && npm run build` — package Electron app

### Design
- YOU MUST match the design in @docs/pos-terminal-styles.js
- SAME warm light theme as admin panel — NOT dark theme
- CSS variables: --bg (#f5f0e8), --sidebar (#2c2420), --gold (#c9a45c), --green (#4a8c5c), --red (#c45040)
- Fonts: Playfair Display (headings), DM Sans (body)
- Touch targets: 44px+ height minimum
- Time-based color coding: green <10min, gold 10-25min, red 25+min

### Printing
- Electron main process handles ESC/POS via IPC
- Two printers: receipt + kitchen
- Renderer calls: window.electron.printKitchen(data), window.electron.printReceipt(data)

---

## POS Terminal Mobile (/terminal-mobile)

### Stack
- Capacitor 7+ (Android shell)
- Shares React code from /terminal/src/ via Vite alias
- @capacitor/preferences, @capacitor/network, @capacitor/haptics

### Commands
- `cd terminal-mobile && npm run dev` — browser testing
- `cd terminal-mobile && npm run build` — build for Capacitor
- `cd terminal-mobile && npx cap sync android` — sync to Android project
- `cd terminal-mobile && npx cap open android` — open in Android Studio

### Rules
- NEVER duplicate code from terminal/src/ — import via @ alias
- NEVER import @capacitor/* in terminal/src/ — only in terminal-mobile/src/platform/
- All printing goes through backend API (POST /api/v1/print/*) — no direct printer access
- Auth tokens in @capacitor/preferences, never localStorage
- Landscape only, min Android API 26
- Platform-specific code ONLY in terminal-mobile/src/platform/
- Terminal and terminal-mobile share code via terminal/src/platform/ abstraction layer

---

## IMPORTANT
- Read @docs/SPEC.md for ALL backend business logic
- Read @docs/FRONTEND-SPEC.md for admin panel pages
- Read @docs/TERMINAL-SPEC.md for POS terminal desktop specification
- Read @docs/MOBILE-SPEC.md for Android tablet app specification
- Read @docs/pos-terminal-styles.js for terminal design tokens and component styles
- Read @docs/PERMISSIONS.md for role-based access rules
- Terminal mobile shares code with terminal/ via platform abstraction — see terminal/src/platform/
- Never use floating point for money
- Always wrap multi-table writes in Prisma transactions
- Inventory operations MUST update stock AND log movement in a single transaction
- Prices are TAX-INCLUSIVE — never add tax on top
- Modifier groups: SWAP replaces recipe ingredients, ADD stacks on top
- Recipe modifier lines link to a modifier_group_id, not a specific supply
- ALL UI text in English
