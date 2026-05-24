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

## Known gaps / not implemented yet

- **No UI for `TABLE_UPDATE` / `TABLE_DELETE` suggestions** — cashier can only suggest a *new* table today; edit/delete go through directly when permitted, otherwise are blocked.
- **No UI for product suggestions** — the terminal doesn't expose product CRUD. Live in the admin web.
- **MANAGER ≠ admin** — managers do not currently approve suggestions, create tables, or delete tables. If this is wrong, change `LAYOUT_ADMINS` in `tables/routes.ts` and `SUGGEST_REVIEWERS` in `suggestions/routes.ts`, and `ROLES_LAYOUT_CREATE` / `isAdmin` checks on the frontend.
