# Restaurant POS Backend — Full Specification

> This is a POS system for a café, designed to run locally (hybrid: local-first, cloud-sync later).
> The system manages supplies, inventory, recipes, products, orders, and payments.
> This spec was designed by researching how professional POS systems (Poster POS, MarketMan, Toast, Square, WISK, Bar-i) solve these problems.

---

## Phase 1: Project Setup & Database Schema

### 1.1 Initialize project
- Node.js + TypeScript + Express + Prisma + PostgreSQL
- Folder structure: `src/modules/<module>/{routes,controller,service,schema}.ts`
- Global error handler middleware
- Request validation middleware (Zod)
- Logger (pino)
- CORS, helmet, rate limiting
- JWT auth middleware (placeholder — full auth in later phase)
- Environment config (.env with DATABASE_URL, JWT_SECRET, PORT)

### 1.2 Database schema (Prisma)
Create ALL tables defined below in a single migration. This is the complete data model.

---

## Phase 2: Supplies Module (Insumos)

### Core concept: The 3-Layer Unit Model
Every supply has ONE base unit (the unit used for inventory counting). All other contexts convert to/from this base unit:
- **Purchase layer**: bought in packages (boxes, cases, bags) → converted to base units
- **Inventory layer**: counted in base units (bottles, kg, pieces)
- **Recipe layer**: consumed in recipe units (ml, g, oz) → converted from base units

### 2.1 Entity: SupplyCategory
```
id              UUID PK
name            String (e.g., "Dairy", "Coffee", "Syrups", "Disposables")
description     String?
created_at      DateTime
updated_at      DateTime
```

### 2.2 Entity: Supply (Insumo)
```
id                    UUID PK
barcode               String? unique
name                  String (e.g., "Whole Milk 946ml")
category_id           UUID FK → SupplyCategory
base_unit             Enum: PIECE, BOTTLE, KG, LITER, BAG, BOX, UNIT
content_per_unit      Decimal? (e.g., 946 for a 946ml bottle)
content_unit          Enum?: ML, L, G, KG, OZ, FL_OZ (the measurable unit inside the base unit)
average_cost          Decimal (WAC — weighted average cost per base unit, in centavos)
last_cost             Decimal (cost from last purchase, in centavos)
active                Boolean default true
created_at            DateTime
updated_at            DateTime
deleted_at            DateTime?
```

### 2.3 Entity: Supplier (Proveedor)
```
id              UUID PK
name            String
contact_name    String?
phone           String?
email           String?
address         String?
credit_days     Int default 0
notes           String?
active          Boolean default true
created_at      DateTime
updated_at      DateTime
```

### 2.4 Entity: PurchasePackaging (Unidad de Compra)
Links a supply to how it's sold by a specific supplier.
One supply can have multiple packaging options (different suppliers, different presentations).
```
id                    UUID PK
supply_id             UUID FK → Supply
supplier_id           UUID FK → Supplier
name                  String (e.g., "Box of 6 bottles", "25kg bag")
units_per_package     Decimal (e.g., 6 — how many base units in this package)
active                Boolean default true
created_at            DateTime
updated_at            DateTime
```

### 2.5 Entity: Storage (Almacén)
```
id              UUID PK
name            String (e.g., "Warehouse", "Bar")
address         String?
active          Boolean default true
created_at      DateTime
updated_at      DateTime
```

### 2.6 Entity: StorageStock (Stock por almacén)
Tracks current stock of each supply in each storage location.
```
id              UUID PK
supply_id       UUID FK → Supply
storage_id      UUID FK → Storage
quantity        Decimal (in base units, e.g., 18.5 bottles)
min_stock       Decimal? (alert threshold for this storage)
created_at      DateTime
updated_at      DateTime
@@unique([supply_id, storage_id])
```

### 2.7 Entity: TareWeight (Peso de tara — for weighing partial bottles)
Used during inventory checks to convert bottle weight to remaining content.
```
id                    UUID PK
supply_id             UUID FK → Supply (unique)
empty_weight_grams    Decimal (weight of empty container)
full_weight_grams     Decimal (weight of full container)
net_content           Decimal (content when full, in content_unit)
created_at            DateTime
updated_at            DateTime
```
Formula: `remaining = ((current_weight - empty_weight) / (full_weight - empty_weight)) * net_content`

