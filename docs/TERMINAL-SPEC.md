# POS Terminal — Specification (v2)

> Based on the wireframe in docs/pos-terminal-design.html
> Electron app for cashier station and waiter tablets.
> Connects to the same backend API as the admin panel.

---

## Tech Stack
- Electron 30+ (main process)
- React + TypeScript (renderer process)
- Vite for renderer build
- electron-builder for packaging
- TanStack Query for API state
- Zustand for local state (session, cart, UI)
- node-thermal-printer for ESC/POS printing (main process)

## Project Structure
```
terminal/
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   └── printer.ts
├── src/
│   ├── api/
│   ├── components/
│   │   ├── TopBar.tsx
│   │   ├── Icons.tsx
│   │   ├── ActiveOrders.tsx
│   │   ├── FloorPlan.tsx
│   │   ├── TableDetail.tsx
│   │   ├── OrderHistory.tsx
│   │   ├── Settings.tsx
│   │   └── ui/
│   ├── hooks/
│   ├── store/
│   ├── utils/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── electron-builder.yml
├── vite.config.ts
└── tsconfig.json
```

---

## Design System

IMPORTANT: The terminal uses the SAME warm light theme as the admin panel — NOT a dark theme.

### CSS Variables (from wireframe)
```css
:root {
  --bg:       rgb(245, 240, 232);   /* warm cream background */
  --bg2:      #fff;                  /* card/surface background */
  --text1:    #2c2420;               /* primary text */
  --text2:    #6b5e54;               /* secondary text */
  --text3:    #a89888;               /* muted text */
  --gold:     #c9a45c;               /* accent / highlights / selected */
  --green:    #4a8c5c;               /* success / available / <10min */
  --red:      #c45040;               /* danger / urgent / 25+min */
  --border:   #e2dcd4;               /* borders and dividers */
  --sidebar:  #2c2420;               /* top bar background (dark brown) */
  --shadow-sm: 0 1px 2px rgba(44,36,32,0.04);
  --shadow:    0 2px 8px rgba(44,36,32,0.06);
  --shadow-lg: 0 8px 32px rgba(44,36,32,0.12);
}
```
- Fonts: Playfair Display (headings), DM Sans (body)
- Touch targets: 44px+ height minimum
- Time-status colors: green (<10min), gold/amber (10-25min), red (25+min)

---

## Top Bar (72px height, dark brown background)

Three-column grid layout:
- **Left**: Brand name (Playfair Display) + quick action buttons (+ New Order)
- **Center**: Navigation tabs — Floor Plan | Active Orders | Order History
  - Active tab has gold background highlight
  - Tab icons: grid icon for floor, list icon for orders, clock for history
- **Right**: Status area — clock, user avatar (initials circle) + name + role, hamburger menu icon
  - Hamburger opens dropdown: Settings, Lock Screen, Sign Out

---

## Screen 1: Active Orders (Control Center)

The cashier's default view. Zone-grouped, dense, information-rich.

### Page Header
- Title: "Active Orders" (Playfair Display)
- Subtitle: "Real-time overview of all open orders"
- Right side: filter pills (All | Dine-in | Takeout) + search input

### Summary Bar (4 metric cards)
- Active Orders: count
- Avg Wait: minutes
- Need Attention: count (red if > 0)
- Revenue Today: total

### Zone Sections (collapsible)
Each zone is a collapsible section:
- **Header row**: collapse arrow + zone name (bold) + stats: "X active · $XXX · avg X min"
- **Order rows** inside (compact, ~56px height):
  - Left color stripe (3px, green/gold/red based on time)
  - Time indicator: colored dot + elapsed time (e.g., "12 min")
  - Table number (bold) or "Takeout #XX"
  - Waiter name (secondary text)
  - Items count
  - Total amount
  - Item status progress: "2/3 ready" or "waiting" or "delivered"
  - Charge button (gold, right side)
  - Attention flag (pulsing orange dot if waiter requested help)

### Expanded Row (inline, not modal)
When tapped, row expands below showing:
- Item list with quantities, modifiers, notes, individual status icons (✓ ready, ◷ waiting)
- Sent status per item (checkmark if sent to kitchen)
- Action bar: Reprint | Discount | View Full | Cancel
- Notes section

### Footer Summary Bar
- Left: "X orders today · $X,XXX revenue"
- Center: "X pending payment"
- Right: "Shift: Xh Xm · Drawer: $X,XXX expected"

---

## Screen 2: Floor Plan

Visual table layout with drag-and-drop editing.

### Header
- Title: "Floor Plan" (Playfair Display)
- Subtitle: zone stats
- Right: "Edit Layout" toggle button

### Zone Tabs
- Horizontal tabs: one per zone (e.g., "Main Dining", "Patio", "Bar")
- "All Zones" option

### Table Canvas
- Relative container with absolute-positioned table elements
- Tables rendered as styled divs at their saved (pos_x, pos_y) coordinates
- **Rectangular tables**: rounded rectangles with table number + capacity
- **Circular tables**: circles with table number
- Color coding by status:
  - Green border/accent: available — shows "Tap to open"
  - Gold: occupied — shows elapsed time, waiter name, item count, total
  - Red: needs attention
- Tap available table → create order → go to Table Detail
- Tap occupied table → go to Table Detail for that order

### Edit Mode
- Tables become draggable
- Resize handles on selection
- Shape toggle (rect/circle)
- Label editing
- Add/delete tables
- Save positions to backend on drop

---

