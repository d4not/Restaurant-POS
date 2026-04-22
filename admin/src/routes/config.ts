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
    id: 'reports',
    label: 'Reports',
    icon: '📊',
    items: [
      { id: 'sales',          label: 'Sales',              path: '/reports/sales' },
      { id: 'product-costs',  label: 'Product costs',      path: '/reports/product-costs' },
      { id: 'expenses',       label: 'Expenses & Income',  path: '/reports/expenses' },
    ],
  },
  {
    kind: 'single',
    id: 'orders',
    label: 'Orders',
    icon: '🧾',
    path: '/orders',
  },
  {
    kind: 'group',
    id: 'inventory',
    label: 'Inventory',
    icon: '📦',
    items: [
      { id: 'supplies',  label: 'Supplies',        path: '/inventory/supplies' },
      { id: 'movements', label: 'Movements',       path: '/inventory/movements' },
      { id: 'purchases', label: 'Purchase Orders', path: '/inventory/purchases' },
      { id: 'suppliers', label: 'Suppliers',       path: '/inventory/suppliers' },
    ],
  },
  {
    kind: 'group',
    id: 'menu',
    label: 'Menu',
    icon: '🍽',
    items: [
      { id: 'products',         label: 'Products',         path: '/menu/products' },
      { id: 'modifier-groups',  label: 'Modifier Groups',  path: '/menu/modifier-groups' },
      { id: 'categories',       label: 'Categories',       path: '/menu/categories' },
    ],
  },
  {
    kind: 'group',
    id: 'staff',
    label: 'Staff',
    icon: '👥',
    items: [
      { id: 'employees', label: 'Employees',      path: '/staff/employees' },
      { id: 'cash',      label: 'Cash Registers', path: '/staff/cash-registers' },
    ],
  },
  {
    kind: 'group',
    id: 'system',
    label: 'System',
    icon: '⚙',
    items: [
      { id: 'settings', label: 'Settings', path: '/settings' },
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