### 2.8 Entity: Purchase (Compra / Supply entry)
```
id              UUID PK
supplier_id     UUID FK → Supplier
storage_id      UUID FK → Storage (where supplies are received)
date            DateTime
status          Enum: DRAFT, CONFIRMED, CANCELLED
total           Decimal (in centavos)
payment_method  String?
notes           String?
user_id         UUID FK → User
created_at      DateTime
updated_at      DateTime
```

### 2.9 Entity: PurchaseItem (Detalle de compra)
```
id                    UUID PK
purchase_id           UUID FK → Purchase
supply_id             UUID FK → Supply
packaging_id          UUID? FK → PurchasePackaging (null = bought in base units)
package_quantity      Decimal (e.g., 3 boxes)
price_per_package     Decimal (in centavos)
base_unit_quantity    Decimal (CALCULATED: package_quantity * units_per_package)
unit_cost             Decimal (CALCULATED: price_per_package / units_per_package, in centavos)
created_at            DateTime
```

**On Purchase CONFIRM:**
1. For each PurchaseItem:
   a. Calculate `base_unit_quantity = package_quantity * units_per_package`
   b. Calculate `unit_cost = price_per_package / units_per_package`
   c. Update StorageStock: `quantity += base_unit_quantity`
   d. Recalculate WAC on Supply:
      ```
      new_avg = ((old_stock * old_avg_cost) + (new_units * new_unit_cost)) / (old_stock + new_units)
      ```
   e. Update Supply.last_cost = unit_cost
   f. Log a StockMovement (type: PURCHASE)
2. All of the above in a single transaction

### 2.10 Entity: Transfer (Transferencia entre almacenes)
```
id                UUID PK
from_storage_id   UUID FK → Storage
to_storage_id     UUID FK → Storage
date              DateTime
notes             String?
user_id           UUID FK → User
created_at        DateTime
updated_at        DateTime
```

### 2.11 Entity: TransferItem
```
id              UUID PK
transfer_id     UUID FK → Transfer
supply_id       UUID FK → Supply
quantity        Decimal (in base units)
```

**On Transfer save:**
1. StorageStock[from_storage] -= quantity
2. StorageStock[to_storage] += quantity (create if not exists)
3. Log StockMovement (type: TRANSFER_OUT and TRANSFER_IN)
4. Single transaction. Fail if source stock < quantity.

### 2.12 Entity: InventoryCheck (Conteo de inventario)
```
id              UUID PK
storage_id      UUID FK → Storage
type            Enum: FULL, PARTIAL
status          Enum: IN_PROGRESS, COMPLETED
date            DateTime
user_id         UUID FK → User
completed_at    DateTime?
created_at      DateTime
updated_at      DateTime
```

### 2.13 Entity: InventoryCheckItem
```
id                UUID PK
check_id          UUID FK → InventoryCheck
supply_id         UUID FK → Supply
expected_qty      Decimal (system's calculated stock)
actual_qty        Decimal (physically counted)
difference        Decimal (CALCULATED: actual - expected)
difference_cost   Decimal (CALCULATED: difference * average_cost)
```

**On InventoryCheck COMPLETE:**
1. For each item: StorageStock.quantity = actual_qty
2. Log StockMovement (type: ADJUSTMENT, with difference as quantity)
3. Single transaction.

### 2.14 Entity: WriteOff (Merma manual)
```
id              UUID PK
storage_id      UUID FK → Storage
supply_id       UUID FK → Supply
quantity        Decimal (in base units)
reason          Enum: EXPIRED, DAMAGED, SPILLED, THEFT, OTHER
notes           String?
date            DateTime
user_id         UUID FK → User
created_at      DateTime
```

**On WriteOff save:**
1. StorageStock.quantity -= quantity
2. Log StockMovement (type: WRITE_OFF)

### 2.15 Entity: StockMovement (Registro de movimientos — audit log)
```
id              UUID PK
supply_id       UUID FK → Supply
storage_id      UUID FK → Storage
type            Enum: PURCHASE, SALE, TRANSFER_IN, TRANSFER_OUT, WRITE_OFF, ADJUSTMENT, MANUFACTURE
quantity        Decimal (positive = in, negative = out)
reference_type  String (e.g., "Purchase", "Transfer", "Order")
reference_id    UUID (FK to the source document)
unit_cost       Decimal (cost at time of movement)
created_at      DateTime
```

