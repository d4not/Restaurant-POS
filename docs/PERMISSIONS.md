# Permissions & Test Credentials

> Snapshot of the role model and test users as of the current branch. Update this file whenever a role gate changes.

---

## Test credentials (seed data)

Run `npx prisma db seed` if these don't work — the dev DB hasn't been seeded yet.

### POS Terminal (PIN login)

| Role     | Name              | Email               | PIN  |
| -------- | ----------------- | ------------------- | ---- |
| ADMIN    | Cafe Admin        | admin@pos.local     | 1234 |
| MANAGER  | Lucia Ramirez     | lucia@pos.local     | 2003 |
| CASHIER  | Carlos Mendoza    | carlos@pos.local    | 2002 |
| BARISTA  | Sofia Hernandez   | sofia@pos.local     | 2001 |
| WAITER   | Andrea Valdez     | andrea@pos.local    | 2004 |

### Admin web (`localhost:5174`, email + password)

| Role  | Email           | Password   |
| ----- | --------------- | ---------- |
| ADMIN | admin@pos.local | `admin123` |

The other seed users share `barista123` as their password hash, but only the ADMIN account is intended for admin-web login.

---

## Role hierarchy

```
WAITER ≈ BARISTA  <  CASHIER  ≈  MANAGER  <  ADMIN
```

- **WAITER** and **BARISTA** — front-of-house / bar staff. Identical permission set: take tickets, send to kitchen, cancel/edit lines they haven't sent yet, request cashier authorization for sent lines. No money handling, no shift control, no history access.
- **CASHIER** — handles money: opens/closes shift, processes payment, applies discounts, authorizes a waiter's/barista's destructive action with their PIN.
- **MANAGER** — same POS powers as CASHIER (can open shifts, take payments, etc.). No extra admin powers in the terminal — they cannot approve suggestions or delete tables.
- **ADMIN** — full control: creates/deletes tables, approves/rejects suggestions, manages everything in the admin panel.

> Every UI gate is paired with a backend route gate. Editing the frontend in DevTools won't bypass the rules — the API will still reject.

---

## Orders — core actions

| Action                                              | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
| --------------------------------------------------- | ------ | ------- | ------- | ------- | ----- |
| View active orders                                  | ✅     | ✅      | ✅      | ✅      | ✅    |
| Create order / open table                           | ✅     | ✅      | ✅      | ✅      | ✅    |
| Add items                                           | ✅     | ✅      | ✅      | ✅      | ✅    |
| Edit/remove an **unsent** item                      | ✅     | ✅      | ✅      | ✅      | ✅    |
| Edit/remove an **already-sent** item                | 🔒¹    | 🔒¹     | 🔒¹     | 🔒¹     | 🔒¹   |
| Send to Kitchen                                     | ✅     | ✅      | ✅      | ✅      | ✅    |
| Print ticket (receipt)                              | ✅     | ✅      | ✅      | ✅      | ✅    |
| Cancel order **without** sent items                 | ✅     | ✅      | ✅      | ✅      | ✅    |
| Cancel order **with** sent items                    | 🔒¹+✏ | 🔒¹+✏  | 🔒¹+✏  | 🔒¹+✏  | 🔒¹+✏|
| Apply discount                                      | ❌     | ❌      | ✅      | ✅      | ✅    |
| Process payment / settle                            | ❌     | ❌      | ✅      | ✅      | ✅    |
| Flag attention (waiter→cashier)                     | ✅     | ✅      | ✅      | ✅      | ✅    |
| Clear attention                                     | ❌     | ❌      | ✅      | ✅      | ✅    |

¹ Backend requires the PIN of **any active** `CASHIER`/`MANAGER`/`ADMIN`. The waiter→cashier handoff is built in: a cashier walks over and types their PIN to authorize.
✏ Plus a written reason ≥ 5 characters (recorded in `cancel_reason`).

---

## Cash register / shift

The terminal runs in a **singleton-shift** model: at most one register is OPEN at any time, and *every* user's orders attach to it. After PIN login, if no shift is open the entire UI is gated behind a "No shift open" screen — only a cashier+ can open one.

