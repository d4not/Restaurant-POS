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
- DARK warm theme — NOT the same as admin panel
- Large touch targets (48px+ buttons, 56px+ primary actions)
- Minimal navigation, full-screen task focus
- Touch-first: no hover-dependent interactions
- PIN login with numpad

### Printing
- Electron main process handles ESC/POS via IPC
- Two printers: receipt printer (bar) + kitchen printer (kitchen)
- Renderer calls: window.electron.printKitchen(data), window.electron.printReceipt(data)

---

## IMPORTANT
- Read @docs/SPEC.md for ALL backend business logic
- Read @docs/FRONTEND-SPEC.md for admin panel pages
- Read @docs/TERMINAL-SPEC.md for POS terminal specification
- Never use floating point for money
- Always wrap multi-table writes in Prisma transactions
- Inventory operations MUST update stock AND log movement in a single transaction
- Prices are TAX-INCLUSIVE — never add tax on top
- Modifier groups: SWAP replaces recipe ingredients, ADD stacks on top
- Recipe modifier lines link to a modifier_group_id, not a specific supply
