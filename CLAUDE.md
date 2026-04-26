# Restaurant POS System

## Project Structure
- `/src` — Backend (Express API)
- `/admin` — Frontend admin panel (React + Vite)
- `/terminal` — POS terminal (Electron + React)
- `/prisma` — Database schema and migrations
- `/docs` — Specifications and design references

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

## POS Terminal (/terminal)

### Stack
- Electron 30+ (main process)
- React + TypeScript + Vite (renderer)
- node-thermal-printer for ESC/POS printing
- TanStack Query, Zustand

### Commands
- `cd terminal && npm run dev` — start Electron in dev mode
- `cd terminal && npm run build` — package Electron app

### Design
- YOU MUST match the design in @docs/pos-terminal-styles.js — this is the authoritative reference
- SAME warm light theme as admin panel — NOT dark theme
- CSS variables: --bg (#f5f0e8), --sidebar (#2c2420), --gold (#c9a45c), --green (#4a8c5c), --red (#c45040)
- Fonts: Playfair Display (headings), DM Sans (body)
- Top bar: dark brown (#2c2420), 72px height, center nav tabs, right status area
- Touch targets: 44px+ height minimum
- Time-based color coding: green <10min, gold 10-25min, red 25+min

### Key Screens (from wireframe)
- **Active Orders**: zone-grouped collapsible rows, expandable inline, footer summary bar
- **Floor Plan**: visual table canvas with positioned elements, edit mode for drag/resize
- **Table Detail**: 3-column layout (categories+products | ticket | payment)
- **Order History**: searchable completed orders list
- **Settings**: modal with left nav sections (general, printers, users)

### Printing
- Electron main process handles ESC/POS via IPC
- Two printers: receipt + kitchen
- Renderer calls: window.electron.printKitchen(data), window.electron.printReceipt(data)

---

## IMPORTANT
- Read @docs/SPEC.md for ALL backend business logic
- Read @docs/FRONTEND-SPEC.md for admin panel pages
- Read @docs/TERMINAL-SPEC.md for POS terminal specification
- Read @docs/pos-terminal-design.html for terminal design reference — the wireframe is the source of truth
- Never use floating point for money
- Always wrap multi-table writes in Prisma transactions
- Inventory operations MUST update stock AND log movement in a single transaction
- Prices are TAX-INCLUSIVE — never add tax on top
- Modifier groups: SWAP replaces recipe ingredients, ADD stacks on top
- Recipe modifier lines link to a modifier_group_id, not a specific supply
- ALL UI text in English