| Action                                       | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
| -------------------------------------------- | ------ | ------- | ------- | ------- | ----- |
| Operations pill visible in topbar            | ✅     | ✅      | ✅      | ✅      | ✅    |
| Open shift (counts opening cash)             | ❌     | ❌      | ✅      | ✅      | ✅    |
| Close shift (counts cash, records diff)      | ❌     | ❌      | ✅      | ✅      | ✅    |
| End the day (closes DailyReport)             | ❌     | ❌      | ❌      | ✅      | ✅    |
| Cash in / cash out movements                 | ❌     | ❌      | ✅      | ✅      | ✅    |
| Add expense / income card visible in hub     | ❌     | ❌      | ✅      | ✅      | ✅    |
| Daily report card visible in hub             | ❌     | ❌      | ✅      | ✅      | ✅    |
| Transfer supplies card visible in hub        | ✅     | ✅      | ✅      | ✅      | ✅    |
| Printer check card visible in hub            | ✅     | ✅      | ✅      | ✅      | ✅    |

The pill itself never shows money — only "Shift open" / "Open shift". The amount is only visible inside the management modal.

---

## Floor plan / tables

| Action                                       | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
| -------------------------------------------- | ------ | ------- | ------- | ------- | ----- |
| View floor plan                              | ✅     | ✅      | ✅      | ✅      | ✅    |
| Tap available table → open order             | ✅     | ✅      | ✅      | ✅      | ✅    |
| "Edit Layout" button visible                 | ❌     | ❌      | ✅      | ✅      | ✅    |
| Move / resize / rotate / relabel a table     | ❌     | ❌      | ✅      | ✅      | ✅    |
| Toggle shape (rect / circle)                 | ❌     | ❌      | ✅      | ✅      | ✅    |
| Create a new table                           | ❌     | ❌      | 📝      | 📝      | ✅    |
| Delete a table                               | ❌     | ❌      | ❌      | ❌      | ✅    |
| Mark table reserved/available                | ✅     | ✅      | ✅      | ✅      | ✅    |

📝 Cashier/manager submits a `TABLE_CREATE` suggestion to the admin queue; admin approves or rejects.

Tap-to-open is direct: no popover/confirmation step. Wrong-table presses are reverted by cancelling the empty order.

---

## Admin Mode (in-terminal back office)

The Launchpad-style surface at `terminal/src/components/adminMode/` — reports, inventory, employees, payroll, etc. Separate from the cashier's Operations Hub.

| Action                                       | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
| -------------------------------------------- | ------ | ------- | ------- | ------- | ----- |
| Mode picker after PIN login                  | ❌     | ❌      | ❌      | ✅      | ✅    |
| ⌘⇧A / Ctrl+Shift+A shortcut from POS         | ❌     | ❌      | ❌      | ✅      | ✅    |
| "Admin Mode" entry in hamburger drawer       | ❌     | ❌      | ❌      | ✅      | ✅    |
| "Enter Admin Mode" on no-shift screen        | ❌     | ❌      | ❌      | ✅      | ✅    |

Cashiers run their day-to-day management from the Operations Hub (shift open/close, cash in/out, daily report, expense card, transfer, printer check). They do not enter Admin Mode.

---

## Order history

| Action                                       | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
| -------------------------------------------- | ------ | ------- | ------- | ------- | ----- |
| Tab visible in topbar                        | ❌     | ❌      | ✅      | ✅      | ✅    |
| Actually enter the screen                    | ❌     | ❌      | 🔒²     | 🔒²     | 🔒²   |

² First click each session prompts for the user's own PIN (`verify-pin?mode=self`). Sticky for the session; cleared on **Lock Screen** or **Sign Out**.

---

## Settings modal

| Section                          | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
| -------------------------------- | ------ | ------- | ------- | ------- | ----- |
| General (incl. **Clear cache**)  | ✅     | ✅      | ✅      | ✅      | ✅    |
| Appearance                       | ✅     | ✅      | ✅      | ✅      | ✅    |
| Printers                         | ✅     | ✅      | ✅      | ✅      | ✅    |
| **Suggested Changes** (review)   | ❌     | ❌      | ❌      | ❌      | ✅    |
| Users (placeholder)              | —      | —       | —       | —       | —     |
| Register (placeholder)           | —      | —       | —       | —       | —     |

**Clear cache & reload** (General section) — drops all TanStack Query caches and reloads the renderer. Use after admin makes changes (new product, price update, etc.) to skip the 5-minute menu cache. In-progress orders live on the server and are unaffected.

---

## Suggestion approval queue

Backend module: `src/modules/suggestions`. Storage: `suggestions` table. Payloads validated against the corresponding resource's Zod schema both at submit time and again at approve time (in case data rotted between).

