# POS Terminal — Electron Desktop App Specification

> Electron app for the cashier station and waiter tablets.
> Connects to the same backend API as the admin panel.
> Optimized for speed, touch, and restaurant workflow.

---

## Tech Stack
- Electron 30+ (main process)
- React + TypeScript (renderer process)
- Vite for renderer build
- electron-builder for packaging
- TanStack Query for API state
- Zustand for local state (session, cart, UI)
- node-thermal-printer or escpos for ESC/POS printing (main process)
- Same API client pattern as admin panel

## Project Structure
```
terminal/
├── electron/
│   ├── main.ts            — Electron main process
│   ├── preload.ts          — context bridge (print, system info)
│   └── printer.ts          — ESC/POS printer service (receipts + kitchen)
├── src/                    — React renderer
│   ├── api/                — API client (same pattern as admin)
│   ├── components/
│   │   ├── layout/         — TerminalLayout, PINLogin, StatusBar
│   │   ├── floor/          — FloorPlan, ZoneView, TableCard
│   │   ├── order/          — OrderPanel, CartSidebar, ProductGrid, ModifierPicker
│   │   ├── payment/        — PaymentScreen, CashInput, SplitPayment
│   │   └── ui/             — Button, Badge, Modal, NumPad, Toast
│   ├── pages/
│   │   ├── LoginPage.tsx       — PIN entry
│   │   ├── FloorPage.tsx       — Table/zone view (waiter default)
│   │   ├── OrderPage.tsx       — Product grid + cart (main work screen)
│   │   ├── PaymentPage.tsx     — Payment flow
│   │   ├── OrdersListPage.tsx  — Active orders list (cashier)
│   │   └── RegisterPage.tsx    — Open/close shift (cashier only)
│   ├── hooks/
│   ├── store/              — Zustand (session, cart, printer config)
│   ├── utils/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css           — Terminal-specific design system
├── package.json
├── electron-builder.yml
├── vite.config.ts
└── tsconfig.json
```

---

## Design System (Terminal-specific)

NOT the same as admin panel. Terminal needs:
- **Large touch targets**: minimum 48px height for buttons, 56px+ for primary actions
- **High contrast**: dark theme preferred (easier on eyes in cafe lighting)
- **Big text**: product names 16px+, prices 18px+, totals 24px+
- **Minimal navigation**: no sidebar, no breadcrumbs — full screen dedicated to the task
- **Color coding**: status colors must be instantly readable from a distance
  - Green = available/paid/success
  - Gold/amber = in progress/occupied
  - Red = urgent/needs attention
  - Blue = selected/active
- **Touch-friendly spacing**: 8px minimum gap between interactive elements
- **No hover states for primary interactions** — everything works on tap
- Same warm palette as admin (cream, brown, gold) but adapted for dark mode terminal use

---

## Authentication: PIN Login

- Full screen number pad (0-9) with large buttons
- User enters 4-digit PIN
- System matches against User.pin field
- On success: show user name, role, and go to their default screen:
  - CASHIER/ADMIN → OrdersListPage (see all active orders)
  - WAITER → FloorPage (see tables)
  - BARISTA → OrdersListPage (see orders in queue, read-only)
- "Lock" button always visible — returns to PIN screen without logging out the register
- Session timeout: auto-lock after 5 minutes of inactivity (configurable)

---

## Role Permissions

### Waiter (WAITER role)
CAN:
- View floor plan with table statuses
- Create new orders (DINE_IN with table, TAKEOUT without)
- Add items to an OPEN order
- Modify quantity of items they added
- Add notes to items
- Send order to kitchen (triggers kitchen printer)
- View their own active orders

CANNOT:
- Delete/remove items from orders (must request cashier)
- Cancel orders
- Process payments
- Open/close register
- Access other waiters' orders (unless ADMIN)

### Cashier (CASHIER role)
CAN:
- Everything waiter can do
- View ALL active orders
- Delete items from any order
- Cancel orders
- Apply discounts (with reason)
- Process payments (cash, card, transfer, split)
- Open/close cash register
- Reprint tickets
- Override waiter restrictions

