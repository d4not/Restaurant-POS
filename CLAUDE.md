# Restaurant POS Backend

## Stack
- Runtime: Node.js 20+ with TypeScript (strict mode)
- Framework: Express.js with express-validator
- Database: PostgreSQL 16 with Prisma ORM
- Auth: JWT (access + refresh tokens)
- Testing: Vitest + Supertest

## Commands
- `npm run dev` — start dev server with tsx watch
- `npm run build` — compile TypeScript
- `npm run test` — run all tests
- `npm run test:watch` — run tests in watch mode
- `npx prisma migrate dev` — run migrations
- `npx prisma generate` — regenerate Prisma client
- `npx prisma db seed` — seed database

## Code style
- Use ES modules (import/export), never CommonJS
- Use named exports, no default exports except for Express app
- File naming: kebab-case (e.g., `inventory-check.ts`)
- Use Zod for request validation schemas
- All monetary values stored as integers (cents/centavos) — never floats
- Dates stored as UTC, converted to local timezone only on the API response layer
- Use decimal.js for all arithmetic involving costs, quantities, and conversions — never native JS floats

## Architecture
- `src/modules/<module>/` — each module has: routes.ts, controller.ts, service.ts, schema.ts
- Business logic lives in service.ts, never in controllers
- Controllers only handle HTTP request/response
- All database queries go through Prisma, never raw SQL unless for complex aggregations
- Use transactions for any operation that modifies multiple tables
- Error handling: throw custom AppError classes, caught by global error middleware

## Database conventions
- Table names: snake_case, plural (e.g., `supplies`, `inventory_checks`)
- Column names: snake_case
- All tables have: id (UUID), created_at, updated_at
- Soft delete with deleted_at column where applicable
- Indexes on all foreign keys and frequently queried columns

## API conventions
- RESTful endpoints: /api/v1/<resource>
- Response format: { success: boolean, data?: T, error?: { message, code } }
- Pagination: cursor-based with ?cursor=&limit= (default 20, max 100)
- All list endpoints support filtering and sorting
- HTTP status codes: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 404 Not Found, 422 Validation Error, 500 Internal

## Testing
- Every service function needs unit tests
- Every API endpoint needs integration tests
- Use factory functions for test data, never hardcode
- Test database uses a separate schema, reset between test suites

## IMPORTANT
- YOU MUST read @SPEC.md before implementing any feature — it contains the full business logic specification
- Never use floating point for money or quantity calculations
- Always wrap multi-table writes in Prisma transactions
- Always validate request input with Zod schemas before processing
- When implementing inventory operations (supplies, transfers, sales deductions), always update stock AND log the movement in a single transaction