| Endpoint                                       | Required role             |
| ---------------------------------------------- | ------------------------- |
| `POST /api/v1/suggestions`                     | CASHIER, MANAGER, ADMIN   |
| `GET  /api/v1/suggestions[?status=&type=]`     | ADMIN                     |
| `GET  /api/v1/suggestions/:id`                 | ADMIN                     |
| `POST /api/v1/suggestions/:id/approve`         | ADMIN                     |
| `POST /api/v1/suggestions/:id/reject`          | ADMIN                     |

Supported types:

- `TABLE_CREATE` (wired in FloorPlan today)
- `TABLE_UPDATE` (backend ready, no UI yet)
- `TABLE_DELETE` (backend ready, no UI yet)
- `PRODUCT_CREATE` / `PRODUCT_UPDATE` / `PRODUCT_DELETE` (backend ready, no UI yet — admin panel is the natural home)

Approval applies the change by re-calling the matching resource service (`tables.createTable`, `products.updateProduct`, etc.), so domain rules (zone existence, unique numbers, etc.) are enforced exactly as they would be on a direct admin call.

---

## PIN step-up endpoint

`POST /api/v1/auth/verify-pin` — does **not** issue a new JWT. Used to gate destructive UI screens or authorize a waiter's action.

| Mode       | What it checks                                                                                  | Used for                              |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| `self`     | PIN matches the JWT user **and** that user has cashier+ role                                    | Order History gate                    |
| `cashier`  | PIN matches **any active** `CASHIER`/`MANAGER`/`ADMIN`                                          | Generic helper (no current consumer)  |

Within the orders service, the same logic is implemented inline as `authorizeCashierPin` (matches any active cashier+) and powers the sent-item gate and the cancel-with-sent-items gate.

Returns the matching user (`approver`) so audit fields can record who said yes (e.g. `Order.cancelled_by_user_id`).

---

## Audit fields populated by these flows

| Field                            | Set when                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| `Order.cancel_reason`            | Cancel order (always when text is provided)                    |
| `Order.cancelled_by_user_id`     | Cancel order — points at the approving cashier+ when sent items existed; otherwise the JWT user |
| `Order.cancelled_at`             | Cancel order                                                   |
| `Suggestion.created_by`          | Cashier submits a suggestion                                   |
| `Suggestion.reviewed_by`         | Admin approve/reject                                           |
| `Suggestion.review_note`         | Admin's optional note                                          |
| `Suggestion.reviewed_at`         | Admin approve/reject                                           |

---

## Purchase orders

Two flows over the same `Purchase` entity:

- **`kind=DELIVERY`** — remote supplier reachable by WhatsApp/courier. Statuses progress `DRAFT → SENT_TO_SUPPLIER → SUPPLIER_REPLIED → PAID → IN_TRANSIT → ARRIVED → VERIFIED`. Stock is absorbed only on `/verify`.
- **`kind=ERRAND`** — employee walks to a local store with drawer cash. Statuses progress `DRAFT → DISPATCHED → RETURNED → VERIFIED`. Dispatch posts a `CashMovement(CASH_OUT)` against the open shift; return posts a `CashMovement(CASH_IN)` for the change. Stock is absorbed on `/verify`.

`/verify` is the **only** stock-mutating transition — it is the manager+ gate. Everything else is cashier-and-up. The legacy `POST /:id/confirm` endpoint stays as an alias of `/verify` (received = ordered) for old admin callers.

| Action                                       | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
| -------------------------------------------- | ------ | ------- | ------- | ------- | ----- |
| View list / detail                           | ✅     | ✅      | ✅      | ✅      | ✅    |
| Create draft (`POST /`)                      | ❌     | ❌      | ✅      | ✅      | ✅    |
| Edit header / items while DRAFT              | ❌     | ❌      | ✅      | ✅      | ✅    |
| `/send` (open WhatsApp)                      | ❌     | ❌      | ✅      | ✅      | ✅    |
| `/reply` `/pay` `/in-transit` `/receive`     | ❌     | ❌      | ✅      | ✅      | ✅    |
| `/dispatch` (errand → requires open shift)   | ❌     | ❌      | ✅      | ✅      | ✅    |
| `/return` (errand)                           | ❌     | ❌      | ✅      | ✅      | ✅    |
| `/cancel` / `/reject`                        | ❌     | ❌      | ✅      | ✅      | ✅    |
| `/verify` (absorbs stock + WAC)              | ❌     | ❌      | ❌      | ✅      | ✅    |
| `/confirm` (legacy alias of `/verify`)       | ❌     | ❌      | ❌      | ✅      | ✅    |

