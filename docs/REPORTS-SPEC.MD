# Reports, Provisional Shifts, Alerts & Blind Close — Feature Specification

> **Scope**: Backend-only (Express API + Prisma migration). No frontend changes except
> the blind-close UX tweak in Phase 6 and the admin print page in Phase 5.
>
> **Parent docs**: This extends `docs/SPEC.md` Phase 7 (Orders, Payments & Cash Register).
> Read `CLAUDE.md` for project conventions before implementing.

---

## 1. Overview

This feature adds four capabilities to the POS:

1. **Provisional shifts** — any authenticated employee can open a temporary cash register
   session when the regular cashier is absent. Restricted to payment-only operations,
   verified by a manager afterwards.

2. **Shift reports (ShiftReport)** — an immutable snapshot generated automatically when
   ANY shift closes (regular or provisional). Captures sales, payments, cash reconciliation,
   and top products for that shift.

3. **Daily reports (DailyReport)** — a consolidated end-of-day report that aggregates all
   ShiftReports. Manually closed by ADMIN/MANAGER. Printable from the admin panel only.

4. **Alert system** — automatic detection of suspicious patterns (cash shortages, excessive
   voids, unverified provisionals, etc.) generated at shift close and day close.

5. **Blind close** — the terminal hides `expected_amount` until after the cashier submits
   their physical count. Backend unchanged; frontend-only change.

---

## 2. Prisma Schema Changes

### 2.1 New Enums

```prisma
enum ShiftType {
  REGULAR
  PROVISIONAL
}

enum DailyReportStatus {
  OPEN
  CLOSED
}

enum AlertType {
  CASH_SHORTAGE
  CASH_SURPLUS
  RECURRING_SHORTAGE
  EXCESSIVE_VOIDS
  EXCESSIVE_DISCOUNTS
  UNVERIFIED_PROVISIONAL
  LATE_VOID
}

enum AlertSeverity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}
```

### 2.2 CashRegister — new columns

Add to the existing `cash_registers` table. All new columns are nullable or have defaults
so existing rows are unaffected.

```prisma
model CashRegister {
  // ... all existing fields unchanged ...

  // NEW: shift type and provisional hierarchy
  type                  ShiftType @default(REGULAR)
  parent_shift_id       String?   @db.Uuid
  parent_shift          CashRegister?  @relation("ShiftHierarchy", fields: [parent_shift_id], references: [id])
  child_shifts          CashRegister[] @relation("ShiftHierarchy")

  // NEW: provisional verification
  requires_verification Boolean  @default(false)
  verified_by_id        String?  @db.Uuid
  verified_by           User?    @relation("ShiftVerifier", fields: [verified_by_id], references: [id])
  verified_at           DateTime?
  verification_notes    String?

  // NEW: link to generated report
  shift_report          ShiftReport?

  // NEW: link to daily report
  daily_report_id       String?  @db.Uuid
  daily_report          DailyReport? @relation(fields: [daily_report_id], references: [id])
}
```

**Migration notes:**
- `type` defaults to `REGULAR` — existing rows are automatically regular shifts.
- `parent_shift_id` is nullable — only provisionals reference a parent.
- Add index on `parent_shift_id` and `type`.
- Add User relation `shifts_verified` for `verified_by_id`.

### 2.3 ShiftReport — new model

Immutable snapshot. Created once at shift close, never updated.

```prisma
model ShiftReport {
  id                String    @id @default(uuid()) @db.Uuid

  // Link to the shift (1:1)
  cash_register_id  String    @unique @db.Uuid
  cash_register     CashRegister @relation(fields: [cash_register_id], references: [id])

  // Denormalized snapshot — survives user role changes
  user_id           String    @db.Uuid
  user_name         String
  user_role         String
  shift_type        ShiftType
  opened_at         DateTime
  closed_at         DateTime

  // Sales totals (centavos)
  gross_sales       Int       @default(0)   // Decimal(14,0)
  discounts         Int       @default(0)
  void_total        Int       @default(0)
  void_count        Int       @default(0)
  net_sales         Int       @default(0)
  tax_collected     Int       @default(0)

  // Tickets
  total_tickets     Int       @default(0)
  avg_ticket        Int       @default(0)

  // Payment breakdown (centavos)
  cash_sales        Int       @default(0)
  card_sales        Int       @default(0)
  transfer_sales    Int       @default(0)

  // Cash reconciliation (centavos)
  opening_amount    Int       @default(0)
  cash_in           Int       @default(0)
  cash_out          Int       @default(0)
  expected_cash     Int       @default(0)
  actual_cash       Int?
  cash_variance     Int?

  // JSON snapshots
  sales_by_category Json      @default("[]")  // [{category_id, category_name, item_count, total}]
  top_products      Json      @default("[]")  // [{product_id, product_name, quantity, total}]

  // Verification (only for provisionals)
  verified_by_id    String?   @db.Uuid
  verified_by_name  String?
  verified_at       DateTime?

  // Relations
  alerts            Alert[]

  created_at        DateTime  @default(now())

  @@index([user_id])
  @@index([created_at])
  @@map("shift_reports")
}
```