### 2.16 Entity: DeductionRule (Regla de descuento por estación)
```
id              UUID PK
station_id      UUID? (null = default rule)
pos_register_id UUID? (null = default rule)
storage_id      UUID FK → Storage
created_at      DateTime
```
When a sale happens at station X, deduct from storage Y.

---

## Phase 3: Products Module (Productos y Menú)

### Core concept: Product Types
- **Product**: Ready-to-sell item, no recipe (bottled water, packaged cookie). Deducts 1 unit from inventory.
- **Dish**: Prepared item with a recipe (Latte, Cappuccino). Deducts ingredients from inventory.
- **Preparation**: Sub-recipe, never sold directly (simple syrup, mocha sauce). Used as ingredient in dishes.

### 3.1 Entity: ProductCategory
```
id              UUID PK
name            String (e.g., "Hot Coffee", "Cold Coffee", "Food", "Bottled Drinks")
description     String?
image_url       String?
color           String? (hex color for POS display)
display_order   Int default 0
visible_in_pos  Boolean default true
parent_id       UUID? FK → ProductCategory (for subcategories)
created_at      DateTime
updated_at      DateTime
```

### 3.2 Entity: Product
```
id                UUID PK
name              String
type              Enum: PRODUCT, DISH, PREPARATION
category_id       UUID? FK → ProductCategory (null for preparations)
station_id        UUID? (which station prepares this — bar, kitchen)
sell_price         Decimal? (in centavos, null for preparations)
recipe_cost       Decimal (CALCULATED from recipe, in centavos)
food_cost_pct     Decimal (CALCULATED: recipe_cost / sell_price * 100)
markup            Decimal (CALCULATED: sell_price / recipe_cost)
image_url         String?
icon_color        String?
display_order     Int default 0
active            Boolean default true
allow_discount    Boolean default true
sold_by_weight    Boolean default false (if true, price is per 100g)
barcode           String? unique
tax_id            UUID? FK → Tax
supply_id         UUID? FK → Supply (only for type=PRODUCT, links to the supply item)
created_at        DateTime
updated_at        DateTime
deleted_at        DateTime?
```

### 3.3 Entity: ProductVariant (Tamaños: Chico, Mediano, Grande)
Each variant has its own price and its own recipe.
```
id              UUID PK
product_id      UUID FK → Product
name            String (e.g., "Small 8oz", "Medium 12oz", "Large 16oz")
sell_price      Decimal (in centavos)
barcode         String? unique
recipe_cost     Decimal (CALCULATED)
food_cost_pct   Decimal (CALCULATED)
display_order   Int default 0
active          Boolean default true
created_at      DateTime
updated_at      DateTime
```

### 3.4 Entity: ModifierGroup (Grupo de modificadores)
```
id              UUID PK
name            String (e.g., "Milk Type", "Extras", "Sweetener")
min_selection   Int default 0 (0 = optional)
max_selection   Int default 1 (1 = pick one, N = pick up to N)
required        Boolean default false
display_order   Int default 0
created_at      DateTime
updated_at      DateTime
```

### 3.5 Entity: Modifier
```
id              UUID PK
group_id        UUID FK → ModifierGroup
name            String (e.g., "Almond Milk", "Extra Shot", "Decaf", "No Whip")
extra_price     Decimal default 0 (in centavos, added to product price)
supply_id       UUID? FK → Supply (null = informational only, e.g., "extra hot")
supply_quantity Decimal? (amount of supply to deduct, in content_unit)
supply_unit     String? (ml, g, oz — must match supply's content_unit)
active          Boolean default true
display_order   Int default 0
created_at      DateTime
updated_at      DateTime
```

### 3.6 Entity: ProductModifierGroup (many-to-many link)
```
id                UUID PK
product_id        UUID FK → Product
modifier_group_id UUID FK → ModifierGroup
```
A Latte can have: "Milk Type" + "Extras" + "Sweetener" groups.
An Americano can have: only "Extras" group.

### 3.7 Entity: Recipe
A recipe belongs to either a Product (type=DISH), a ProductVariant, or a Product (type=PREPARATION).
```
id              UUID PK
product_id      UUID? FK → Product
variant_id      UUID? FK → ProductVariant
created_at      DateTime
updated_at      DateTime
```
Exactly one of product_id or variant_id must be set.