Cashier-facing entry points:
- Operations Hub → **Hacer mandado** card (errand wizard: list active → new → return).
- Admin → `/inventory/purchases` (full lifecycle with WhatsApp preview, Reply/Pay/Receive/Verify modals, status timeline).

Backend route gates live in `src/modules/purchases/routes.ts` (`requireRole(CASHIER, MANAGER, ADMIN)` and `requireRole(MANAGER, ADMIN)` for verify/confirm). Frontend pre-checks hide CTAs the operator can't act on, but every route is also enforced server-side.

---

## People module (employees, schedule, attendance, payroll, tips)

The People domain centralises everything related to staff: profiles + roles, recurring weekly schedules, day-by-day attendance, weekly payroll with itemized bonuses/deductions, and a weekly tip pool. UI lives at `/people/*` in the admin web; the terminal exposes manager-quick-access tiles (Quick Absence, Schedule view, Tips adjust).

### Backend route gates

Reads are open to any authenticated user — the terminal needs to pre-fill pickers and render read-only schedule/employee data. Writes are MANAGER+ across the board because they touch money or audit fields. The cashier still routes through reads + the order/payment flow for tip capture.

| Endpoint                                                  | Required role             |
| --------------------------------------------------------- | ------------------------- |
| `GET    /api/v1/employees[/:id]`                          | any authenticated         |
| `POST   /api/v1/employees`                                | MANAGER, ADMIN            |
| `PATCH  /api/v1/employees/:id`                            | MANAGER, ADMIN            |
| `DELETE /api/v1/employees/:id` (soft / active=false)      | MANAGER, ADMIN            |
| `GET    /api/v1/attendance`                               | any authenticated         |
| `POST   /api/v1/attendance` (upsert per user+date)        | MANAGER, ADMIN            |
| `PATCH  /api/v1/attendance/:id`                           | MANAGER, ADMIN            |
| `DELETE /api/v1/attendance/:id`                           | MANAGER, ADMIN            |
| `GET    /api/v1/schedule` (roster)                        | any authenticated         |
| `GET    /api/v1/schedule/users/:userId`                   | any authenticated         |
| `PUT    /api/v1/schedule/users/:userId` (replace week)    | MANAGER, ADMIN            |
| `PATCH  /api/v1/schedule/users/:userId/days/:dow`         | MANAGER, ADMIN            |
| `DELETE /api/v1/schedule/users/:userId/days/:dow`         | MANAGER, ADMIN            |
| `GET    /api/v1/payroll[/:id]`                            | any authenticated         |
| `POST   /api/v1/payroll/generate`                         | MANAGER, ADMIN            |
| `PATCH  /api/v1/payroll/:id` (status / notes)             | MANAGER, ADMIN            |
| `POST   /api/v1/payroll/:id/adjustments`                  | MANAGER, ADMIN            |
| `DELETE /api/v1/payroll/:id/adjustments/:adjId`           | MANAGER, ADMIN            |
| `GET    /api/v1/tips/pools[?status=&from=&to=]`           | MANAGER, ADMIN            |
| `GET    /api/v1/tips/pools/current[?date=]` (lazy create) | MANAGER, ADMIN            |
| `GET    /api/v1/tips/pools/:id`                           | MANAGER, ADMIN            |
| `POST   /api/v1/tips/pools/:id/refresh`                   | MANAGER, ADMIN            |
| `PATCH  /api/v1/tips/pools/:id/allocations/:userId`       | MANAGER, ADMIN            |
| `POST   /api/v1/tips/pools/:id/close`                     | MANAGER, ADMIN            |
| `POST   /api/v1/tips/pools/:id/reopen`                    | MANAGER, ADMIN            |

### Payroll lifecycle

- `DRAFT → APPROVED → PAID`. No reverts, no skips (would 409).
- Adjustments (BONUS/DEDUCTION) can only be added/removed while DRAFT. The TIPS-sourced adjustment row created by `POST /tips/pools/:id/close` is pinned read-only — to undo it, reopen the pool (which also refuses if any downstream payroll is no longer DRAFT).
- `days_expected` is derived from the count of active schedule slots; falls back to the input value (default 6) only when the employee has no schedule yet.
- Legacy `bonuses` / `deductions` columns on `payroll_periods` are mirrors maintained server-side (`deductions = absence_deductions + adjustment_deductions`, `bonuses = adjustment_bonuses + tips_amount`) so existing API consumers still see the same shape.

### Tip flow — frasco-aparte model