**Business rules:**
- Created inside the same transaction as `closeRegister()`.
- Never updated or deleted via API — no PATCH/DELETE endpoints.
- All monetary values in centavos as integers (matches existing convention).
- `sales_by_category` and `top_products` are JSON because their shape is report-specific
  and not queried relationally.

### 2.4 DailyReport — new model

```prisma
model DailyReport {
  id                  String            @id @default(uuid()) @db.Uuid
  date                DateTime          @unique @db.Date  // one per calendar day
  folio               Int               @default(autoincrement())
  status              DailyReportStatus @default(OPEN)

  // Consolidated sales (centavos)
  gross_sales         Int       @default(0)
  discounts           Int       @default(0)
  void_total          Int       @default(0)
  void_count          Int       @default(0)
  net_sales           Int       @default(0)
  tax_collected       Int       @default(0)

  // Consolidated tickets
  total_tickets       Int       @default(0)
  avg_ticket          Int       @default(0)

  // Consolidated payments (centavos)
  cash_sales          Int       @default(0)
  card_sales          Int       @default(0)
  transfer_sales      Int       @default(0)

  // Consolidated cash
  total_opening_amount Int      @default(0)
  total_cash_in       Int       @default(0)
  total_cash_out      Int       @default(0)
  total_expected_cash Int       @default(0)
  total_actual_cash   Int?
  total_cash_variance Int?

  // Denomination breakdown — filled by the manager at close time.
  // JSON object: keys are denomination values in centavos (as strings),
  // values are the count of each bill/coin.
  // Example MXN: {"100000":1, "50000":2, "20000":4, "10000":3, "500":5}
  //   → 1×$1000 + 2×$500 + 4×$200 + 3×$100 + 5×$5 coins
  // Example USD: {"10000":1, "2000":3, "100":5}
  //   → 1×$100 + 3×$20 + 5×$1
  // The sum of (denomination × count) must equal total_actual_cash.
  denomination_breakdown Json?

  // Snapshot of currency and language at close time so the printed report
  // renders correctly even if settings change later.
  currency            String    @default("MXN")  // "MXN" | "USD"
  language            String    @default("es")   // "es" | "en"

  // JSON snapshots
  sales_by_category   Json      @default("[]")
  top_products        Json      @default("[]")  // [{product_id, product_name, quantity, total}] top 10
  sales_by_hour       Json      @default("[]")  // [{hour, tickets, total}]

  // Shift summary
  total_shifts        Int       @default(0)
  provisional_shifts  Int       @default(0)
  unverified_provisionals Int   @default(0)

  // Metrics
  peak_hour           Int?
  slowest_hour        Int?

  // Relations
  shifts              CashRegister[]
  alerts              Alert[]

  // Close — entered by the manager at close time
  closed_by_id        String?   @db.Uuid
  closed_by           User?     @relation(fields: [closed_by_id], references: [id])
  closed_at           DateTime?
  notes               String?   // operational notes: "Busy lunch, Andrea covered"
  resolution          String?   // final verdict: "Corte cuadrado" / "Faltante $30, se descontará"

  created_at          DateTime  @default(now())
  updated_at          DateTime  @updatedAt

  @@index([date])
  @@index([status])
  @@map("daily_reports")
}
```

**Business rules:**
- One per calendar day (`date` is unique, DATE type, midnight UTC).
- `folio` auto-increments globally (Z-0001, Z-0002...). The frontend prefixes "Z-".
- Status transitions: `OPEN → CLOSED`. No revert.
- Cannot close if any shift for that day is still OPEN.
- `closed_by_id` must be ADMIN or MANAGER.
- `denomination_breakdown` is optional — the manager can skip it and just enter total_actual_cash.
  When provided, the sum of (denomination × count) is validated against total_actual_cash.
- `currency` and `language` are snapshotted from settings at close time so the printed report
  stays consistent even if the operator changes settings later.
- `resolution` is the final sign-off. Separate from `notes` because notes are operational
  context ("busy day") while resolution is the cash verdict ("cuadra" / "faltante resuelto").

### 2.5 Alert — new model

