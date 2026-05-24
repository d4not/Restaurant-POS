// The Launchpad surface. Two modes:
//   • Root view  — narrative cell on top, always-visible palette entry in the
//                  middle, compact horizontal row of section cards below.
//                  Replaces the previous centre-greeting grid (where the
//                  greeting carried no actionable information and the cards
//                  competed for attention).
//   • Section view — when a section is picked, render that section's tiles in
//                    the regular 3-col grid behind a slim breadcrumb.
//
// Focus / keyboard model
//   • On mount and on every mode switch, focus lands on the first enabled
//     cell so the operator can press 1-N or Enter without a pointer.
//   • Arrow keys walk the current grid: left/right across the section row
//     (single row of 5), 3-col spatial walk in drilled sections.
//   • '/' anywhere outside an input focuses the palette entry.
//   • 1-N is handled at the AdminMode level and resolves against whichever
//     grid is currently visible.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AdminCurrentRegister } from './AdminMode';
import { adminStyles } from './styles';
import {
  ADMIN_SECTIONS,
  canUseTile,
  findSectionById,
  tilesInSection,
  type AdminSection,
  type AdminSectionDef,
  type AdminSubView,
  type AdminTileDef,
} from './tiles';
import { AdminTile } from './AdminTile';
import { MiniSectionCard } from './MiniSectionCard';
import { LauncherNarrative } from './LauncherNarrative';
import { PaletteEntry } from './PaletteEntry';
import { IconChevronLeft } from '../Icons';
import { useSession } from '../../store/session';
import { useTranslation } from '../../i18n';
import { formatTime } from '../../utils/clock';
import {
  CatalogLive,
  InventoryLive,
  LockedHint,
  OperationsLive,
  PeopleLive,
  ReportsLive,
  SystemLive,
  operationsIsCta,
} from './sectionLive';

interface AdminLauncherProps {
  /** Currently open register, fed in from AdminMode (React Query cache). */
  currentRegister: AdminCurrentRegister | null;
  /** True while the register query is still loading. Lets the Operations
   *  card render a skeleton instead of guessing "no shift open". */
  currentRegisterLoading: boolean;
  /** Which section the operator drilled into, if any. `null` = root grid. */
  activeSection: AdminSection | null;
  onPickSection: (section: AdminSection) => void;
  onLeaveSection: () => void;
  onActivateTile: (tile: AdminTileDef) => void;
  /** Open the ⌘K command palette. Wired by the palette entry component. */
  onOpenPalette: () => void;
  /** Jump straight to a sub-view, bypassing the section drill-down. Used by
   *  the low-stock alert click in the narrative cell. */
  onJumpToView: (view: AdminSubView) => void;
  /** True when a modal / picker / palette is open. The launcher then stops
   *  handling keyboard input so we don't double-process keys. */
  inputBlocked: boolean;
}

type Cell =
  | { kind: 'section'; section: AdminSectionDef; enabled: boolean }
  | { kind: 'tile'; tile: AdminTileDef; enabled: boolean };

// Spatial coordinates for arrow-key nav. Root view is now a single
// horizontal row of section cards; left/right walks the row directly.
// Drilled-down sections use a regular 3-col grid.
function getCellPositions(
  count: number,
  isRoot: boolean,
): ReadonlyArray<readonly [number, number]> {
  if (isRoot) {
    // Single row: row 0, column = index.
    return Array.from({ length: count }, (_, i) => [0, i] as const);
  }
  // Drilled section: 3-col walk.
  return Array.from({ length: count }, (_, i) => [Math.floor(i / 3), i % 3] as const);
}