### 3.8 Entity: RecipeItem
```
id                UUID PK
recipe_id         UUID FK → Recipe
supply_id         UUID? FK → Supply (raw ingredient)
preparation_id    UUID? FK → Product (where type=PREPARATION, for sub-recipes)
quantity          Decimal (amount needed)
unit              String (ml, g, oz, piece — the unit for this recipe line)
waste_pct         Decimal default 0 (loss percentage during prep)
created_at        DateTime
```
Exactly one of supply_id or preparation_id must be set.

**Cost calculation for a recipe:**
```
For each RecipeItem:
  if supply_id:
    Convert quantity to base units: 
      converted_qty = quantity / supply.content_per_unit
      (e.g., 200ml / 946ml per bottle = 0.2114 bottles)
    Apply waste: adjusted_qty = converted_qty / (1 - waste_pct/100)
    item_cost = adjusted_qty * supply.average_cost
  if preparation_id:
    Get the preparation's recipe cost per unit of yield
    item_cost = (quantity / preparation_yield) * preparation_recipe_cost

recipe_total_cost = sum of all item_costs
```

### 3.9 Entity: ProductModification (for packaged product variations)
Different from modifiers. Modifications are VARIANTS of a packaged PRODUCT (not a dish).
Example: "Juice" product → modifications: Orange ($40), Mango ($45), Pomegranate ($50).
Each has its own barcode, price, and links to a specific supply item.
```
id              UUID PK
product_id      UUID FK → Product (where type=PRODUCT)
name            String (e.g., "Orange", "Mango")
sell_price      Decimal (in centavos)
barcode         String? unique
supply_id       UUID? FK → Supply (links to specific supply)
active          Boolean default true
display_order   Int default 0
created_at      DateTime
updated_at      DateTime
```

---

## Phase 4: Sale Deduction Flow

When a sale is completed (order closed/paid), the system must deduct inventory:

### For a DISH (e.g., Latte Grande with Almond Milk + Extra Shot):

1. Determine which storage to deduct from:
   - Check DeductionRule for the station/register
   - Default: storage that last received a supply of the ingredient

2. Get the recipe for the sold variant (or product if no variant):
   - Look up Recipe where variant_id = sold variant

3. For each RecipeItem in the recipe:
   a. If supply_id → convert recipe quantity to base units → deduct from StorageStock
   b. If preparation_id → recursively resolve the preparation's recipe → deduct those supplies

4. For each Modifier applied to the sale:
   a. If modifier has supply_id → deduct modifier.supply_quantity (converted to base units) from StorageStock

5. Log all deductions as StockMovement (type: SALE, reference: Order)

