/**
 * Single source of truth for sidebar nav + router paths.
 * Matches the NAV array in mockup.html but mapped to real URLs.
 */

export interface NavSingle {
  kind: 'single';
  id: string;
  label: string;
  icon: string;
  path: string;
}

export interface NavGroup {
  kind: 'group';
  id: string;
  label: string;
  icon: string;
  items: { id: string; label: string; path: string }[];
}

export type NavEntry = NavSingle | NavGroup;

export const NAV: NavEntry[] = [
  {
    kind: 'single',
    id: 'dashboard',
    label: 'Dashboard',
    icon: '◈',
    path: '/',
  },
  {
    kind: 'group',
    id: 'reportes',
    label: 'Reportes',
    icon: '📊',
    items: [
      { id: 'sales',          label: 'Ventas',              path: '/reports/sales' },
      { id: 'orders-report',  label: 'Órdenes',             path: '/reports/orders' },
      { id: 'products-sold',  label: 'Productos vendidos',  path: '/reports/products-sold' },
      { id: 'expenses',       label: 'Gastos e ingresos',   path: '/reports/expenses' },
    ],
  },
  {
    kind: 'group',
    id: 'inventario',
    label: 'Inventario',
    icon: '📦',
    items: [
      { id: 'supplies',  label: 'Insumos',      path: '/inventory/supplies' },
      { id: 'movements', label: 'Movimientos',  path: '/inventory/movements' },
      { id: 'suppliers', label: 'Proveedores',  path: '/inventory/suppliers' },
    ],
  },
  {
    kind: 'group',
    id: 'menu',
    label: 'Menú',
    icon: '🍽',
    items: [
      { id: 'products',   label: 'Productos',  path: '/menu/products' },
      { id: 'categories', label: 'Categorías', path: '/menu/categories' },
    ],
  },
  {
    kind: 'group',
    id: 'personal',
    label: 'Personal',
    icon: '👥',
    items: [
      { id: 'employees', label: 'Empleados',     path: '/staff/employees' },
      { id: 'cash',      label: 'Caja / Turnos', path: '/staff/cash-registers' },
    ],
  },
  {
    kind: 'group',
    id: 'sistema',
    label: 'Sistema',
    icon: '⚙',
    items: [
      { id: 'settings', label: 'Configuración', path: '/settings' },
    ],
  },
];

/** Find the breadcrumb group + label for a given path. */
export function findBreadcrumb(pathname: string): { label: string; group?: string } {
  for (const entry of NAV) {
    if (entry.kind === 'single' && entry.path === pathname) {
      return { label: entry.label };
    }
    if (entry.kind === 'group') {
      const match = entry.items.find(
        (item) => item.path === pathname || pathname.startsWith(item.path + '/'),
      );
      if (match) return { label: match.label, group: entry.label };
    }
  }
  return { label: 'Admin' };
}
