// Admin Mode orchestrator. Owns the launcher, the command palette, the
// keyboard model, and the active modal / sub-view state.
//
// Architecture
//   AdminMode (this file)
//   ├─ AdminTopBar         — slim dark band: Back · ADMIN · ⌘K · user
//   ├─ AdminLauncher       — Launchpad grid + arrow-key focus + 1-9 keys
//   │   OR
//   ├─ <SubView>           — full-screen report (ComingSoon for now)
//   ├─ AdminShortcutHints  — footer key-cap row
//   ├─ AdminCommandPalette — overlay, ⌘K / Ctrl+K to open
//   ├─ AdminHelpOverlay    — overlay, ? to open
//   ├─ CashMovementPicker  — overlay, 2-button Income/Expense choice
//   └─ Existing operations-hub modals (Shift, Cash, Daily, Transfer)
//
// Keyboard model
//   - Esc:          back out one step (modal → close; view → launcher; launcher → exit admin)
//   - 1-9:          fire tile (only when no overlay is open)
//   - ↑↓←→:         move tile focus
//   - ⌘K / Ctrl+K:  open palette
//   - ?:            open help
//   - Tile order in tiles.tsx is the canonical numbering.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCurrentRegister, type CashRegisterRow } from '../../api/registers';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { useTranslation } from '../../i18n';
import { AdminTopBar } from './AdminTopBar';
import { AdminLauncher } from './AdminLauncher';
import { AdminShortcutHints } from './AdminShortcutHints';
import { AdminCommandPalette } from './AdminCommandPalette';
import { AdminHelpOverlay } from './AdminHelpOverlay';
import { ComingSoonView } from './views/ComingSoonView';
import { ShiftAuditView } from './views/ShiftAuditView';
import { CashMovementsLogView } from './views/CashMovementsLogView';
import { MultiTransferView } from './views/MultiTransferView';
import { EmployeesView } from './views/EmployeesView';
import { AttendanceView } from './views/AttendanceView';
import { PayrollView } from './views/PayrollView';
import { SuppliesListView } from './views/SuppliesListView';
import { SupplyNewView } from './views/SupplyNewView';
import { PurchaseOrdersView } from './views/PurchaseOrdersView';
import { SuppliersListView } from './views/SuppliersListView';
import { InventoryCountView } from './views/InventoryCountView';
import { WriteOffsView } from './views/WriteOffsView';
import { StockMovementsView } from './views/StockMovementsView';
import { ProductsListView } from './views/ProductsListView';
import { SuggestedChangesView } from './views/SuggestedChangesView';
import { DailyReportModal } from '../operations-hub/DailyReportModal';
import { adminStyles } from './styles';
import './admin.css';
import type { AdminSection, AdminSubView, AdminTileDef } from './tiles';
import {
  ADMIN_SECTIONS,
  SECTION_KEYS,
  canUseTile,
  findTileInSection,
  tilesInSection,
} from './tiles';

// Re-export the register row type under a friendlier name so the launcher
// imports `AdminCurrentRegister` (semantic) instead of `CashRegisterRow`.
export type AdminCurrentRegister = CashRegisterRow;

// Only the Daily Report still uses a modal in admin mode. Shift, Cash, and
// Transfer have admin-grade full-screen views now (see ./views/).
type ActiveModal = 'dailyReport' | null;

const MANAGER_PLUS = new Set(['MANAGER', 'ADMIN']);

