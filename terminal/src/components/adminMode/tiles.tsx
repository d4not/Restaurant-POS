// Single source of truth for Admin Mode tiles. The launcher renders this
// grouped by section, the command palette searches over it, and the hotkey
// handler reads `number` (section-local, 1-N) once a section is open.
//
// Adding a tile?
//   1. Append an entry below in the right section (order = visual order).
//   2. Set `number` to its 1-based slot within its section.
//   3. Add the i18n keys for `titleKey` and `hintKey` to en.ts + es.ts.
//   4. If `action.kind === 'view'`, add a view component to ./views and
//      register it in AdminMode.tsx's sub-view switch.
//
// Adding a section? Append to ADMIN_SECTIONS and SECTION_KEYS below.

import type { ComponentType, SVGProps } from 'react';
import {
  IconRegister,
  IconChart,
  IconTransfer,
  IconArrowUp,
} from '../operations-hub/HubIcons';
import {
  IconTrendUp,
  IconRanking,
  IconCoins,
  IconRecipe,
  IconBox,
  IconSparkle,
  IconUsers,
  IconCalendarCheck,
  IconWallet,
  IconPlusCircle,
  IconClipboard,
  IconTruck,
  IconScale,
  IconDrop,
  IconList,
  IconTag,
} from './icons';
import type { TranslationKey } from '../../i18n/en';

export type AdminSubView =
  | 'shiftAudit'
  | 'cashLog'
  | 'transferAdvanced'
  | 'suggestedChanges'
  | 'sales'
  | 'productsSold'
  | 'expenses'
  | 'costs'
  | 'suppliesList'
  | 'supplyNew'
  | 'purchaseOrders'
  | 'suppliersList'
  | 'inventoryCount'
  | 'writeOffs'
  | 'stockMovements'
  | 'employees'
  | 'attendance'
  | 'payroll'
  | 'productsList';

export type TileAccent = 'gold' | 'green' | 'red' | 'neutral';

export type TileAction =
  // Only the Daily Report still uses a modal — Shift, Cash and Transfer are
  // admin-grade views now (see AdminSubView ids shiftAudit / cashLog /
  // transferAdvanced).
  | { kind: 'modal'; modal: 'dailyReport' }
  | { kind: 'view'; view: AdminSubView };

export type AdminSection =
  | 'operations'
  | 'reports'
  | 'people'
  | 'catalog'
  | 'inventory'
  | 'system';

export interface AdminTileDef {
  id: string;
  section: AdminSection;
  /** Section-local accelerator (1-N within the parent section). Rendered as a
   *  small badge on the tile and used by the 1-9 hotkey handler once a
   *  section is open. */
  number: number;
  titleKey: TranslationKey;
  /** Optional i18n key for the hint. Tiles that compute their hint at render
   *  time (e.g. shift) can leave this off and let AdminTile interpolate. */
  hintKey?: TranslationKey;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent: TileAccent;
  /** Roles allowed to launch this tile. Tiles outside the user's role are
   *  rendered but disabled — Apple-style, so the operator learns where the
   *  power tools live without being able to misfire. */
  allowedRoles: ReadonlySet<string>;
  action: TileAction;
}

const CASHIER_PLUS = new Set(['CASHIER', 'MANAGER', 'ADMIN']);
const MANAGER_PLUS = new Set(['MANAGER', 'ADMIN']);