```prisma
model Alert {
  id              String        @id @default(uuid()) @db.Uuid
  type            AlertType
  severity        AlertSeverity
  message         String        // human-readable, e.g. "Faltante de $30.00 en turno de Carlos"
                                // ALL monetary values in messages MUST be formatted as currency
                                // (e.g. "$30.00"), never raw centavos. Use formatMoney() from
                                // print/formatter.ts before storing.
  data            Json          @default("{}")  // context-specific payload

  // Context
  user_id         String?       @db.Uuid
  user            User?         @relation(fields: [user_id], references: [id])

  // Source
  shift_report_id String?       @db.Uuid
  shift_report    ShiftReport?  @relation(fields: [shift_report_id], references: [id])
  daily_report_id String?       @db.Uuid
  daily_report    DailyReport?  @relation(fields: [daily_report_id], references: [id])

  // Resolution
  resolved        Boolean       @default(false)
  resolved_by_id  String?       @db.Uuid
  resolved_at     DateTime?
  resolution      String?       // "Se recontó y cuadra"

  created_at      DateTime      @default(now())

  @@index([type, resolved])
  @@index([severity])
  @@index([user_id])
  @@index([shift_report_id])
  @@index([daily_report_id])
  @@map("alerts")
}
```

### 2.6 User model — new relations

Add to the existing User model:

```prisma
model User {
  // ... existing relations ...
  shifts_verified       CashRegister[]  @relation("ShiftVerifier")
  daily_reports_closed  DailyReport[]
  alerts                Alert[]
}
```

---

## 3. API Endpoints

### 3.1 Provisional Shifts

```
POST   /api/v1/registers/provisional
  Body: { parent_shift_id: uuid }
  Auth: ANY authenticated user (WAITER, BARISTA, CASHIER, MANAGER, ADMIN)
  Logic:
    - parent_shift must be OPEN and type=REGULAR
    - Creates a new CashRegister with:
        type: PROVISIONAL
        parent_shift_id: parent.id
        requires_verification: true
        opening_amount: 0 (inherits parent's drawer)
        user_id: current JWT user
    - Does NOT close/suspend the parent shift
  Returns: 201 + the new CashRegister

POST   /api/v1/registers/:id/verify
  Body: { notes?: string, pin: string }
  Auth: MANAGER, ADMIN (verified via PIN step-up)
  Logic:
    - Shift must be type=PROVISIONAL and status=CLOSED
    - PIN must match any active MANAGER/ADMIN
    - Sets verified_by_id, verified_at, verification_notes
    - Also updates the linked ShiftReport with verification info
  Returns: 200 + updated CashRegister

GET    /api/v1/registers/provisional/unverified
  Auth: MANAGER, ADMIN
  Returns: list of CLOSED provisional shifts without verified_at
```

**Provisional shift restrictions (enforced in existing endpoints):**
- `POST /registers/:id/close` — allowed (provisional can be closed)
- `POST /orders` — allowed IF the provisional shift is OPEN
- `PATCH /orders/:id` (discount) — BLOCKED for provisional operator
- `DELETE /orders/:id` (cancel with sent items) — BLOCKED
- `POST /registers/:id/cash-movements` — BLOCKED
- The order.register_id points to the PROVISIONAL register, not the parent

Implementation: add a check in each blocked endpoint's service layer:
```typescript
if (register.type === 'PROVISIONAL') {
  throw new ForbiddenError('Provisional shifts cannot perform this action');
}
```

### 3.2 Shift Reports

```
GET    /api/v1/shift-reports
  Query: ?from=&to=&user_id=&type=REGULAR|PROVISIONAL&cursor=&limit=
  Auth: MANAGER, ADMIN
  Returns: paginated list

GET    /api/v1/shift-reports/:id
  Auth: MANAGER, ADMIN, or the shift's own user
  Returns: full ShiftReport with alerts

GET    /api/v1/shift-reports/:id/print
  Auth: MANAGER, ADMIN, or the shift's own user
  Returns: self-contained HTML page formatted for window.print()
  Content-Type: text/html
  See §5.5 for the simplified layout (cash reconciliation + sales + top products)
```

No POST — ShiftReports are generated automatically by `closeRegister()`.

### 3.3 Daily Reports

```
POST   /api/v1/daily-reports/close
  Body: {
    actual_cash: number,                         // total cash counted (centavos)
    denomination_breakdown?: Record<string, number>,  // optional: {"50000": 2, "20000": 4}
    resolution?: string,                         // "Corte cuadrado" / "Faltante $30, se descontará"
    notes?: string                               // operational context
  }
  Auth: ADMIN, MANAGER
  Logic:
    - Finds or creates a DailyReport for today (status=OPEN)
    - Validates: no OPEN shifts exist for today
    - Aggregates all ShiftReports closed today
    - Sets total_actual_cash = actual_cash
    - Computes total_cash_variance = actual_cash - total_expected_cash
    - If denomination_breakdown provided:
        validate sum of (denomination × count) == actual_cash
        store as JSON
    - Snapshots currency and language from Settings at close time
    - Generates day-level alerts
    - Sets status=CLOSED, closed_by_id, closed_at, resolution, notes
  Returns: 200 + DailyReport

GET    /api/v1/daily-reports
  Query: ?from=&to=&status=OPEN|CLOSED&cursor=&limit=
  Auth: ADMIN, MANAGER
  Returns: paginated list

GET    /api/v1/daily-reports/:id
  Auth: ADMIN, MANAGER
  Returns: full DailyReport with nested ShiftReports and alerts

GET    /api/v1/daily-reports/:id/print
  Auth: ADMIN, MANAGER
  Returns: self-contained HTML page formatted for window.print()
  Content-Type: text/html
  Layout: see §5.2 — two-column, 1-page, B&W optimized
  Rules: suppress zero lines, cash first, format money as currency never centavos
```