export function AdminMode() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const role = user?.role ?? 'WAITER';
  const closeAdmin = useUi((s) => s.closeAdmin);

  // Re-uses the cache key App.tsx primes. No extra round trip in steady state.
  const userId = user?.id ?? null;
  const registerQuery = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    enabled: Boolean(userId),
    staleTime: 15_000,
  });
  const currentRegister = registerQuery.data ?? null;

  const [activeSection, setActiveSection] = useState<AdminSection | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [activeView, setActiveView] = useState<AdminSubView | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Anything that captures keyboard input or eats Esc → the launcher should
  // stop reacting to keystrokes.
  const inputBlocked =
    activeModal !== null || activeView !== null || paletteOpen || helpOpen;

  const activateTile = useCallback(
    (tile: AdminTileDef) => {
      if (!canUseTile(tile, role)) return;
      // Activating a tile closes the palette / help — keeps state coherent.
      setPaletteOpen(false);
      setHelpOpen(false);
      // The palette can fire a tile from any section, so make sure the
      // launcher reflects where we ended up when the modal / view closes.
      setActiveSection(tile.section);
      if (tile.action.kind === 'view') {
        setActiveView(tile.action.view);
        return;
      }
      setActiveModal(tile.action.modal);
    },
    [role],
  );

  const pickSection = useCallback(
    (section: AdminSection) => {
      // Disallow drilling into a section with zero usable tiles for the
      // current role. The card is rendered disabled in that case but we
      // belt-and-suspenders the keyboard path too.
      const anyEnabled = tilesInSection(section).some((tile) =>
        canUseTile(tile, role),
      );
      if (!anyEnabled) return;
      setActiveSection(section);
    },
    [role],
  );

  const leaveSection = useCallback(() => {
    setActiveSection(null);
  }, []);

  // ─── Window-level shortcuts (palette, help, 1-N, Esc back) ──────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't capture keystrokes while the operator is typing.
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      // ⌘K / Ctrl+K → palette, only when nothing is in the way.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        if (activeModal || activeView) return;
        e.preventDefault();
        setHelpOpen(false);
        setPaletteOpen((p) => !p);
        return;
      }

      // ? → help (only outside an input, and only at the launcher).
      if (e.key === '?' && !inField && !activeModal && !activeView) {
        e.preventDefault();
        setPaletteOpen(false);
        setHelpOpen(true);
        return;
      }

      // 1-N hotkeys: resolved against the visible grid (sections at the
      // root, tiles inside a section). Skip when an overlay / modal is up.
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        /^[1-9]$/.test(e.key) &&
        !activeModal &&
        !activeView &&
        !paletteOpen &&
        !helpOpen
      ) {
        const n = Number(e.key);
        if (activeSection === null) {
          const section = ADMIN_SECTIONS[n - 1];
          if (section) {
            const enabled = tilesInSection(section.id).some((tile) =>
              canUseTile(tile, role),
            );
            if (enabled) {
              e.preventDefault();
              pickSection(section.id);
            }
          }
          return;
        }
        const tile = findTileInSection(activeSection, n);
        if (tile && canUseTile(tile, role)) {
          e.preventDefault();
          activateTile(tile);
        }
        return;
      }

      // Esc: at the bare launcher with a section open, walk back to the
      // section grid. Modal / sub-view / palette / help own their own Esc
      // listeners so we don't fight them. Esc at the root launcher is a
      // no-op — the Exit button is the only way out.
      if (
        e.key === 'Escape' &&
        !inField &&
        !activeModal &&
        !activeView &&
        !paletteOpen &&
        !helpOpen &&
        activeSection !== null
      ) {
        e.preventDefault();
        leaveSection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    activeModal,
    activeView,
    paletteOpen,
    helpOpen,
    activeSection,
    role,
    pickSection,
    activateTile,
    leaveSection,
    inputBlocked,
    closeAdmin,
  ]);

  // Gate at the very top: a waiter who somehow lands in admin (e.g. role
  // demotion mid-session) gets bounced out instead of seeing a half-locked
  // launcher.
  useEffect(() => {
    if (!MANAGER_PLUS.has(role)) {
      closeAdmin();
    }
  }, [role, closeAdmin]);

  const registerId = currentRegister?.id ?? null;

  // Don't render the launcher while a sub-view is up — keeps the DOM lean
  // and lets the slide-in animation play against a clean stage.
  const showLauncher = activeView === null;
  const showShortcuts = activeView === null;

  const viewTitleKey = useMemo(() => viewToTitleKey(activeView), [activeView]);

  const crumbs = useMemo(() => {
    const trail: string[] = [];
    if (activeSection) trail.push(t(SECTION_KEYS[activeSection]));
    if (activeView && viewTitleKey) trail.push(t(viewTitleKey));
    return trail;
  }, [activeSection, activeView, viewTitleKey, t]);

  return (
    <div style={adminStyles.shell}>
      <AdminTopBar
        onExit={closeAdmin}
        onOpenPalette={() => setPaletteOpen(true)}
        crumbs={crumbs}
      />

      {showLauncher && (
        <AdminLauncher
          currentRegister={currentRegister}
          currentRegisterLoading={registerQuery.isLoading}
          activeSection={activeSection}
          onPickSection={pickSection}
          onLeaveSection={leaveSection}
          onActivateTile={activateTile}
          onOpenPalette={() => setPaletteOpen(true)}
          onJumpToView={(view) => setActiveView(view)}
          inputBlocked={inputBlocked}
        />
      )}

      {/* ─── Admin sub-views ─────────────────────────────────────────────── */}
      {activeView === 'shiftAudit' && (
        <ShiftAuditView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'cashLog' && (
        <CashMovementsLogView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'transferAdvanced' && (
        <MultiTransferView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'suggestedChanges' && (
        <SuggestedChangesView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'employees' && (
        <EmployeesView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'attendance' && (
        <AttendanceView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'payroll' && (
        <PayrollView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'suppliesList' && (
        <SuppliesListView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'supplyNew' && (
        <SupplyNewView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'purchaseOrders' && (
        <PurchaseOrdersView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'suppliersList' && (
        <SuppliersListView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'inventoryCount' && (
        <InventoryCountView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'writeOffs' && (
        <WriteOffsView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'stockMovements' && (
        <StockMovementsView onBack={() => setActiveView(null)} />
      )}
      {activeView === 'productsList' && (
        <ProductsListView onBack={() => setActiveView(null)} />
      )}
      {activeView !== null &&
        viewTitleKey &&
        !isImplementedView(activeView) && (
          <ComingSoonView
            titleKey={viewTitleKey}
            onBack={() => setActiveView(null)}
          />
        )}

      {showShortcuts && <AdminShortcutHints />}

      {/* ─── Overlays ───────────────────────────────────────────────────── */}
      <AdminCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onActivateTile={activateTile}
      />
      <AdminHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Daily Report is the lone surviving modal in admin mode — Shift,
          Cash and Transfer have their own full-screen views above. */}
      <DailyReportModal
        open={activeModal === 'dailyReport'}
        currentRegisterId={registerId}
        onClose={() => setActiveModal(null)}
      />

      {/* Visually emphasise the locked state when a non-manager somehow
          slips in. Render once, behind the bounce-out effect of the
          gate above, so the operator sees a single beat of context. */}
      {!MANAGER_PLUS.has(role) && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            padding: '6px 12px',
            borderRadius: 8,
            background: 'var(--red-soft)',
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {t('admin.cashierOnly')}
        </div>
      )}
    </div>
  );
}

function viewToTitleKey(view: AdminSubView | null) {
  switch (view) {
    case 'sales':
      return 'admin.tile.sales' as const;
    case 'productsSold':
      return 'admin.tile.productsSold' as const;
    case 'expenses':
      return 'admin.tile.expenses' as const;
    case 'costs':
      return 'admin.tile.costs' as const;
    case 'suppliesList':
      return 'admin.suppliesList.title' as const;
    case 'supplyNew':
      return 'admin.supplyNew.title' as const;
    case 'purchaseOrders':
      return 'admin.purchaseOrders.title' as const;
    case 'suppliersList':
      return 'admin.suppliersList.title' as const;
    case 'inventoryCount':
      return 'admin.inventoryCount.title' as const;
    case 'writeOffs':
      return 'admin.writeOffs.title' as const;
    case 'stockMovements':
      return 'admin.stockMovements.title' as const;
    case 'productsList':
      return 'admin.productsList.title' as const;
    // The implemented views supply their own title via AdminViewShell, so
    // these are placeholders kept for the ComingSoon fallback only.
    case 'shiftAudit':
      return 'admin.shiftAudit.title' as const;
    case 'cashLog':
      return 'admin.cashLog.title' as const;
    case 'transferAdvanced':
      return 'admin.transferAdv.title' as const;
    case 'suggestedChanges':
      return 'admin.tile.suggestedChanges' as const;
    case 'employees':
      return 'employees.title' as const;
    case 'attendance':
      return 'attendance.title' as const;
    case 'payroll':
      return 'payroll.title' as const;
    default:
      return null;
  }
}

// Views with their own full-screen component live in ./views/. The
// ComingSoonView is the placeholder for the rest until those dashboards
// are built (sales / productsSold / expenses / costs / supplies).
function isImplementedView(view: AdminSubView | null): boolean {
  return (
    view === 'shiftAudit' ||
    view === 'cashLog' ||
    view === 'transferAdvanced' ||
    view === 'suggestedChanges' ||
    view === 'employees' ||
    view === 'attendance' ||
    view === 'payroll' ||
    view === 'suppliesList' ||
    view === 'supplyNew' ||
    view === 'purchaseOrders' ||
    view === 'suppliersList' ||
    view === 'inventoryCount' ||
    view === 'writeOffs' ||
    view === 'stockMovements' ||
    view === 'productsList'
  );
}
