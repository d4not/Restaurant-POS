# Admin Panel Frontend — Specification

> React + Vite + TypeScript frontend for the Restaurant POS admin panel.
> Must match the warm, elegant design from the existing HTML mockup (index.html in project root).

---

## Tech Stack
- React 18+ with TypeScript (strict)
- Vite for build/dev
- React Router v6 for routing
- TanStack Query (React Query) for server state / API calls
- Zustand for client state (auth, sidebar, UI preferences)
- Recharts for charts (lightweight, React-native)
- date-fns for date formatting (Spanish locale)
- No UI framework (Tailwind, MUI, etc.) — custom CSS matching the mockup's design system

## Design System (from mockup)
Extract and maintain these design tokens as CSS variables:
```css
--bg:       rgb(245, 240, 232)   /* warm cream background */
--bg2:      #fff                  /* card/surface background */
--text1:    #2c2420               /* primary text - warm dark brown */
--text2:    #6b5e54               /* secondary text */
--text3:    #a89888               /* muted text */
--gold:     #c9a45c               /* accent / highlights */
--green:    #4a8c5c               /* positive / success */
--red:      #c45040               /* negative / danger */
--border:   #e2dcd4               /* borders and dividers */
--sidebar:  #2c2420               /* sidebar dark background */
```
- Fonts: Playfair Display (headings) + DM Sans (body)
- Border radius: 10px for cards, 6px for inputs/buttons
- Shadows: minimal, warm-toned (rgba(44,36,32,0.06))
- No harsh whites or blues — everything stays warm