// Order here drives the visual order inside a section. `number` is the
// section-local 1-N accelerator — keep it in sync with the entry's slot.
export const ADMIN_TILES: ReadonlyArray<AdminTileDef> = [
  // ─── Operations ──────────────────────────────────────────────────────
  // Admin Operations expose richer variants than the cashier-facing modals
  // in operations-hub: shift audit (not "manage your current shift"),
  // movement log (not "+ one movement"), multi-line transfer with stock
  // suggestions (not "scan one row at a time"). The cashier modals still
  // live in the regular topbar for floor-staff workflows.
  {
    id: 'shift',
    section: 'operations',
    number: 1,
    titleKey: 'admin.tile.shift',
    hintKey: 'admin.tile.shiftAuditHint',
    Icon: IconRegister,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'shiftAudit' },
  },
  {
    id: 'cashMovement',
    section: 'operations',
    number: 2,
    titleKey: 'admin.tile.cashMovement',
    hintKey: 'admin.tile.cashLogHint',
    Icon: IconArrowUp,
    accent: 'green',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'cashLog' },
  },
  {
    id: 'transfer',
    section: 'operations',
    number: 3,
    titleKey: 'admin.tile.transfer',
    hintKey: 'admin.tile.transferAdvancedHint',
    Icon: IconTransfer,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'transferAdvanced' },
  },
  // Pending cashier-proposed changes — order reopens, deletes, payment-method
  // edits, plus any pending table/product suggestions. Manager+ approves or
  // rejects with their PIN. The dedicated tile keeps reviewers from hunting
  // through Order History when there are multiple pending items.
  {
    id: 'suggestedChanges',
    section: 'operations',
    number: 4,
    titleKey: 'admin.tile.suggestedChanges',
    hintKey: 'admin.tile.suggestedChangesHint',
    Icon: IconSparkle,
    accent: 'gold',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'suggestedChanges' },
  },

  // ─── Reports ────────────────────────────────────────────────────────
  {
    id: 'dailyReport',
    section: 'reports',
    number: 1,
    titleKey: 'admin.tile.dailyReport',
    hintKey: 'admin.tile.dailyReportHint',
    Icon: IconChart,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'modal', modal: 'dailyReport' },
  },
  {
    id: 'sales',
    section: 'reports',
    number: 2,
    titleKey: 'admin.tile.sales',
    hintKey: 'admin.tile.salesHint',
    Icon: IconTrendUp,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'sales' },
  },
  {
    id: 'productsSold',
    section: 'reports',
    number: 3,
    titleKey: 'admin.tile.productsSold',
    hintKey: 'admin.tile.productsSoldHint',
    Icon: IconRanking,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'productsSold' },
  },
  {
    id: 'expenses',
    section: 'reports',
    number: 4,
    titleKey: 'admin.tile.expenses',
    hintKey: 'admin.tile.expensesHint',
    Icon: IconCoins,
    accent: 'green',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'expenses' },
  },

  // ─── People ─────────────────────────────────────────────────────────
  // The whole HR surface: roster + payroll + day-by-day attendance. Manager+
  // only because salary changes and PIN resets land here.
  {
    id: 'employees',
    section: 'people',
    number: 1,
    titleKey: 'admin.tile.employees',
    hintKey: 'admin.tile.employeesHint',
    Icon: IconUsers,
    accent: 'gold',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'employees' },
  },
  {
    id: 'attendance',
    section: 'people',
    number: 2,
    titleKey: 'admin.tile.attendance',
    hintKey: 'admin.tile.attendanceHint',
    Icon: IconCalendarCheck,
    accent: 'green',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'attendance' },
  },
  {
    id: 'payroll',
    section: 'people',
    number: 3,
    titleKey: 'admin.tile.payroll',
    hintKey: 'admin.tile.payrollHint',
    Icon: IconWallet,
    accent: 'gold',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'payroll' },
  },

  // ─── System ─────────────────────────────────────────────────────────
  {
    id: 'costs',
    section: 'system',
    number: 1,
    titleKey: 'admin.tile.costs',
    hintKey: 'admin.tile.costsHint',
    Icon: IconRecipe,
    accent: 'neutral',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'costs' },
  },

  // ─── Catalog ────────────────────────────────────────────────────────
  // The customer-facing menu: products, dishes, prices, modifier groups.
  // Manager+ only because pricing changes ripple straight to receipts and
  // accounting; cashiers can read it via the POS but not edit.
  {
    id: 'productsList',
    section: 'catalog',
    number: 1,
    titleKey: 'admin.tile.productsList',
    hintKey: 'admin.tile.productsListHint',
    Icon: IconTag,
    accent: 'gold',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'productsList' },
  },

  // ─── Inventory ──────────────────────────────────────────────────────
  // Each inventory operation gets its own focused workspace — separate
  // tiles for: browsing the catalog (suppliesList), creating SKUs
  // (supplyNew, manager-gated), running purchase orders, managing
  // suppliers, counting stock, logging mermas, and reading the audit log.
  {
    id: 'suppliesList',
    section: 'inventory',
    number: 1,
    titleKey: 'admin.tile.suppliesList',
    hintKey: 'admin.tile.suppliesListHint',
    Icon: IconBox,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'suppliesList' },
  },
  {
    id: 'supplyNew',
    section: 'inventory',
    number: 2,
    titleKey: 'admin.tile.supplyNew',
    hintKey: 'admin.tile.supplyNewHint',
    Icon: IconPlusCircle,
    accent: 'green',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'supplyNew' },
  },
  {
    id: 'purchaseOrders',
    section: 'inventory',
    number: 3,
    titleKey: 'admin.tile.purchaseOrders',
    hintKey: 'admin.tile.purchaseOrdersHint',
    Icon: IconClipboard,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'purchaseOrders' },
  },
  {
    id: 'suppliersList',
    section: 'inventory',
    number: 4,
    titleKey: 'admin.tile.suppliersList',
    hintKey: 'admin.tile.suppliersListHint',
    Icon: IconTruck,
    accent: 'neutral',
    allowedRoles: MANAGER_PLUS,
    action: { kind: 'view', view: 'suppliersList' },
  },
  {
    id: 'inventoryCount',
    section: 'inventory',
    number: 5,
    titleKey: 'admin.tile.inventoryCount',
    hintKey: 'admin.tile.inventoryCountHint',
    Icon: IconScale,
    accent: 'gold',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'inventoryCount' },
  },
  {
    id: 'writeOffs',
    section: 'inventory',
    number: 6,
    titleKey: 'admin.tile.writeOffs',
    hintKey: 'admin.tile.writeOffsHint',
    Icon: IconDrop,
    accent: 'red',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'writeOffs' },
  },
  {
    id: 'stockMovements',
    section: 'inventory',
    number: 7,
    titleKey: 'admin.tile.stockMovements',
    hintKey: 'admin.tile.stockMovementsHint',
    Icon: IconList,
    accent: 'neutral',
    allowedRoles: CASHIER_PLUS,
    action: { kind: 'view', view: 'stockMovements' },
  },
];