### Admin (ADMIN role)
- Everything cashier can do
- No restrictions

---

## Screens & Flows

### 1. Floor Plan (FloorPage)
Default screen for waiters. Shows all zones and tables.

Layout:
- Top bar: zone tabs (Indoor, Terrace, Bar Area) + "Takeout" button
- Main area: grid of table cards
- Each table card shows:
  - Table number (large)
  - Capacity (small, e.g., "4 seats")
  - Status color (green=available, gold=occupied, red=needs attention)
  - If occupied: time elapsed since order opened, waiter name, item count
- Tap available table → create new DINE_IN order → go to OrderPage
- Tap occupied table → open that table's active order → go to OrderPage
- "Takeout" button → create TAKEOUT order (no table) → go to OrderPage

### 2. Order Page (OrderPage)
The main work screen. Split layout:

**Left side (60-65%): Product Grid**
- Top: category tabs/pills (Hot Coffee, Cold Coffee, Food, etc.)
- Grid of product cards:
  - Product name, icon/color, price
  - Tap → if variants exist, show variant picker (Small/Medium/Large)
  - After variant → if required modifier groups, show modifier picker
  - Item added to cart with animation feedback
- Search bar at top for quick product lookup

**Right side (35-40%): Cart / Order Panel**
- Order header: order #, type (DINE_IN/TAKEOUT), table #, waiter name
- Item list:
  - Product name + variant
  - Modifiers listed below (indented, smaller text)
  - Quantity stepper (+ / -)
  - Line total
  - Notes icon (tap to add/edit note)
  - Delete button (X) — only visible to CASHIER role
- Subtotal, tax breakdown, discount (if any), total
- Bottom action buttons:
  - "Send to Kitchen" (green, primary) — prints comanda, marks items as sent
  - "Pay" (gold) — only for CASHIER — goes to PaymentPage
  - "Hold" — saves order, goes back to floor/orders list
  - For waiter: "Request Edit" button that notifies cashier

### 3. Modifier Picker (Modal/Overlay)
When a product has modifier groups:
- Show each required group as a step
- For SWAP groups (e.g., Milk Type):
  - Title: "Milk Type"
  - Options as large buttons: Whole Milk, Almond Milk (+$10), Oat Milk (+$8)
  - Default highlighted
  - Must pick one (if required)
- For ADD groups (e.g., Extras):
  - Multi-select buttons: Extra Shot (+$15), Vanilla Syrup (+$8), Decaf
  - Optional — can skip
- "Add to Order" button at the bottom with running price preview

### 4. Payment Page (PaymentPage)
Cashier only. Full screen payment flow.

- Left: order summary (items, totals)
- Right: payment panel
  - Large total display at top
  - Quick cash buttons: exact amount, $50, $100, $200, $500
  - Custom amount input with numpad
  - Payment method selector: Cash / Card / Transfer
  - For cash: shows change calculation live
  - For card/transfer: optional reference field
  - "Split Payment" toggle: allows adding multiple payment methods
  - "Complete Payment" button (disabled until amount >= total)
- On complete:
  - Order status → PAID
  - Inventory deducted
  - Receipt printed (receipt printer)
  - Table freed (if DINE_IN)
  - Return to floor/orders list

### 5. Orders List (OrdersListPage)
Default for cashier. Shows all active orders.

- Tabs or filters: All / Open / Sent to Kitchen / Paid
- Order cards in a grid or list:
  - Order #, type, table (if dine-in), waiter name
  - Time elapsed
  - Item count, total
  - Status badge
- Tap → go to OrderPage for that order
- Quick actions: Pay (if CASHIER), Cancel (if CASHIER)

### 6. Register Page (RegisterPage)
Cashier only. Accessed from a menu button.

- If no open register: "Open Shift" with opening amount numpad
- If register open: show current shift summary
  - Opening amount, current expected, orders count, elapsed time
  - "Close Shift" → enter counted amount → show difference → confirm
- Cash in/out buttons