- `POST /api/v1/orders/:id/payments` accepts optional `tip_amount` (centavos). For CASH the `amount` is the gross customer tender (sale + tip); the cashier physically separates the tip cash into the tip jar — it never enters the drawer. For CARD/TRANSFER the bank charges the full `amount`; tip is owed to the jar. PAYROLL_DEDUCT rejects any non-zero tip.
- `CashRegister.expected_amount` excludes tip; `CashRegister.tips_collected` is informational (recomputed authoritatively at close).
- `ShiftReport.tips_collected` snapshotted at close. `cash_sales` is order-side only (no tip double-counting).
- Tip pool aggregates `payment.tip_amount` across all methods in the `[week_start, week_end+1day)` window. Manager toggles per-user inclusion + override amount; close distributes `final_amount` as a TIPS-sourced PayrollAdjustment(BONUS) on each included user's DRAFT PayrollPeriod.

### Terminal Admin Mode — People section tiles

| Tile             | Section / Slot | Roles allowed     | What it opens                                                   |
| ---------------- | -------------- | ----------------- | --------------------------------------------------------------- |
| Employees        | people / 1     | MANAGER, ADMIN    | List view (existing)                                            |
| Attendance       | people / 2     | MANAGER, ADMIN    | Weekly cycle-click grid (existing)                              |
| Quick Absence    | people / 3     | MANAGER, ADMIN    | Single-employee form: pick + date + status + reason + paid      |
| Schedule (read)  | people / 4     | MANAGER, ADMIN    | Read-only roster grid — edits live on admin web                 |
| Payroll          | people / 5     | MANAGER, ADMIN    | Full payroll view (existing — renumbered from 3)                |
| Tips             | people / 6     | MANAGER, ADMIN    | Current pool + allocation table + Close & distribute / Reopen   |

### Cashier payment UI (terminal)

The `/cobro` modal (TableDetail) now has a tip sub-panel between the method selector and the amount input. Quick chips `10% · 15% · 20% · Custom · Clear`. Hidden for `PAYROLL_DEDUCT`; disabled in split mode with helper "Tip will be attached to the final payment". The submit payload sends `tip_amount` alongside `amount`; the cashier types the gross tender for CASH while CARD/TRANSFER amount = remaining + tip auto-bumped.

### Audit fields (People module)

| Field                                  | Set when                                              |
| -------------------------------------- | ----------------------------------------------------- |
| `Attendance.recorded_by`               | Anyone logs an attendance record (the JWT user)       |
| `PayrollPeriod.approved_by`            | DRAFT → APPROVED transition                           |
| `PayrollAdjustment.created_by_user_id` | Manager adds an adjustment OR pool close creates TIPS |
| `PayrollAdjustment.source_kind`        | `'MANUAL'` for hand-entered; `'TIPS'` for pool-close  |
| `PayrollAdjustment.source_id`          | TipAllocation id when `source_kind='TIPS'`            |
| `TipPool.closed_by_user_id`            | Pool close                                            |
| `TipAllocation.override_amount`        | Manager sets an explicit per-user amount              |
| `TipAllocation.note`                   | Manager attaches an explanatory note                  |
| `Payment.tip_amount`                   | Cashier records a tip on the payment                  |
| `CashRegister.tips_collected`          | Maintained incrementally on payment, snapshot at close|
| `ShiftReport.tips_collected`           | Snapshot from CashRegister at register close          |

---

## Known gaps / not implemented yet

- **No UI for `TABLE_UPDATE` / `TABLE_DELETE` suggestions** — cashier can only suggest a *new* table today; edit/delete go through directly when permitted, otherwise are blocked.
- **No UI for product suggestions** — the terminal doesn't expose product CRUD. Live in the admin web.
- **MANAGER ≠ admin** — managers do not currently approve suggestions, create tables, or delete tables. If this is wrong, change `LAYOUT_ADMINS` in `tables/routes.ts` and `SUGGEST_REVIEWERS` in `suggestions/routes.ts`, and `ROLES_LAYOUT_CREATE` / `isAdmin` checks on the frontend.
- **`days_expected` fallback to 6** still in place for employees without a schedule. Phase 6 polish step: remove the fallback once every active employee has a schedule, then surface a "Configure schedule" CTA on the payroll generate path.
- **Legacy `payroll_periods.bonuses` / `deductions` columns** are still readable as mirrors. Deprecation candidate once all clients have switched to the decomposed columns (`absence_deductions`, `adjustment_bonuses`, `adjustment_deductions`, `tips_amount`).
