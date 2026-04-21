# Modules

Each module follows the convention:

```
<module>/
  routes.ts       — express router, mounts validation + auth, delegates to controller
  controller.ts   — HTTP request/response only; calls service
  service.ts      — business logic; all DB access via Prisma
  schema.ts       — Zod schemas for request validation
```

Business logic **must** live in `service.ts`. Controllers only translate HTTP.
Multi-table writes **must** be wrapped in a Prisma transaction.

Modules are implemented per the phases in `/SPEC.md`. This scaffold is empty
by design — Phase 1 delivers the foundation only.