## Project Structure
```
admin/
├── src/
│   ├── api/             — API client, endpoint functions, types
│   │   ├── client.ts    — fetch wrapper with auth headers, base URL, error handling
│   │   ├── supplies.ts  — supply CRUD functions
│   │   ├── products.ts  — product CRUD functions
│   │   ├── orders.ts    — order functions
│   │   └── ...
│   ├── components/      — reusable UI components
│   │   ├── layout/      — Sidebar, Topbar, PageLayout
│   │   ├── ui/          — Button, Badge, Card, Table, Modal, KPICard, EmptyState
│   │   ├── forms/       — Input, Select, SearchInput, DatePicker
│   │   └── charts/      — BarChart, MiniBar, PieChart wrappers
│   ├── pages/           — one file per route/section
│   │   ├── Dashboard.tsx
│   │   ├── inventory/
│   │   │   ├── SuppliesPage.tsx
│   │   │   ├── SupplyDetail.tsx
│   │   │   ├── SuppliersPage.tsx
│   │   │   └── MovementsPage.tsx
│   │   ├── menu/
│   │   │   ├── ProductsPage.tsx
│   │   │   └── CategoriesPage.tsx
│   │   ├── orders/
│   │   │   └── OrdersPage.tsx
│   │   ├── staff/
│   │   │   ├── EmployeesPage.tsx
│   │   │   └── CashRegistersPage.tsx
│   │   ├── reports/
│   │   │   ├── SalesReport.tsx
│   │   │   ├── OrdersReport.tsx
│   │   │   ├── ProductsSoldReport.tsx
│   │   │   └── ExpensesReport.tsx
│   │   └── settings/
│   │       └── SettingsPage.tsx
│   ├── hooks/           — custom hooks (useSupplies, useProducts, etc.)
│   ├── store/           — Zustand stores (auth, ui)
│   ├── types/           — TypeScript types matching API responses
│   ├── utils/           — formatCurrency, formatDate, etc.
│   ├── App.tsx          — router setup
│   ├── main.tsx         — entry point
│   └── index.css        — global styles + design tokens
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Pages & Features

### Sidebar Navigation (always visible)
Matches the mockup structure:
- ◈ Dashboard (single item)
- 📊 Reportes (collapsible group)
  - Ventas
  - Órdenes
  - Productos vendidos
  - Gastos e ingresos
- 📦 Inventario
  - Insumos
  - Movimientos
  - Proveedores
- 🍽 Menú
  - Productos
  - Categorías
- 👥 Personal
  - Empleados
  - Caja / Turnos
- ⚙ Sistema
  - Configuración

Bottom of sidebar: logged-in user avatar, name, role, active shift info.

### Dashboard
- KPI cards row: Ventas hoy, Órdenes hoy, Ticket promedio, Insumos bajo stock
- Chart: Ventas últimos 7 días (bar chart)
- Recent orders table (last 10)
- Low stock alerts list

### Inventory > Insumos
- Table with: nombre, categoría, unidad, stock (across storages), costo promedio, estado
- Filters: categoría, búsqueda por nombre, mostrar inactivos
- Actions: + Nuevo insumo (modal/drawer)
- Click row → detail page: info, stock por almacén, historial de movimientos, tara

### Inventory > Proveedores
- Table: nombre, contacto, teléfono, días crédito, estado
- CRUD modal
- Click row → detail: purchases from this supplier

### Inventory > Movimientos
- Table: fecha, insumo, almacén, tipo (badge color), cantidad, costo, referencia
- Filters: tipo, almacén, insumo, rango de fechas

### Menu > Productos
- Grid or table view (toggle)
- Show: imagen/color, nombre, tipo (badge), categoría, precio, food cost %, estado
- Filters: categoría, tipo (PRODUCT/DISH/PREPARATION), activos
- Click → detail: variantes, modificadores, receta con costos
- Edit recipe inline: add/remove ingredients, see cost update live

### Menu > Categorías
- Tree view showing parent/child hierarchy
- Drag to reorder (display_order)
- CRUD inline or modal

### Staff > Caja / Turnos
- Current shift status (if open)
- History table: fecha, usuario, apertura, esperado, real, diferencia (color-coded)
- Click → detail: orders in that shift, cash movements

### Reports > Ventas
- Date range picker
- KPIs: total ventas, # órdenes, ticket promedio, método de pago breakdown
- Chart: ventas por hora del día
- Table: ventas por producto

### Reports > Gastos e ingresos (matches the mockup exactly)
- KPIs: Ingresos del mes, Gastos del mes, Utilidad neta
- Chart: Ingresos vs Gastos últimos 6 meses
- Expense breakdown mini bars
- Table: gastos registrados

## API Integration Patterns

### API Client (src/api/client.ts)
```typescript
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error);
  return json.data;
}
```

### TanStack Query pattern
```typescript
// hooks/useSupplies.ts
export function useSupplies(filters?: SupplyFilters) {
  return useQuery({
    queryKey: ['supplies', filters],
    queryFn: () => getSupplies(filters),
  });
}

export function useCreateSupply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSupply,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supplies'] }),
  });
}
```

### Currency formatting
```typescript
// utils/format.ts
export function formatMoney(centavos: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN'
  }).format(centavos / 100);
}
```

## Implementation Phases

### Frontend Phase 1: Foundation
- Vite + React + TypeScript setup
- Design system (CSS variables, global styles matching mockup)
- Layout components: Sidebar, Topbar, PageLayout
- Routing with React Router
- API client with auth
- Zustand auth store
- Login page (email + password)
- Protected routes wrapper

### Frontend Phase 2: Inventory Pages
- Supplies list page with table, filters, pagination
- Supply detail page
- Suppliers list + CRUD modal
- Stock movements list with filters
- Reusable Table, Modal, Badge, KPICard components built here

### Frontend Phase 3: Menu Pages
- Products list page (table + grid view toggle)
- Product detail with variants, modifiers, recipe editor
- Categories tree view
- Recipe cost visualization

### Frontend Phase 4: Orders & Cash Register
- Orders list with status filters
- Order detail view
- Cash register page (current shift, history)
- Cash movement log

### Frontend Phase 5: Reports & Dashboard
- Dashboard with KPIs and charts
- Sales report page
- Expenses & income page (matching the mockup exactly)
- Products sold report
- Use Recharts for all visualizations
