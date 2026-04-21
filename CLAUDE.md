# Restaurant POS System

## Project Structure
- `/src` — Backend (Express API)
- `/admin` — Frontend (React admin panel)
- `/prisma` — Database schema and migrations

---

## Backend

### Stack
- Node.js 20+ with TypeScript (strict mode)
- Express.js + Zod validation
- PostgreSQL 16 + Prisma ORM
- Auth: JWT (access + refresh tokens)
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
- All database queries through Prisma, raw SQL only for complex aggregations
- Transactions for any operation that modifies multiple tables
- Error handling: custom AppError classes, caught by global error middleware

### Code Rules
- ES modules only, never CommonJS
- File naming: kebab-case
- All monetary values as integers in centavos — NEVER floats
- Use decimal.js for all arithmetic (costs, quantities, conversions)
- Dates stored as UTC
- snake_case for all DB tables and columns
- Soft delete with deleted_at where applicable

### API Conventions
- RESTful: /api/v1/<resource>
- Response: { success: boolean, data?: T, error?: { message, code } }
- Pagination: cursor-based with ?cursor=&limit=
- HTTP codes: 200, 201, 400, 401, 404, 422, 500

---

## Frontend (admin panel)

### Stack
- React 18+ with TypeScript (strict mode)
- Vite for build/dev
- React Router v6
- TanStack Query for API state
- Zustand for client state (auth, UI)
- Recharts for charts

### Commands
- `cd admin && npm run dev` — start dev server
- `cd admin && npm run build` — production build

### Design System
- YOU MUST use the CSS classes and variables from @mockup-styles.css — do not invent new design tokens
- Fonts: Playfair Display (headings), DM Sans (body)
- Warm color palette: cream bg (#f5f0e8), dark brown sidebar (#1e1108), gold accent (#c8922a)
- See @mockup.html for HTML structure reference
- No UI frameworks (no Tailwind, no MUI) — custom CSS only, matching the existing design system

### Architecture
- `admin/src/api/` — API client + endpoint functions
- `admin/src/components/` — reusable UI (layout/, ui/, forms/, charts/)
- `admin/src/pages/` — one component per route
- `admin/src/hooks/` — custom hooks wrapping TanStack Query
- `admin/src/store/` — Zustand stores
- `admin/src/types/` — TypeScript types matching API responses
- `admin/src/utils/` — formatCurrency, formatDate, etc.

### Code Rules
- Currency display: use Intl.NumberFormat('es-MX') with centavos / 100
- Dates: use date-fns with Spanish locale
- All API calls through TanStack Query (useQuery/useMutation)
- Invalidate related queries on mutations
- Loading and error states on every data-fetching component
- Forms: controlled components with local state, validate before submit

---

## IMPORTANT
- Read @SPEC.md for ALL backend business logic
- Read @FRONTEND-SPEC.md for ALL frontend page specifications
- Never use floating point for money
- Always wrap multi-table writes in Prisma transactions
- Always validate request input with Zod before processing
- Inventory operations MUST update stock AND log the movement in a single transaction
- Frontend MUST use the existing CSS design system — no generic/blue UI