6. All in a single transaction. If any stock goes negative, allow it but flag a warning (don't block the sale — the café must keep operating).

### For a PRODUCT (e.g., Bottled Water):
1. Deduct 1 unit of the linked supply from StorageStock
2. Log StockMovement (type: SALE)

---

## Phase 5: Reporting & Alerts (API endpoints only)

### Low stock alerts
- When StorageStock.quantity <= StorageStock.min_stock, flag the supply
- API endpoint: GET /api/v1/alerts/low-stock?storage_id=

### Theoretical vs Actual analysis
- Theoretical usage = sum of all recipe deductions (from sales) in a period
- Actual usage = beginning inventory + purchases - ending inventory
- Variance = theoretical - actual
- Positive variance = more was used than recipes say → waste, theft, or bad recipes
- API endpoint: GET /api/v1/reports/variance?storage_id=&from=&to=

### Supply movement report
- All movements for a supply in a period (purchases, sales, transfers, write-offs, adjustments)
- API endpoint: GET /api/v1/reports/supply-movements?supply_id=&from=&to=

### Cost reports
- Recipe cost per product
- Food cost percentage per product
- API endpoint: GET /api/v1/reports/product-costs

---

## Phase 6: Auth & Users (basic)

### Entity: User
```
id              UUID PK
name            String
email           String unique
pin             String (4-6 digit PIN for POS login)
password_hash   String (for admin console login)
role            Enum: ADMIN, MANAGER, CASHIER, BARISTA
active          Boolean default true
created_at      DateTime
updated_at      DateTime
```

### Entity: Tax
```
id              UUID PK
name            String (e.g., "IVA 16%")
rate            Decimal (e.g., 16.00)
active          Boolean default true
created_at      DateTime
updated_at      DateTime
```

---

## Phase 7: Orders, Payments & Cash Register

### Core concept
An Order is the lifecycle of a customer's visit: open → add items → pay → close.
When an order is PAID, it triggers the sale deduction engine (already built in Phase 4).
The Cash Register (Caja) tracks money across shifts — how much cash started, how much came in, how much should be there.

### 7.1 Entity: CashRegister (Caja / Turno)
A shift. Opened by a user at the start of their work, closed at the end.
```
id                UUID PK
user_id           UUID FK → User (who opened this shift)
opened_at         DateTime
closed_at         DateTime?
opening_amount    Decimal (in centavos — cash in the drawer at start)
expected_amount   Decimal (CALCULATED: opening + cash sales - cash change given)
actual_amount     Decimal? (physically counted at close)
difference        Decimal? (CALCULATED: actual - expected)
status            Enum: OPEN, CLOSED
notes             String?
created_at        DateTime
updated_at        DateTime
```

**Rules:**
- Only ONE register can be OPEN per user at a time.
- To close: user enters actual_amount (what they counted), system calculates difference.
- Orders can only be created while a register is OPEN.
- Non-sale cash movements (petty cash out, tips in, etc.) are tracked via CashMovement.

### 7.2 Entity: CashMovement (Movimientos de caja no relacionados a ventas)
```
id                UUID PK
register_id       UUID FK → CashRegister
type              Enum: CASH_IN, CASH_OUT
amount            Decimal (in centavos, always positive)
reason            String (e.g., "Petty cash for supplies", "Tips")
user_id           UUID FK → User
created_at        DateTime
```
These affect expected_amount: CASH_IN adds, CASH_OUT subtracts.

### 7.3 Entity: Order (Orden)
```
id                UUID PK
register_id       UUID FK → CashRegister
order_number      Int (auto-increment per day, resets daily: 1, 2, 3...)
status            Enum: OPEN, PAID, CANCELLED
order_type        Enum: DINE_IN, TAKEOUT
subtotal          Decimal (sum of items before tax, in centavos)
tax_amount        Decimal (in centavos)
discount_amount   Decimal default 0 (in centavos)
discount_reason   String?
total             Decimal (subtotal + tax - discount, in centavos)
notes             String?
user_id           UUID FK → User (who created the order)
created_at        DateTime
updated_at        DateTime
```

### 7.4 Entity: OrderItem
```
id                UUID PK
order_id          UUID FK → Order
product_id        UUID FK → Product
variant_id        UUID? FK → ProductVariant
quantity          Int default 1
unit_price        Decimal (in centavos — price at time of sale, snapshot)
modifiers_price   Decimal default 0 (sum of modifier extra_prices)
line_total        Decimal (CALCULATED: (unit_price + modifiers_price) * quantity)
notes             String? (e.g., "extra hot", special instructions)
created_at        DateTime
```

### 7.5 Entity: OrderItemModifier
```
id                UUID PK
order_item_id     UUID FK → OrderItem
modifier_id       UUID FK → Modifier
name              String (snapshot — modifier name at time of sale)
extra_price       Decimal (snapshot — price at time of sale, in centavos)
```
Prices are snapshotted so the order history stays accurate even if menu prices change later.

### 7.6 Entity: Payment (Pago)
```
id                UUID PK
order_id          UUID FK → Order
method            Enum: CASH, CARD, TRANSFER
amount            Decimal (in centavos — amount tendered)
change_amount     Decimal default 0 (only for CASH: amount - order.total)
reference         String? (transaction ID for card/transfer)
created_at        DateTime
```

**Rules:**
- An order can have MULTIPLE payments (split payment: part cash, part card).
- Sum of all payment amounts must be >= order.total to mark as PAID.
- change_amount only applies to the CASH payment in a split.
- CARD and TRANSFER payments: amount must equal exactly what's owed (no change).

### 7.7 Order lifecycle flow

**Opening an order:**
1. Verify CashRegister is OPEN for this user
2. Create Order with status=OPEN, auto-generate order_number for today

**Adding items:**
1. Validate product/variant exists and is active
2. Snapshot unit_price from variant.sell_price (or product.sell_price)
3. Apply modifiers: snapshot each modifier's name and extra_price
4. Calculate line_total = (unit_price + sum(modifier prices)) * quantity
5. Recalculate order subtotal, tax, total

**Removing/updating items:**
- Only while order status=OPEN
- Recalculate totals after any change

**Paying:**
1. Create Payment record(s)
2. If method=CASH: change_amount = amount - remaining_balance (must be >= 0)
3. If method=CARD or TRANSFER: amount must equal remaining_balance exactly
4. When sum(payments) >= order.total:
   a. Set order.status = PAID
   b. Call deductSaleFromInventory (already built) with all order items
   c. Update CashRegister.expected_amount (add cash payments, subtract change)
5. All in a single transaction

**Cancelling:**
- Only OPEN orders can be cancelled
- Set status=CANCELLED, no inventory deduction

### 7.8 Cash register close flow
1. User enters actual_amount (what they physically counted)
2. System calculates expected_amount:
   ```
   expected = opening_amount
            + sum(CASH payments from this register's orders)
            - sum(change_amount from CASH payments)
            + sum(CASH_IN movements)
            - sum(CASH_OUT movements)
   ```
3. difference = actual_amount - expected_amount
4. Set status=CLOSED, closed_at=now
5. Positive difference = extra cash (tips left in drawer?)
6. Negative difference = missing cash (error or theft)

### 7.9 API endpoints
```
POST   /api/v1/registers                    — open a register (opening_amount)
POST   /api/v1/registers/:id/close          — close register (actual_amount)
GET    /api/v1/registers/:id                — register details + summary
GET    /api/v1/registers                    — list registers (filter by status, user, date)

POST   /api/v1/registers/:id/cash-movements — add cash in/out
GET    /api/v1/registers/:id/cash-movements — list movements

POST   /api/v1/orders                       — create order (register_id, order_type)
GET    /api/v1/orders/:id                   — order detail with items, modifiers, payments
GET    /api/v1/orders                       — list orders (filter by status, date, register)
PATCH  /api/v1/orders/:id                   — update notes, discount
DELETE /api/v1/orders/:id                   — cancel order

POST   /api/v1/orders/:id/items             — add item (product_id, variant_id?, quantity, modifier_ids[])
PATCH  /api/v1/orders/:id/items/:itemId     — update quantity or notes
DELETE /api/v1/orders/:id/items/:itemId     — remove item

POST   /api/v1/orders/:id/payments          — add payment (method, amount, reference?)
```

---

## Implementation Notes

### Monetary values
ALL monetary values are stored as integers in centavos (e.g., $45.50 = 4550).
Use Decimal.js for all arithmetic. Never use native JS floats for money.

### Quantity values
Quantities use Prisma Decimal type. Stored with up to 4 decimal places.
Example: 0.2114 bottles, 3.5000 kg.

### WAC (Weighted Average Cost) recalculation
```typescript
function recalculateWAC(
  currentStock: Decimal,
  currentAvgCost: Decimal,
  newQuantity: Decimal,
  newUnitCost: Decimal
): Decimal {
  const totalCurrentValue = currentStock.mul(currentAvgCost);
  const totalNewValue = newQuantity.mul(newUnitCost);
  const totalStock = currentStock.add(newQuantity);
  if (totalStock.isZero()) return new Decimal(0);
  return totalCurrentValue.add(totalNewValue).div(totalStock);
}
```

### Recipe cost recalculation
Recipe costs should be recalculated:
- When a new Purchase is confirmed (WAC changes)
- When a recipe is edited
- On demand via API endpoint

### Seed data for testing
Include seed data for a café scenario:
- Supplies: whole milk, almond milk, espresso beans, vanilla syrup, chocolate sauce, cups (8oz, 12oz, 16oz)
- Supplier: "Distribuidora Café del Norte"
- Storages: "Bodega", "Barra"
- Products: Latte (3 sizes), Cappuccino (3 sizes), Americano (2 sizes), Mocha (3 sizes), Bottled Water
- Preparations: Simple Syrup, Mocha Sauce
- Modifier groups: Milk Type, Extras, Sweetener
- Realistic recipes with real quantities