## Screen 3: Table Detail (Order Workspace)

Full-screen, three-column layout. Opens when tapping a table or order row.

### Back Bar (top)
- Back arrow + "Table X · Main Dining" (or "Takeout #XX")
- Order # and status badge
- Timer showing elapsed time
- Waiter name

### Left Column (~25%): Category Nav + Product Grid
- Vertical category list (text buttons, selected = gold highlight)
- Product cards in a scrollable grid:
  - Product name, price
  - Color-coded left border or icon
  - Tap → variant picker if variants exist → modifier picker if required → add to ticket

### Center Column (~40%): Current Ticket
- Header: "Current Ticket" with item count
- Item list:
  - Quantity × Product name + variant
  - Modifiers indented below (smaller text, with +price)
  - Notes in italic
  - Quantity stepper (+/-)
  - Remove button (X) — only for CASHIER role
  - Sent status checkmark per item
- "Send to Kitchen" button (prominent, with printer icon)
  - Only sends unsent items
  - After sending, items show sent checkmark
- "Add Note" capability per item

### Right Column (~35%): Payment & Summary
- Order summary card:
  - Subtotal
  - Tax (IVA %)
  - Discount (if applied)
  - Total (large, prominent)
- Discount button (if cashier)
- Payment section:
  - Method selector: Cash | Card | Transfer (toggle buttons)
  - For cash: amount input + quick buttons ($50, $100, $200, $500, Exact)
  - Change calculation (live)
  - For card/transfer: reference field
  - "Complete Payment" button (full width, gold)
- Split payment support: "Split" button adds another payment method row
- Actions: Hold | Cancel Order (with confirmation)

---

## Screen 4: Order History

Searchable list of completed orders.

### Header
- Title: "Order History"
- Subtitle: showing date range
- Filter toolbar: date range picker, status pills (All | Paid | Cancelled), search

### Order Table
- Columns: Order #, Table, Waiter, Items, Total, Payment method, Status (badge), Time
- Click row → expand inline with item details

---

## Screen 5: Settings (Modal)

Opens as a centered modal overlay with left nav + right content.

### Left Navigation Sections
- General (business info, language)
- Appearance (theme, display preferences)  
- Printers (receipt + kitchen printer config)
- Users (PIN management)
- Register (shift settings)

### Printer Settings
- Receipt Printer: connection type, address, paper width, test print button
- Kitchen Printer: same options
- Connection status indicator (green dot = connected)

---

## Authentication: PIN Login

- Full screen PIN entry on app launch
- Number pad with large buttons (0-9)
- PIN field shows dots
- Backspace/clear buttons
- On success: route to default view based on role
- Lock button in top bar → return to PIN screen (register stays open)
- Auto-lock after configurable idle time

---

## Role Permissions

### Waiter
- View floor plan, create orders, add items, modify own items, send to kitchen
- CANNOT: delete items, cancel orders, process payments, open/close register

### Cashier
- All waiter permissions + delete items, cancel orders, apply discounts, process payments, open/close register

### Admin
- All cashier permissions, no restrictions

---

## Kitchen Printing (ESC/POS)

### Send to Kitchen flow:
1. Cashier/waiter taps "Send to Kitchen"
2. System calls POST /orders/:id/send-to-kitchen
3. Only unsent items are marked as sent
4. Comanda prints on kitchen printer (only new items)
5. Sent items show checkmark in the ticket

### Comanda format:
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
1x Club Sandwich
   NOTE: No tomato
================================
```

### Receipt format:
```
================================
      [Business Name]
================================
Order #: 42
Date: 2026-04-25  14:52
Cashier: Daniel    Table: 5
--------------------------------
2  Latte Grande        $150.00
   Almond Milk  +$20.00
   Extra Shot   +$30.00
1  Club Sandwich        $95.00
--------------------------------
Subtotal:             $254.31
IVA 16%:               $40.69
Total:                $295.00
Cash:                 $300.00
Change:                 $5.00
================================
```

### Printer IPC:
```typescript
// Renderer → Main process
window.electron.printKitchen(orderData)
window.electron.printReceipt(orderData)
window.electron.getPrinterStatus()
```

---

## Backend Additions Required

### New/modified fields:
- OrderItem: sent_to_kitchen (Boolean), sent_at (DateTime?), added_by (UUID?)
- Table: pos_x, pos_y, width, height, shape, label, rotation

### Endpoints:
- POST /api/v1/auth/pin-login
- POST /api/v1/orders/:id/send-to-kitchen
- GET /api/v1/orders/active
- GET /api/v1/floors
- requireRole middleware for waiter/cashier restrictions

---

## Implementation Phases

### Terminal Phase 1: Scaffold + Top Bar + PIN Login
Electron + Vite + React setup, design system from wireframe CSS, top bar with navigation, PIN login, API client, routing between views.

### Terminal Phase 2: Active Orders + Floor Plan
Active Orders control center with zone sections, expandable rows, time-based colors. Floor Plan with table canvas, status colors, tap to open order.

### Terminal Phase 3: Table Detail (Order Workspace)
Three-column order page: category nav + product grid, ticket with modifiers and send-to-kitchen, payment panel with cash/card/split.

### Terminal Phase 4: Kitchen + Receipt Printing
ESC/POS printer integration, IPC bridge, send-to-kitchen flow with tracking, receipt printing on payment.

### Terminal Phase 5: History + Settings + Polish
Order history with filters, settings modal with printer config, role permissions enforcement, auto-lock.