---

## Kitchen Printing

### When to print:
- "Send to Kitchen" button is pressed on an order
- Track which items have been "sent" vs newly added:
  - OrderItem gets a `sent_to_kitchen Boolean default false` field
  - "Send to Kitchen" only prints items where sent_to_kitchen = false
  - After printing, marks those items as sent_to_kitchen = true
  - If new items are added to an already-sent order, only the new items print next time

### Comanda format (kitchen printer):
```
================================
        KITCHEN ORDER
================================
Order #: 42        Table: 5
Waiter: Carlos     14:35
--------------------------------
2x Latte Grande
   > Almond Milk
   > Extra Shot
   NOTE: Extra hot

1x Cappuccino Medium
   > Oat Milk

1x Club Sandwich
   NOTE: No tomato
--------------------------------
      ** NEW ITEMS **
      (if reprinting with additions)
================================
```

### Receipt format (receipt printer):
```
================================
      [Business Name]
      [Address line]
================================
Order #: 42
Date: 2026-04-23  14:52
Cashier: Daniel
Table: 5
--------------------------------
2  Latte Grande        $150.00
   Almond Milk  +$20.00
   Extra Shot   +$30.00
1  Cappuccino Med       $65.00
   Oat Milk     +$10.00
1  Club Sandwich        $95.00
--------------------------------
Subtotal:             $318.97
IVA 16%:               $51.03
Total:                $370.00
--------------------------------
Cash:                 $400.00
Change:                $30.00
================================
       Thank you for your visit!
================================
```

### Printer configuration:
- Electron main process handles printing via IPC
- Renderer sends print commands through preload bridge:
  ```typescript
  window.electron.printKitchen(orderData)
  window.electron.printReceipt(orderData)
  ```
- Printer settings stored in electron-store:
  - Receipt printer: USB/network path, paper width (58mm/80mm)
  - Kitchen printer: USB/network path, paper width
  - Print test page from settings

---

## Backend Additions Needed

### New fields:
1. OrderItem: add `sent_to_kitchen Boolean default false`
2. OrderItem: add `sent_at DateTime?` (when it was sent to kitchen)
3. OrderItem: add `added_by UUID FK → User` (which waiter added this item)

### New endpoints:
1. POST /api/v1/auth/pin-login — { pin: "1234" } → { token, user }
2. POST /api/v1/orders/:id/send-to-kitchen — marks unsent items as sent, returns the items that were marked (for printing)
3. GET /api/v1/orders/active — returns only OPEN orders with items + modifiers (optimized for terminal polling)
4. GET /api/v1/floors — returns all zones with their tables and current status (occupied/available + active order info)

### Permission middleware:
- requireRole('CASHIER', 'ADMIN') — for payment, delete items, cancel orders
- requireRole('WAITER', 'CASHIER', 'ADMIN') — for creating orders, adding items

---

## Implementation Phases

### Terminal Phase 1: Electron + React scaffold + backend additions
- Electron main process with Vite renderer
- Dark theme design system with warm palette
- PIN login screen with numpad
- Connection to backend API
- Backend: add new fields, endpoints, PIN login, role middleware

### Terminal Phase 2: Floor plan + Order creation
- Floor plan with zones and tables
- Create order (DINE_IN + TAKEOUT)
- Product grid with categories
- Variant picker + modifier picker
- Cart panel with item management
- Role-based button visibility

### Terminal Phase 3: Kitchen printing + sent tracking
- ESC/POS printer integration in Electron main process
- IPC bridge for print commands
- "Send to Kitchen" flow with sent_to_kitchen tracking
- Comanda format printing
- Only print new/unsent items

### Terminal Phase 4: Payment + Receipt
- Payment screen with numpad + quick cash buttons
- Cash/card/transfer with split support
- Receipt printing
- Register open/close from terminal

### Terminal Phase 5: Polish + permissions
- Enforce waiter/cashier restrictions
- "Request Edit" flow for waiters
- Auto-lock on inactivity
- Error handling
- Sound feedback (optional)