export const SECTION_KEYS: Record<AdminSection, TranslationKey> = {
  operations: 'admin.section.operations',
  reports: 'admin.section.reports',
  people: 'admin.section.people',
  catalog: 'admin.section.catalog',
  inventory: 'admin.section.inventory',
  system: 'admin.section.system',
};

// Metadata for the top-level section cards rendered by the launcher when no
// section is selected. Order here = visual order on the root screen and
// drives the 1-N hotkey for picking a section.
export interface AdminSectionDef {
  id: AdminSection;
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  accent: TileAccent;
}

export const ADMIN_SECTIONS: ReadonlyArray<AdminSectionDef> = [
  {
    id: 'operations',
    titleKey: 'admin.section.operations',
    hintKey: 'admin.section.operationsHint',
    Icon: IconRegister,
    accent: 'gold',
  },
  {
    id: 'reports',
    titleKey: 'admin.section.reports',
    hintKey: 'admin.section.reportsHint',
    Icon: IconChart,
    accent: 'green',
  },
  {
    id: 'people',
    titleKey: 'admin.section.people',
    hintKey: 'admin.section.peopleHint',
    Icon: IconUsers,
    accent: 'gold',
  },
  {
    id: 'catalog',
    titleKey: 'admin.section.catalog',
    hintKey: 'admin.section.catalogHint',
    Icon: IconTag,
    accent: 'gold',
  },
  {
    id: 'inventory',
    titleKey: 'admin.section.inventory',
    hintKey: 'admin.section.inventoryHint',
    Icon: IconBox,
    accent: 'red',
  },
  {
    id: 'system',
    titleKey: 'admin.section.system',
    hintKey: 'admin.section.systemHint',
    Icon: IconSparkle,
    accent: 'neutral',
  },
];

export const ACCENT_COLORS: Record<TileAccent, string> = {
  gold: 'var(--gold)',
  green: 'var(--green)',
  red: 'var(--red)',
  neutral: 'var(--text2)',
};

export function tilesInSection(section: AdminSection): AdminTileDef[] {
  return ADMIN_TILES.filter((t) => t.section === section);
}

export function findTileInSection(
  section: AdminSection,
  number: number,
): AdminTileDef | undefined {
  return ADMIN_TILES.find((t) => t.section === section && t.number === number);
}

export function findTileById(id: string): AdminTileDef | undefined {
  return ADMIN_TILES.find((t) => t.id === id);
}

export function findSectionById(id: AdminSection): AdminSectionDef | undefined {
  return ADMIN_SECTIONS.find((s) => s.id === id);
}

export function canUseTile(tile: AdminTileDef, role: string): boolean {
  return tile.allowedRoles.has(role);
}
