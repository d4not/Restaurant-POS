/**
 * Single source of truth for sidebar nav + router paths.
 * Matches the NAV array in mockup.html but mapped to real URLs.
 *
 * Labels are i18n keys (resolved at render time) instead of literal strings so
 * a language switch updates the sidebar without remounting the layout.
 */

import type { TranslationKey } from '../i18n/en';

export interface NavSingle {
  kind: 'single';
  id: string;
  labelKey: TranslationKey;
  icon: string;
  path: string;
}

export interface NavGroup {
  kind: 'group';
  id: string;
  labelKey: TranslationKey;
  icon: string;
  items: { id: string; labelKey: TranslationKey; path: string }[];
}

export type NavEntry = NavSingle | NavGroup;

export const NAV: NavEntry[] = [
  {
    kind: 'single',
    id: 'dashboard',
    labelKey: 'nav.dashboard',
    icon: '◈',
    path: '/',
  },
  {
    kind: 'group',
    id: 'reports',
    labelKey: 'nav.reports',
    icon: '📊',
    items: [
      { id: 'sales',          labelKey: 'nav.salesReport',   path: '/reports/sales' },
      { id: 'products-sold',  labelKey: 'nav.productsSold',  path: '/reports/products-sold' },
      { id: 'product-costs',  labelKey: 'nav.productCosts',  path: '/reports/product-costs' },
      { id: 'expenses',       labelKey: 'nav.expenses',      path: '/reports/expenses' },
      { id: 'daily-reports',  labelKey: 'nav.dailyReports',  path: '/reports/daily' },
    ],
  },
  {
    kind: 'single',
    id: 'orders',
    labelKey: 'nav.orders',
    icon: '🧾',
    path: '/orders',
  },
  {
    kind: 'group',
    id: 'inventory',
    labelKey: 'nav.inventory',
    icon: '📦',
    items: [
      { id: 'supplies',  labelKey: 'nav.supplies',  path: '/inventory/supplies' },
      { id: 'movements', labelKey: 'nav.movements', path: '/inventory/movements' },
      { id: 'purchases', labelKey: 'nav.purchases', path: '/inventory/purchases' },
      { id: 'suppliers', labelKey: 'nav.suppliers', path: '/inventory/suppliers' },
    ],
  },
  {
    kind: 'group',
    id: 'menu',
    labelKey: 'nav.menu',
    icon: '🍽',
    items: [
      { id: 'products',          labelKey: 'nav.products',         path: '/menu/products' },
      { id: 'modifier-groups',   labelKey: 'nav.modifierGroups',   path: '/menu/modifier-groups' },
      { id: 'categories',        labelKey: 'nav.categories',       path: '/menu/categories' },
      { id: 'employee-products', labelKey: 'nav.employeeProducts', path: '/menu/employee-products' },
    ],
  },
  {
    kind: 'group',
    id: 'staff',
    labelKey: 'nav.staff',
    icon: '👥',
    items: [
      { id: 'employees', labelKey: 'nav.employees',     path: '/staff/employees' },
      { id: 'cash',      labelKey: 'nav.cashRegisters', path: '/staff/cash-registers' },
    ],
  },
  {
    kind: 'group',
    id: 'system',
    labelKey: 'nav.system',
    icon: '⚙',
    items: [
      { id: 'tables-zones',    labelKey: 'nav.tablesZones',    path: '/system/tables-zones' },
      { id: 'storages',        labelKey: 'nav.storages',       path: '/system/storages' },
      { id: 'report-template', labelKey: 'nav.reportTemplate', path: '/system/report-template' },
      { id: 'settings',        labelKey: 'nav.settings',       path: '/settings' },
    ],
  },
];

/** Find the breadcrumb group + label for a given path. Returns the i18n keys
 *  that the caller should resolve via t(). */
export function findBreadcrumb(pathname: string): {
  labelKey: TranslationKey;
  groupKey?: TranslationKey;
} {
  for (const entry of NAV) {
    if (entry.kind === 'single' && entry.path === pathname) {
      return { labelKey: entry.labelKey };
    }
    if (entry.kind === 'group') {
      const match = entry.items.find(
        (item) => item.path === pathname || pathname.startsWith(item.path + '/'),
      );
      if (match) return { labelKey: match.labelKey, groupKey: entry.labelKey };
    }
  }
  return { labelKey: 'topbar.admin' };
}