### 3.4 Alerts

```
GET    /api/v1/alerts
  Query: ?type=&severity=&resolved=true|false&from=&to=&cursor=&limit=
  Auth: MANAGER, ADMIN

PATCH  /api/v1/alerts/:id/resolve
  Body: { resolution: string }
  Auth: MANAGER, ADMIN
  Logic: sets resolved=true, resolved_by_id, resolved_at, resolution
```

---

## 4. Business Logic

### 4.1 ShiftReport Generation (inside closeRegister transaction)

When `closeRegister()` runs (existing service), AFTER the existing close logic, add:

```
1. Query all PAID orders where register_id = this shift
2. Compute:
   - gross_sales = Σ order.total
   - discounts = Σ order.discount_amount
   - net_sales = gross_sales - discounts
   - tax_collected = Σ order.tax_amount
   - void_count = count of CANCELLED orders in this shift
   - void_total = Σ cancelled_order.total
3. Compute payment breakdown:
   - Group payments by method, sum amounts
   - cash_sales = Σ CASH payments (amount - change_amount)
   - card_sales = Σ CARD payments
   - transfer_sales = Σ TRANSFER payments
4. Cash reconciliation:
   - opening_amount = shift.opening_amount
   - cash_in = Σ CashMovement.CASH_IN on this register
   - cash_out = Σ CashMovement.CASH_OUT on this register
   - expected_cash = opening + cash_sales + cash_in - cash_out
   - actual_cash = input.actual_amount
   - cash_variance = actual - expected
5. Compute sales_by_category:
   - Group order_items by product.category_id
   - For each: { category_id, category_name, item_count, total }
6. Compute top_products:
   - Group order_items by product_id, sum quantity and line_total
   - Take top 10 by quantity
7. Create ShiftReport row with all computed values
8. Generate shift-level alerts (see §4.3)
```

### 4.2 DailyReport Generation (closeDailyReport)

```
1. Validate no OPEN shifts exist for today
2. Find all ShiftReports where closed_at is today (UTC date match)
3. Sum all numeric fields across ShiftReports
4. Merge sales_by_category across reports (sum by category_id)
5. Merge top_products across reports (sum by product_id, sum quantity and total, take top 10)
6. Compute sales_by_hour:
   - Query orders WHERE status=PAID AND order_date=today
   - Group by EXTRACT(hour FROM created_at)
   - For each hour: { hour, tickets: count, total: sum }
7. Set peak_hour = hour with max total, slowest_hour = hour with min total
8. Count provisional_shifts and unverified_provisionals
9. Create DailyReport, link all shifts via daily_report_id
10. Generate day-level alerts (see §4.3)
```

### 4.3 Alert Generation

**At shift close — generate these alerts:**

| Condition | AlertType | Severity |
|-----------|-----------|----------|
| `cash_variance < -threshold` (default: -2000 centavos) | CASH_SHORTAGE | `abs > 5000` → CRITICAL, else HIGH |
| `cash_variance > +threshold` (default: +2000) | CASH_SURPLUS | MEDIUM |
| `void_count > threshold` (default: 3) | EXCESSIVE_VOIDS | HIGH |
| `discounts / gross_sales > threshold` (default: 10%) | EXCESSIVE_DISCOUNTS | MEDIUM |
| Same user has cash shortage in last 3 consecutive shifts | RECURRING_SHORTAGE | CRITICAL |

**At day close — generate these alerts:**

| Condition | AlertType | Severity |
|-----------|-----------|----------|
| Any provisional shift still has `verified_at = null` | UNVERIFIED_PROVISIONAL | CRITICAL |

**Thresholds stored in Settings table:**

| Key | Default | Unit |
|-----|---------|------|
| `alert_cash_shortage_threshold` | `2000` | centavos |
| `alert_cash_surplus_threshold` | `2000` | centavos |
| `alert_max_voids_per_shift` | `3` | count |
| `alert_max_discount_pct` | `10` | percent |
| `alert_recurring_shortage_count` | `3` | count |
| `alert_recurring_shortage_min` | `500` | centavos (min variance to count) |

### 4.4 Currency Denominations

