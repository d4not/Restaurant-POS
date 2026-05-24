// Live-signal blocks for the principal launcher's section cards.
//
// Each section card on the root launcher renders a glanceable status line
// in place of the static action count. The launcher mounts one component
// per section; each component owns its own query so the launcher stays a
// pure orchestrator. Hooks pass `staleTime: 60_000` and disable focus
// refetches so the launcher (opened between rushes, looked at once) does
// at most one round trip per minute per signal.
//
// Locked-for-role sections render <LockedHint /> instead, which never
// triggers a query.

import { useQuery } from '@tanstack/react-query';
import { useClock } from '../../utils/clock';
import { useTranslation } from '../../i18n';
import { adminStyles } from './styles';
import type { CashRegisterRow } from '../../api/registers';
import { fetchLowStockAlerts } from '../../api/alerts';
import { getDailySummary } from '../../api/reports';
import { listAttendance } from '../../api/attendance';

// ─── Helpers ───────────────────────────────────────────────────────────

function formatCentavos(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '$0';
  const n = typeof input === 'string' ? Number(input) : input;
  if (!Number.isFinite(n)) return '$0';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(n / 100);
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatElapsed(openedAt: string | undefined): string {
  if (!openedAt) return '';
  const ms = Date.now() - new Date(openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return '';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTodayLabel(): string {
  const d = new Date();
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(d);
}

// ─── UI primitives ─────────────────────────────────────────────────────

type DotTone = 'green' | 'gold' | 'red' | 'muted';

const DOT_COLOR: Record<DotTone, string> = {
  green: 'var(--green)',
  gold: 'var(--gold)',
  red: 'var(--red)',
  muted: 'var(--text3)',
};

interface LiveSignalProps {
  dot: DotTone;
  headline: string;
  /** Render the headline as Playfair-muted instead of Playfair-numeric.
   *  Used for non-numeric states like "Stock healthy" or "In good order". */
  headlineMuted?: boolean;
  secondary?: string;
  /** When true the secondary line renders in red+bold (anomaly). */
  secondaryAlert?: boolean;
}

export function LiveSignal({
  dot,
  headline,
  headlineMuted,
  secondary,
  secondaryAlert,
}: LiveSignalProps) {
  return (
    <span style={adminStyles.liveBlock}>
      <span style={adminStyles.liveHeadlineRow}>
        <span
          aria-hidden="true"
          style={{ ...adminStyles.liveDot, background: DOT_COLOR[dot] }}
        />
        <span
          style={headlineMuted ? adminStyles.liveMuted : adminStyles.liveHeadline}
        >
          {headline}
        </span>
      </span>
      {secondary && (
        <span
          style={
            secondaryAlert
              ? adminStyles.liveSecondaryAlert
              : adminStyles.liveSecondary
          }
        >
          {secondary}
        </span>
      )}
    </span>
  );
}

export function LiveSkeleton() {
  return (
    <span style={adminStyles.liveBlock} aria-hidden="true">
      <span
        className="admin-live-skeleton-line"
        style={adminStyles.liveSkeletonHead}
      />
      <span
        className="admin-live-skeleton-line"
        style={adminStyles.liveSkeletonSub}
      />
    </span>
  );
}

export function LockedHint({ label }: { label: string }) {
  return <span style={adminStyles.liveLocked}>{label}</span>;
}

// ─── Operations ───────────────────────────────────────────────────────
// Driven entirely off the already-cached currentRegister query result
// (primed by AdminMode). When the shift is closed, the headline is the
// CTA copy ("Open a shift") and the launcher tints the card gold.

interface OperationsLiveProps {
  currentRegister: CashRegisterRow | null;
  loading: boolean;
}

export function OperationsLive({ currentRegister, loading }: OperationsLiveProps) {
  const { t } = useTranslation();
  // Tick the clock once per minute so the elapsed value reflows on its own.
  // The hook returns a Date we don't consume directly; the re-render is the
  // contract.
  useClock(60_000);

  if (loading) return <LiveSkeleton />;
  if (!currentRegister) {
    return (
      <LiveSignal
        dot="gold"
        headline={t('admin.live.operations.openCta')}
        secondary={t('admin.live.operations.noShift')}
      />
    );
  }

  const elapsed = formatElapsed(currentRegister.opened_at);
  const headline = elapsed
    ? t('admin.live.operations.shiftOpen').replace('{elapsed}', elapsed)
    : t('admin.live.operations.justOpened');

  return (
    <LiveSignal
      dot="green"
      headline={headline}
      secondary={t('admin.live.operations.expected').replace(
        '{amount}',
        formatCentavos(currentRegister.expected_amount),
      )}
    />
  );
}

/** Whether the Operations card should render in CTA mode (gold tint). */
export function operationsIsCta(
  currentRegister: CashRegisterRow | null,
  loading: boolean,
): boolean {
  return !loading && !currentRegister;
}

// ─── Reports ──────────────────────────────────────────────────────────

export function ReportsLive() {
  const { t } = useTranslation();
  const today = todayLocal();
  const q = useQuery({
    queryKey: ['admin-launcher', 'daily-summary', today],
    queryFn: () => getDailySummary({ date: today }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) return <LiveSkeleton />;
  if (q.isError || !q.data) {
    return (
      <LiveSignal
        dot="muted"
        headline={t('admin.live.error')}
        headlineMuted
      />
    );
  }

  const count = q.data.orders.count;
  const grossNum = Number(q.data.orders.gross_revenue);
  if (!count || !Number.isFinite(grossNum) || grossNum === 0) {
    return (
      <LiveSignal
        dot="muted"
        headline={t('admin.live.reports.noSales')}
        headlineMuted
        secondary={t('admin.live.reports.noOrders')}
      />
    );
  }

  return (
    <LiveSignal
      dot="green"
      headline={t('admin.live.reports.today').replace(
        '{amount}',
        formatCentavos(q.data.orders.gross_revenue),
      )}
      secondary={
        count === 1
          ? t('admin.live.reports.oneOrder')
          : t('admin.live.reports.orders').replace('{count}', String(count))
      }
    />
  );
}

// ─── Inventory ────────────────────────────────────────────────────────
// Low-stock alerts return one row per (supply, storage). The same supply
// short at two storages should still count as "1 below min" — collapse on
// supply_id before counting.

export function InventoryLive() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['admin-launcher', 'low-stock'],
    queryFn: () => fetchLowStockAlerts(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) return <LiveSkeleton />;
  if (q.isError || !q.data) {
    return (
      <LiveSignal
        dot="muted"
        headline={t('admin.live.error')}
        headlineMuted
      />
    );
  }

  const supplies = new Set(q.data.map((row) => row.supply_id));
  const n = supplies.size;

  if (n === 0) {
    return (
      <LiveSignal
        dot="green"
        headline={t('admin.live.inventory.healthy')}
        headlineMuted
        secondary={t('admin.live.inventory.allOk')}
      />
    );
  }

  const worst = q.data[0]?.supply_name ?? '';
  return (
    <LiveSignal
      dot="red"
      headline={
        n === 1
          ? t('admin.live.inventory.belowMinOne')
          : t('admin.live.inventory.belowMin').replace('{count}', String(n))
      }
      secondary={
        worst
          ? t('admin.live.inventory.topShort').replace('{name}', worst)
          : undefined
      }
      secondaryAlert
    />
  );
}

// ─── People ───────────────────────────────────────────────────────────
// Counts PRESENT + LATE in today's attendance. We deliberately don't show
// individual names: that would require a second employees fetch and the
// card has no room for a name anyway. Late is surfaced as a count anomaly.

export function PeopleLive() {
  const { t } = useTranslation();
  const today = todayLocal();
  const q = useQuery({
    queryKey: ['admin-launcher', 'attendance-today', today],
    queryFn: () => listAttendance({ from: today, to: today, limit: 100 }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) return <LiveSkeleton />;
  if (q.isError || !q.data) {
    return (
      <LiveSignal
        dot="muted"
        headline={t('admin.live.error')}
        headlineMuted
      />
    );
  }

  const items = q.data.items;
  const present = items.filter(
    (r) => r.status === 'PRESENT' || r.status === 'LATE',
  ).length;
  const late = items.filter((r) => r.status === 'LATE').length;

  if (present === 0) {
    return (
      <LiveSignal
        dot="muted"
        headline={t('admin.live.people.rosterReady')}
        headlineMuted
        secondary={t('admin.live.people.todayDate').replace(
          '{date}',
          formatTodayLabel(),
        )}
      />
    );
  }

  const headline =
    present === 1
      ? t('admin.live.people.clockedInOne')
      : t('admin.live.people.clockedIn').replace('{count}', String(present));

  const secondary =
    late > 0
      ? late === 1
        ? t('admin.live.people.lateOne')
        : t('admin.live.people.lateMany').replace('{count}', String(late))
      : t('admin.live.people.todayDate').replace('{date}', formatTodayLabel());

  return (
    <LiveSignal
      dot={late > 0 ? 'gold' : 'green'}
      headline={headline}
      secondary={secondary}
      secondaryAlert={late > 0}
    />
  );
}

// ─── System ───────────────────────────────────────────────────────────
// No live query here yet — recipe-cost health needs a backend endpoint
// that doesn't exist. Render a calm "in good order" so the card still
// reads as a status card instead of an empty slot.

export function SystemLive() {
  const { t } = useTranslation();
  return (
    <LiveSignal
      dot="muted"
      headline={t('admin.live.system.inOrder')}
      headlineMuted
      secondary={t('admin.live.system.costsCurrent')}
    />
  );
}

export function CatalogLive() {
  const { t } = useTranslation();
  return (
    <LiveSignal
      dot="muted"
      headline={t('admin.live.catalog.headline')}
      headlineMuted
      secondary={t('admin.live.catalog.secondary')}
    />
  );
}