function moveSpatially(
  positions: ReadonlyArray<readonly [number, number]>,
  cells: ReadonlyArray<Cell>,
  fromIdx: number,
  direction: 'Up' | 'Down' | 'Left' | 'Right',
): number {
  const from = positions[fromIdx];
  if (!from) return fromIdx;
  const [row, col] = from;
  let best = fromIdx;
  let bestScore = Infinity;
  for (let i = 0; i < positions.length; i += 1) {
    if (i === fromIdx) continue;
    if (!cells[i]?.enabled) continue;
    const [r, c] = positions[i];
    const dr = r - row;
    const dc = c - col;
    if (direction === 'Up' && dr >= 0) continue;
    if (direction === 'Down' && dr <= 0) continue;
    if (direction === 'Left' && dc >= 0) continue;
    if (direction === 'Right' && dc <= 0) continue;
    // Prefer movement in the primary axis; secondary axis only breaks ties.
    const primary =
      direction === 'Up' || direction === 'Down' ? Math.abs(dr) : Math.abs(dc);
    const secondary =
      direction === 'Up' || direction === 'Down' ? Math.abs(dc) : Math.abs(dr);
    const score = primary * 100 + secondary;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

// Translator type — accept any string return so we don't pull TranslationKey
// types through the launcher's render path.
type Translator = (key: string, ...args: unknown[]) => string;

// Render the live-status block per section. Role-locked cards show a quiet
// "Manager and admin" label instead of triggering a query.
function renderSectionLive(
  section: AdminSection,
  enabled: boolean,
  currentRegister: AdminCurrentRegister | null,
  currentRegisterLoading: boolean,
  t: Translator,
): ReactNode {
  if (!enabled) {
    // Only people and system are role-gated on this launcher today; default
    // to the cashier+ label for any future locked section.
    const lockKey =
      section === 'people' || section === 'system' || section === 'catalog'
        ? 'admin.live.locked.managerPlus'
        : 'admin.live.locked.cashierPlus';
    return <LockedHint label={t(lockKey)} />;
  }
  switch (section) {
    case 'operations':
      return (
        <OperationsLive
          currentRegister={currentRegister}
          loading={currentRegisterLoading}
        />
      );
    case 'reports':
      return <ReportsLive />;
    case 'inventory':
      return <InventoryLive />;
    case 'people':
      return <PeopleLive />;
    case 'catalog':
      return <CatalogLive />;
    case 'system':
      return <SystemLive />;
    default:
      return null;
  }
}

export function AdminLauncher({
  currentRegister,
  currentRegisterLoading,
  activeSection,
  onPickSection,
  onLeaveSection,
  onActivateTile,
  onOpenPalette,
  onJumpToView,
  inputBlocked,
}: AdminLauncherProps) {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const role = user?.role ?? 'WAITER';

  // Flat cell list backing the shared arrow-key focus model. Membership
  // depends on the current mode (section grid vs section drill-down).
  const cells: Cell[] = useMemo(() => {
    if (activeSection === null) {
      return ADMIN_SECTIONS.map((section) => ({
        kind: 'section' as const,
        section,
        // A section is enabled if the operator can use at least one of its
        // tiles. Locked sections still render (so power-users learn what
        // lives where) but the card is disabled.
        enabled: tilesInSection(section.id).some((tile) => canUseTile(tile, role)),
      }));
    }
    return tilesInSection(activeSection).map((tile) => ({
      kind: 'tile' as const,
      tile,
      enabled: canUseTile(tile, role),
    }));
  }, [activeSection, role]);

  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const initialIndex = useMemo(() => {
    const idx = cells.findIndex((c) => c.enabled);
    return idx === -1 ? 0 : idx;
  }, [cells]);

  const [activeIndex, setActiveIndex] = useState<number>(initialIndex);

  // Re-seat focus whenever the cell set changes so the operator never lands
  // on a locked cell after drilling in or out.
  useEffect(() => {
    setActiveIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    const node = cellRefs.current[activeIndex];
    node?.focus({ preventScroll: false });
  }, [activeIndex, cells]);

  // Arrow navigation only — 1-N hotkeys live in AdminMode so the section /
  // tile resolution stays in one place. Root view is a single horizontal
  // row of 5 cards; drill-down uses a 3-col grid.
  const positions = useMemo(
    () => getCellPositions(cells.length, activeSection === null),
    [cells.length, activeSection],
  );

  useEffect(() => {
    if (inputBlocked) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;
      if (key === 'ArrowRight' || key === 'ArrowLeft' || key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((idx) => {
          const dir = key.slice(5) as 'Up' | 'Down' | 'Left' | 'Right';
          return moveSpatially(positions, cells, idx, dir);
        });
        return;
      }

      if (key === 'Home') {
        e.preventDefault();
        const first = cells.findIndex((c) => c.enabled);
        if (first >= 0) setActiveIndex(first);
        return;
      }
      if (key === 'End') {
        e.preventDefault();
        for (let i = cells.length - 1; i >= 0; i -= 1) {
          if (cells[i].enabled) {
            setActiveIndex(i);
            return;
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputBlocked, cells, positions]);

  const shiftOpen = Boolean(currentRegister);

  const shiftHintForTile = shiftOpen
    ? t('admin.tile.shiftHint.open').replace(
        '{time}',
        currentRegister?.opened_at
          ? formatTime(new Date(currentRegister.opened_at))
          : '—',
      )
    : t('admin.tile.shiftHint.closed');

  // ─── Render: root view (narrative · palette entry · section row) ───
  if (activeSection === null) {
    return (
      <div className="admin-launcher-root">
        <LauncherNarrative
          currentRegister={currentRegister}
          currentRegisterLoading={currentRegisterLoading}
          onJumpToView={onJumpToView}
        />

        <PaletteEntry onOpen={onOpenPalette} disabled={inputBlocked} />

        <div
          className="admin-section-row"
          role="grid"
          aria-label={t('admin.title')}
        >
          {cells.map((cell, i) => {
            if (cell.kind !== 'section') return null;
            const isCta =
              cell.section.id === 'operations' &&
              cell.enabled &&
              operationsIsCta(currentRegister, currentRegisterLoading);
            return (
              <MiniSectionCard
                key={cell.section.id}
                ref={(node) => {
                  cellRefs.current[i] = node;
                }}
                section={cell.section}
                number={i + 1}
                disabled={!cell.enabled}
                cta={isCta}
                live={renderSectionLive(
                  cell.section.id,
                  cell.enabled,
                  currentRegister,
                  currentRegisterLoading,
                  t,
                )}
                index={i}
                onClick={() => onPickSection(cell.section.id)}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Render: section drill-down ───────────────────────────────────────
  const sectionDef = findSectionById(activeSection);
  const crumbTitle = sectionDef ? t(sectionDef.titleKey) : '';

  return (
    <>
      <div className="admin-mount-fade" style={adminStyles.crumbBlock}>
        <button
          type="button"
          style={adminStyles.crumbBack}
          onClick={onLeaveSection}
          aria-label={t('admin.section.back')}
        >
          <IconChevronLeft style={{ fontSize: 16 }} />
          <span>{t('admin.section.back')}</span>
        </button>
        <span style={adminStyles.crumbTrail}>
          <span style={adminStyles.crumbRoot}>{t('admin.section.crumb')}</span>
          <span aria-hidden="true" style={adminStyles.crumbDot}>
            ·
          </span>
          <span style={adminStyles.crumbCurrent}>{crumbTitle}</span>
        </span>
      </div>

      <div style={adminStyles.body}>
        <div style={adminStyles.tileGrid}>
          {cells.map((cell, i) => {
            if (cell.kind !== 'tile') return null;
            const isShiftTile = cell.tile.id === 'shift';
            const hintOverride = isShiftTile ? shiftHintForTile : undefined;
            const statusDotColor = isShiftTile
              ? shiftOpen
                ? 'var(--green)'
                : 'var(--text3)'
              : undefined;
            return (
              <AdminTile
                key={cell.tile.id}
                ref={(node) => {
                  cellRefs.current[i] = node;
                }}
                tile={cell.tile}
                index={i}
                disabled={!cell.enabled}
                hintOverride={hintOverride}
                statusDotColor={statusDotColor}
                onClick={() => onActivateTile(cell.tile)}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