The close-day flow lets the manager count bills and coins by denomination.
Available denominations depend on the currency in settings. Defined in code as a
constant (not a DB table — denominations don't change at runtime):

```typescript
// src/lib/denominations.ts

export const DENOMINATIONS: Record<string, number[]> = {
  // Values in centavos, descending. Bills first, then coins.
  MXN: [
    100_000, // $1,000
     50_000, // $500
     20_000, // $200
     10_000, // $100
      5_000, // $50
      2_000, // $20
      1_000, // $10 coin
        500, // $5 coin
        200, // $2 coin
        100, // $1 coin
         50, // $0.50 coin
  ],
  USD: [
    10_000, // $100
     5_000, // $50
     2_000, // $20
     1_000, // $10
      500,  // $5
      100,  // $1
       25,  // quarter
       10,  // dime
        5,  // nickel
        1,  // penny
  ],
};

/** Returns denominations for the active currency, or MXN as fallback. */
export function getDenominations(currency: string): number[] {
  return DENOMINATIONS[currency] ?? DENOMINATIONS.MXN;
}
```

**Validation at close time:** If `denomination_breakdown` is provided, the service must:
1. Check every key is a valid denomination for the active currency
2. Check every value (count) is a non-negative integer
3. Verify: `Σ (denomination × count) === actual_cash`
4. If the sum doesn't match, throw `BadRequestError('Denomination total does not match counted cash')`

The denomination input is optional. A manager in a hurry can skip it and just enter the
total — the report prints without the breakdown table and still works.

### 4.5 Close Day Flow (Admin Panel)

The admin panel's "Close Day" page walks the manager through a checklist:

```
Step 1 — VERIFY CHECKLIST (read-only, auto-computed)
  ✓ All shifts closed (2 of 2)
  ✓ All orders settled
  ✗ 1 provisional shift unverified ← blocks close? No, but generates CRITICAL alert
  ⚠ 1 alert pending review

Step 2 — COUNT CASH
  Total cash in drawer: [____________] (numeric input, required)
  
  Denomination breakdown (optional, expand/collapse):
  ┌──────────┬───────┬──────────┐
  │ $1,000   │ [ 1 ] │ $1,000   │
  │ $500     │ [ 2 ] │ $1,000   │
  │ $200     │ [ 0 ] │ $0       │
  │ $100     │ [ 4 ] │ $400     │
  │ ...      │       │          │
  │ TOTAL    │       │ $1,560   │ ← auto-sums, must match input above
  └──────────┴───────┴──────────┘

Step 3 — RESOLUTION
  [textarea: "Corte cuadrado" / "Faltante de $30, se investigará"]

Step 4 — NOTES (optional)
  [textarea: "Día ocupado, Andrea cubrió turno de Carlos 2-6pm"]

Step 5 — CONFIRM & CLOSE
  [Button: "Cerrar día"]
  → POST /daily-reports/close with all fields
```

### 4.6 Blind Close (Frontend Only)

**Terminal desktop** (`terminal/src/`): In the close-shift UI flow, the component that
shows the cash count form must NOT display `expected_amount` until AFTER the user submits
their `actual_amount`. The sequence:

```
1. Show: "Count the cash in the drawer"
2. Input: numeric keypad for actual_amount
3. User taps "Submit count"
4. POST /api/v1/registers/:id/close { actual_amount }
5. Response includes expected_amount, actual_amount, difference
6. NOW show: "Expected: $X | Counted: $Y | Difference: $Z"
```

**Terminal mobile** (`terminal-mobile/`): Same change via the shared code in
`terminal/src/`. The platform abstraction layer handles any mobile-specific UI.

The backend `closeRegister()` is unchanged — it already accepts `actual_amount` and
computes everything server-side.

---

## 5. Print Format — Daily Report (Admin Panel)

### 5.1 Design principles

The printed report is a **verification checklist**. The owner prints it, hands it to
their parents along with the cash. The parents physically count the bills on the table,
check them against the denomination list on the paper, verify the payment totals, and
sign off. Design for:

- **Black and white** — no colors. Use weight (bold), borders, boxes, and whitespace.
- **1 page** — if it overflows, the parents won't flip. Tighten font or drop products.
- **Checklist format** — every verifiable line gets a `[ ]` checkbox that can be
  hand-checked with a pen. The parents check each row as they count.
- **Denomination breakdown first** — the physical bills and coins are right there on the
  table. This section is the #1 thing the parents verify. It goes at the very top.
- **Suppress zeroes** — if discounts, cash_in, or cash_out are zero, skip the line.
- **Render in the active language and currency** — the DailyReport snapshots `currency`
  and `language` at close time. The HTML template reads these and renders labels in
  Spanish or English, formats amounts in MXN or USD. If the operator switches language
  after closing, old reports still print in the language they were closed in.
- **No jargon** — labels like "Debe haber", "Faltante", "Sobrante" in Spanish;
  "Expected", "Shortage", "Surplus" in English.
- **Hide browser chrome** — `@media print` suppresses URL, headers, footers, buttons.

### 5.2 Layout structure

The report is a **single-page verification checklist**. Sections flow top to bottom.
Each verifiable line has a `[ ]` checkbox. The denomination breakdown (if filled) is
the largest section because it's what the parents physically verify against the bills
on the table.

```
┌───────────────────────────────────────────────────────────────┐
│  CAFE POS                               Corte Z-0001         │
│  Calle Principal #123                   27 de abril 2026     │
│                                                               │
│  ═══ EFECTIVO EN CAJA ════════════════════════════════════    │
│                                                               │
│  Billetes:                                                    │
│  [ ]  1  ×  $500 ...................... $500.00               │
│  [ ]  2  ×  $200 ...................... $400.00               │
│  [ ]  4  ×  $100 ...................... $400.00               │
│  [ ]  3  ×  $50 ....................... $150.00               │
│  [ ]  2  ×  $20 ....................... $40.00                │
│  Monedas:                                                     │
│  [ ]  5  ×  $10 ....................... $50.00                │
│  [ ]  4  ×  $5 ........................ $20.00                │
│                                          ────────────         │
│  [ ]  TOTAL CONTADO                    $1,560.00              │
│  [ ]  DEBE HABER                       $1,590.00              │
│                                          ────────────         │
│      DIFERENCIA                          -$30.00              │
│                                       ▲ FALTANTE              │
│                                                               │
│  ═══ VENTAS ══════════════════════════════════════════════    │
│                                                               │
│  [ ]  Venta bruta ..................... $1,705.00              │
│       Descuentos ....................... -$75.00               │
│  [ ]  Venta neta ..................... $1,630.00              │
│  [ ]  Impuesto ....................... $235.19                │
│       60 tickets · promedio $28.42                            │
│                                                               │
│  ═══ FORMAS DE PAGO ═════════════════════════════════════    │
│                                                               │
│  [ ]  Efectivo ....................... $1,065.00              │
│  [ ]  Tarjeta ........................ $490.00                │
│  [ ]  Transferencia .................. $150.00                │
│                                                               │
│  ═══ TURNOS ═════════════════════════════════════════════    │
│                                                               │
│  Carlos M.    09:00–17:00    $1,425    47 tickets             │
│    Contó $1,380 · Diferencia -$30.00 FALTANTE                 │
│  Andrea V.    14:00–18:00      $280    13 tickets             │
│    ↳ PROVISIONAL · SIN VERIFICAR                              │
│    Contó $180 · Diferencia $0.00 OK                           │
│                                                               │
│  ═══ PRODUCTOS ══════════════════════════════════════════    │
│                                                               │
│  Latte ............... 18 .... $720    │ Café caliente  34  $1,020│
│  Cappuccino ........... 9 .... $360   │ Café frío      11    $385│
│  Agua ................ 12 .... $300   │ Bebidas        12    $300│
│  Americano ............ 7 .... $245   │                          │
│  Mocha ................ 5 .... $210   │                          │
│                                                               │
│  ═══ ALERTAS ════════════════════════════════════════════    │
│                                                               │
│  ▪ Faltante $30.00 — turno de Carlos Mendoza                 │
│  ▪ 4 cancelaciones en turno de Carlos (límite: 3)             │
│  ▪ Turno provisional de Andrea Valdez sin verificar           │
│                                                               │
│  ═══ VERIFICACIÓN ═══════════════════════════════════════    │
│                                                               │
│  Resolución: Faltante de $30, se descontará a Carlos.         │
│  Notas: Día ocupado, Andrea cubrió turno durante entrega.     │
│                                                               │
│  Verificado: ________________  Firma: ________________        │
│                                                               │
│  Cerrado por: Cafe Admin · 27/04/2026 19:00                   │
└───────────────────────────────────────────────────────────────┘
```

**When denomination_breakdown is NOT provided** (manager skipped it), the "EFECTIVO EN
CAJA" section collapses to just the reconciliation formula:

```
│  ═══ EFECTIVO EN CAJA ════════════════════════════════════    │
│                                                               │
│  [ ]  Fondo inicial .................. $500.00                │
│       + Ventas efectivo .............. $1,065.00              │
│       + Ingresos ..................... $50.00                 │
│       - Gastos ....................... -$25.00                │
│                                        ────────────           │
│  [ ]  DEBE HABER                      $1,590.00              │
│  [ ]  SE CONTÓ                        $1,560.00              │
│                                        ────────────           │
│       DIFERENCIA                        -$30.00              │
│                                      ▲ FALTANTE              │
```

### 5.3 Section rules

All labels are i18n-aware — the spec shows both ES and EN labels. The template reads
`dailyReport.language` and picks the right set. Currency formatting uses
`dailyReport.currency` (MXN → "$1,234.50", USD → "$1,234.50" with the appropriate
symbol/grouping from Intl.NumberFormat).

**Header** — Business name (bold, 16pt) left. "Corte Z-{folio}" / "Daily Close Z-{folio}"
right, with date below. Business address in smaller text under the name. Skip address
line if empty.

**EFECTIVO EN CAJA / CASH IN DRAWER** — The denomination breakdown, when provided.

Each denomination row has: `[ ]  {count}  ×  {denomination} ........... {subtotal}`
Denominations with count=0 are suppressed. Group into "Billetes/Bills" and "Monedas/Coins"
(coins are denominations < the smallest bill: <$20 for MXN, <$1 for USD).

Below the list:
```
  [ ]  TOTAL CONTADO / COUNTED        {sum}       ← must match actual_cash
  [ ]  DEBE HABER / EXPECTED          {expected}
       ──────────────
       DIFERENCIA / DIFFERENCE        {variance}
                                   {status label}
```

Status label: negative → "▲ FALTANTE" / "▲ SHORTAGE" (bold).
Positive → "▼ SOBRANTE" / "▼ SURPLUS". Zero → "✓ CUADRADO" / "✓ OK".

When denomination_breakdown is null, this section shows the reconciliation formula
instead (opening + cash_sales + cash_in - cash_out = expected). Suppress cash_in/cash_out
lines if zero.

**VENTAS / SALES** — Each line is checkable:
```
  [ ]  Venta bruta / Gross sales ....... {gross}
       Descuentos / Discounts ........... -{discounts}    ← only if > 0
  [ ]  Venta neta / Net sales .......... {net}
  [ ]  Impuesto / Tax .................. {tax}
       {count} tickets · promedio/avg {avg}
```

**FORMAS DE PAGO / PAYMENT METHODS** — One checkable line per method with sales > 0:
```
  [ ]  Efectivo / Cash ................. {cash_sales}
  [ ]  Tarjeta / Card .................. {card_sales}
  [ ]  Transferencia / Transfer ........ {transfer_sales}
```

**TURNOS / SHIFTS** — Compact table, one block per shift:
```
  {name}    {open}–{close}    {gross_sales}    {tickets} tickets
    Contó/Counted {actual} · Diferencia/Diff {variance} {SHORT|OVER|OK}
```
Provisionals get a sub-line: `↳ PROVISIONAL · SIN VERIFICAR/UNVERIFIED`

**PRODUCTOS / PRODUCTS** — Two side-by-side lists: Top 5 (by qty) left, Categories right.
Compact, no checkboxes. Only categories with sales > 0.

**ALERTAS / ALERTS** — Only if alerts exist. Each alert on one line with `▪` prefix.
Resolved alerts append: `— Resuelto/Resolved: {resolution}`. No severity column.
Sort: unresolved first (by severity desc), then resolved.

**VERIFICACIÓN / VERIFICATION** — Always printed. Contains:
```
  Resolución/Resolution: {resolution text from close form}
  Notas/Notes: {notes text from close form}              ← only if provided

  Verificado/Verified by: ________________  Firma/Signature: ________________
```
The "Verificado" and "Firma" lines are **blank** — they're for the parents to fill in
by hand with a pen after they've checked everything. This is the sign-off.

**Footer** — "Cerrado por/Closed by {name} · {date} {time}"

### 5.4 CSS print rules

```css
@media print {
  .print-button, .no-print { display: none !important; }

  @page {
    margin: 10mm 8mm;
    size: letter portrait;
  }

  * {
    color: #000 !important;
    background: transparent !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }

  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 10pt;   /* 10pt to fit 1 page with denomination table */
    line-height: 1.3;
  }

  h1 { font-size: 14pt; margin: 0 0 4px; }
  h2 {
    font-size: 11pt;
    border-bottom: 2px solid #000;
    padding-bottom: 2px;
    margin: 8px 0 4px;
    letter-spacing: 1px;
  }

  .report-section { break-inside: avoid; }

  /* Denomination list: checkbox + count + × + denom + dots + subtotal */
  .denom-row {
    display: grid;
    grid-template-columns: 24px 40px 20px 80px 1fr 100px;
    align-items: baseline;
    font-size: 10pt;
    line-height: 1.6;
  }
  .denom-checkbox { font-family: monospace; }

  /* Two-column product/category layout */
  .products-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 24px;
  }

  /* Verification/resolution box */
  .verify-box {
    border: 2px solid #000;
    padding: 8px 12px;
    margin: 8px 0;
  }

  /* Blank signature lines for parents to sign */
  .sig-line {
    border-bottom: 1px solid #000;
    display: inline-block;
    width: 160px;
    margin: 0 8px;
  }

  /* Checklist checkboxes */
  .check-line {
    display: grid;
    grid-template-columns: 24px 1fr auto;
    align-items: baseline;
    line-height: 1.6;
  }
}
```

### 5.5 Shift Report print (mid-day handoff)

`GET /shift-reports/:id/print` — replaces the WhatsApp message the cashier sends
at shift change. Same B&W `@media print` treatment. Reads language and currency
from current settings (not snapshotted — shift reports are printed right after close).

Content (fits on half a page):

1. Header: business name, date, `"{user_name} — Turno {REGULAR|PROVISIONAL}"`
2. Shift times: `"Abierto {HH:MM} · Cerrado {HH:MM}"`
3. Cash reconciliation formula (opening + cash_sales + cash_in - cash_out = expected
   vs actual = difference + status label). Same suppress-zeroes rules.
4. Sales: gross, discounts (if >0), net, tax, ticket count + avg
5. Payment breakdown: cash, card, transfer (suppress zero methods)
6. Top 5 products
7. Alerts for this shift (if any)
8. Footer: if provisional → `"Verificado por {name}"` or `"SIN VERIFICAR"`

---

## 6. File Structure

```
src/lib/
├── denominations.ts                 # NEW: currency denomination definitions (§4.4)

src/modules/
├── shifts/                          # NEW module
│   ├── routes.ts                    # provisional endpoints
│   ├── controller.ts
│   ├── service.ts                   # open/verify provisional logic
│   └── schema.ts                    # Zod schemas
├── shift-reports/                   # NEW module
│   ├── routes.ts
│   ├── controller.ts
│   ├── service.ts                   # ShiftReport generation + queries
│   └── schema.ts
├── daily-reports/                   # NEW module
│   ├── routes.ts
│   ├── controller.ts
│   ├── service.ts                   # DailyReport generation + queries
│   └── schema.ts
├── alerts/                          # EXTEND existing module
│   ├── routes.ts                    # add general alert endpoints
│   ├── controller.ts               # add list/resolve controllers
│   ├── service.ts                   # add generation + resolution logic
│   └── schema.ts                    # add new schemas
├── cash-registers/
│   └── service.ts                   # MODIFY: add ShiftReport generation to closeRegister()
```

```
admin/src/pages/
├── reports/                         # NEW pages
│   ├── DailyReportsList.tsx
│   ├── DailyReportDetail.tsx
│   └── PrintableReport.tsx          # window.print() page
```

---

## 7. Settings Seeds

Add to the seed (or a new migration with INSERT):

```sql
INSERT INTO settings (id, key, value, created_at, updated_at) VALUES
  (gen_random_uuid(), 'alert_cash_shortage_threshold', '2000', NOW(), NOW()),
  (gen_random_uuid(), 'alert_cash_surplus_threshold', '2000', NOW(), NOW()),
  (gen_random_uuid(), 'alert_max_voids_per_shift', '3', NOW(), NOW()),
  (gen_random_uuid(), 'alert_max_discount_pct', '10', NOW(), NOW()),
  (gen_random_uuid(), 'alert_recurring_shortage_count', '3', NOW(), NOW()),
  (gen_random_uuid(), 'alert_recurring_shortage_min', '500', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
```

Also add to `SETTING_KEYS` in `src/modules/settings/schema.ts`.

---

## 8. Permissions

| Action | WAITER | BARISTA | CASHIER | MANAGER | ADMIN |
|--------|--------|---------|---------|---------|-------|
| Open provisional shift | ✅ | ✅ | ✅ | ✅ | ✅ |
| Close provisional shift | own only | own only | own only | own only | ✅ |
| Verify provisional | ❌ | ❌ | ❌ | ✅ | ✅ |
| View shift reports | ❌ | ❌ | own only | ✅ | ✅ |
| View daily reports | ❌ | ❌ | ❌ | ✅ | ✅ |
| Close daily report | ❌ | ❌ | ❌ | ✅ | ✅ |
| Print daily report | ❌ | ❌ | ❌ | ✅ | ✅ |
| View alerts | ❌ | ❌ | ❌ | ✅ | ✅ |
| Resolve alerts | ❌ | ❌ | ❌ | ✅ | ✅ |

**Provisional shift payment restrictions:**
When a WAITER/BARISTA opens a provisional shift and processes a payment, the existing
`Payment.approved_by_user_id` flow applies — they still need a cashier+ PIN to settle.
The provisional shift just lets them operate the register UI; the PIN gate on payment
remains.

---

## 9. Acceptance Criteria (v1)

- [ ] Provisional shift can be opened by any authenticated user against an OPEN regular shift
- [ ] Provisional shift only allows creating orders and processing payments (with PIN)
- [ ] Provisional shift shows up in register list with type=PROVISIONAL
- [ ] Closing any shift (regular or provisional) generates a ShiftReport automatically
- [ ] ShiftReport contains accurate sales, payment, and cash reconciliation data
- [ ] ShiftReport includes alerts when thresholds are breached
- [ ] Daily report can be closed only when no shifts are open for that day
- [ ] Daily report consolidates all ShiftReports accurately
- [ ] Daily report print endpoint returns valid HTML with print CSS
- [ ] Alerts are generated automatically — never manually created
- [ ] Alerts can be resolved by MANAGER/ADMIN with a resolution note
- [ ] Unverified provisional shifts generate CRITICAL alert at day close
- [ ] All new endpoints follow existing API conventions (response shape, error codes, auth)
- [ ] All monetary values use integer centavos, computed with Decimal
- [ ] All multi-table writes use Prisma transactions
- [ ] Existing tests still pass after migration
- [ ] New module has at least one integration test per endpoint
