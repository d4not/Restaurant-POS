// Narrative cell for the principal launcher. Replaces the old centre-greeting
// (which carried only a name + date) with a triage block: today's revenue,
// orders + average ticket, and the alerts that actually demand a decision
// (low stock, open tabs, late staff).
//
// Data composition
//   Four already-cached queries, same staleTime as sectionLive (60s), no
//   refetch on focus. The launcher is glanced at between rushes, not stared
//   at, so a round trip per minute per signal is the right cost.
//
// Visual hierarchy
//   • Eyebrow (date)            — 11px tracked, lowercase, --text3
//   • Lead value (revenue)      — Playfair 32px, --text1, the only big number
//   • Orders + ticket support   — DM Sans 14px, --text2
//   • Alerts (red, clickable)   — DM Sans 14px/600, --red, jumps to suppliesList
//   • Secondary alerts          — DM Sans 13px, --text2 (open tabs, staff)
//
// State coverage
//   loading / closed-shift / no-sales-yet / all-healthy / has-alerts / error.
//   Each state is a discrete render path; we don't paper over them with
//   "—" placeholders that hide the real situation from the operator.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n';
import { fetchLowStockAlerts } from '../../api/alerts';
import { getDailySummary } from '../../api/reports';
import { listAttendance } from '../../api/attendance';
import { fetchActiveOrders } from '../../api/orders';
import type { AdminCurrentRegister } from './AdminMode';
import type { AdminSubView } from './tiles';

// ─── Helpers ───────────────────────────────────────────────────────────

const SPANISH_WEEKDAYS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];
const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

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

function formatTicket(input: string | null | undefined): string {
  if (!input) return '$0';
  return formatCentavos(input);
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatEyebrow(template: string, lang: 'en' | 'es'): string {
  const d = new Date();
  if (lang === 'es') {
    return template
      .replace('{weekday}', SPANISH_WEEKDAYS[d.getDay()])
      .replace('{day}', String(d.getDate()))
      .replace('{month}', SPANISH_MONTHS[d.getMonth()]);
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(d);
  const get = (type: string) => fmt.find((p) => p.type === type)?.value ?? '';
  return template
    .replace('{weekday}', get('weekday'))
    .replace('{day}', get('day'))
    .replace('{month}', get('month'));
}

// ─── Data shape ────────────────────────────────────────────────────────

interface NarrativeData {
  revenueAmount: string | null;
  ordersCount: number;
  avgTicket: string | null;
  lowStockCount: number;
  lowStockWorst: string | null;
  openTabsCount: number;
  onFloorCount: number;
  lateCount: number;
}

interface UseLauncherNarrativeResult {
  data: NarrativeData | null;
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

function useLauncherNarrative(enabled: boolean): UseLauncherNarrativeResult {
  const today = todayLocal();

  const summary = useQuery({
    queryKey: ['admin-narrative', 'daily-summary', today],
    queryFn: () => getDailySummary({ date: today }),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const lowStock = useQuery({
    queryKey: ['admin-narrative', 'low-stock'],
    queryFn: () => fetchLowStockAlerts(),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const activeOrders = useQuery({
    queryKey: ['admin-narrative', 'active-orders'],
    queryFn: () => fetchActiveOrders(),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const attendance = useQuery({
    queryKey: ['admin-narrative', 'attendance', today],
    queryFn: () => listAttendance({ from: today, to: today, limit: 100 }),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const loading =
    summary.isLoading ||
    lowStock.isLoading ||
    activeOrders.isLoading ||
    attendance.isLoading;

  const error =
    summary.isError || lowStock.isError || activeOrders.isError || attendance.isError;

  const refetch = () => {
    summary.refetch();
    lowStock.refetch();
    activeOrders.refetch();
    attendance.refetch();
  };

  const data = useMemo<NarrativeData | null>(() => {
    if (!summary.data) return null;

    const lowStockSupplies = new Set(
      (lowStock.data ?? []).map((row) => row.supply_id),
    );
    const lowStockWorst = lowStock.data?.[0]?.supply_name ?? null;

    const attendanceItems = attendance.data?.items ?? [];
    const onFloor = attendanceItems.filter(
      (r) => r.status === 'PRESENT' || r.status === 'LATE',
    ).length;
    const late = attendanceItems.filter((r) => r.status === 'LATE').length;

    return {
      revenueAmount: summary.data.orders.gross_revenue ?? null,
      ordersCount: summary.data.orders.count ?? 0,
      avgTicket: summary.data.orders.avg_ticket ?? null,
      lowStockCount: lowStockSupplies.size,
      lowStockWorst,
      openTabsCount: activeOrders.data?.length ?? 0,
      onFloorCount: onFloor,
      lateCount: late,
    };
  }, [summary.data, lowStock.data, activeOrders.data, attendance.data]);

  return { data, loading, error, refetch };
}

// ─── Component ─────────────────────────────────────────────────────────

interface LauncherNarrativeProps {
  currentRegister: AdminCurrentRegister | null;
  currentRegisterLoading: boolean;
  /** Jump straight to a sub-view (used by the low-stock alert click). */
  onJumpToView: (view: AdminSubView) => void;
}

export function LauncherNarrative({
  currentRegister,
  currentRegisterLoading,
  onJumpToView,
}: LauncherNarrativeProps) {
  const { t, language } = useTranslation();
  const enabled = Boolean(currentRegister);
  const { data, loading, error, refetch } = useLauncherNarrative(enabled);

  const eyebrowTemplate = t('admin.narrative.eyebrow.format');
  const eyebrow = useMemo(() => formatEyebrow(eyebrowTemplate, language), [
    eyebrowTemplate,
    language,
  ]);

  // ── Closed shift: skip queries, render the CTA copy.
  if (!currentRegisterLoading && !currentRegister) {
    return (
      <section className="admin-narrative" aria-label={t('admin.narrative.noShiftTitle')}>
        <p className="admin-narrative-eyebrow">{eyebrow}</p>
        <h1 className="admin-narrative-lead admin-narrative-lead-muted">
          {t('admin.narrative.noShiftTitle')}
        </h1>
        <p className="admin-narrative-supporting">
          {t('admin.narrative.noShiftBody')}
        </p>
      </section>
    );
  }

  // ── Initial load (register query or any composed query still pending).
  if (currentRegisterLoading || (enabled && loading && !data)) {
    return (
      <section className="admin-narrative" aria-busy="true" aria-label={t('admin.title')}>
        <p className="admin-narrative-eyebrow">{eyebrow}</p>
        <div className="admin-narrative-skeleton admin-narrative-skeleton-lead" />
        <div className="admin-narrative-skeleton admin-narrative-skeleton-sub" />
      </section>
    );
  }

  // ── Fetch error: tell the operator and offer a retry.
  if (error || !data) {
    return (
      <section className="admin-narrative" aria-label={t('admin.narrative.error')}>
        <p className="admin-narrative-eyebrow">{eyebrow}</p>
        <h1 className="admin-narrative-lead admin-narrative-lead-muted">
          {t('admin.narrative.error')}
        </h1>
        <button
          type="button"
          className="admin-narrative-retry"
          onClick={() => refetch()}
        >
          {t('admin.narrative.retry')}
        </button>
      </section>
    );
  }

  const revenueAmount = formatCentavos(data.revenueAmount);
  const ticketAmount = formatTicket(data.avgTicket);
  const hasSales = data.ordersCount > 0;

  // Build alert lines. Order them by priority (low stock first, then tabs, then staff).
  const alerts: AlertLine[] = [];

  if (data.lowStockCount > 0) {
    const key = data.lowStockWorst
      ? data.lowStockCount === 1
        ? 'admin.narrative.lowStockWithNameOne'
        : 'admin.narrative.lowStockWithName'
      : data.lowStockCount === 1
        ? 'admin.narrative.lowStockOne'
        : 'admin.narrative.lowStock';

    alerts.push({
      tone: 'alert',
      text: t(key)
        .replace('{count}', String(data.lowStockCount))
        .replace('{name}', data.lowStockWorst ?? ''),
      onClick: () => onJumpToView('suppliesList'),
    });
  }

  const supportingLines: string[] = [];

  if (data.openTabsCount > 0) {
    supportingLines.push(
      data.openTabsCount === 1
        ? t('admin.narrative.openTabsOne')
        : t('admin.narrative.openTabs').replace('{count}', String(data.openTabsCount)),
    );
  }

  if (data.onFloorCount > 0) {
    const onFloorLine =
      data.lateCount > 0
        ? data.onFloorCount === 1
          ? t('admin.narrative.onFloorLateOne').replace(
              '{count}',
              String(data.onFloorCount),
            )
          : t('admin.narrative.onFloorLate')
              .replace('{count}', String(data.onFloorCount))
              .replace('{late}', String(data.lateCount))
        : data.onFloorCount === 1
          ? t('admin.narrative.onFloorOne')
          : t('admin.narrative.onFloor').replace(
              '{count}',
              String(data.onFloorCount),
            );
    supportingLines.push(onFloorLine);
  }

  // ── All-healthy + no anomalies + has sales: single calm sentence so the
  //    eye learns to trust the screen.
  if (!hasSales && alerts.length === 0 && supportingLines.length === 0) {
    return (
      <section className="admin-narrative" aria-label={t('admin.title')}>
        <p className="admin-narrative-eyebrow">{eyebrow}</p>
        <h1 className="admin-narrative-lead admin-narrative-lead-muted">
          {t('admin.narrative.allHealthyNoSales')}
        </h1>
      </section>
    );
  }

  if (hasSales && alerts.length === 0 && supportingLines.length === 0) {
    const calmKey =
      data.ordersCount === 1
        ? 'admin.narrative.allHealthyOne'
        : 'admin.narrative.allHealthy';
    return (
      <section className="admin-narrative" aria-label={t('admin.title')}>
        <p className="admin-narrative-eyebrow">{eyebrow}</p>
        <h1 className="admin-narrative-lead">
          {t(calmKey)
            .replace('{amount}', revenueAmount)
            .replace('{count}', String(data.ordersCount))}
        </h1>
      </section>
    );
  }

  // ── Default state: numbers + alerts.
  const ordersLine = !hasSales
    ? t('admin.narrative.empty')
    : data.ordersCount === 1
      ? t('admin.narrative.ordersOne').replace('{ticket}', ticketAmount)
      : t('admin.narrative.orders')
          .replace('{count}', String(data.ordersCount))
          .replace('{ticket}', ticketAmount);

  return (
    <section className="admin-narrative" aria-label={t('admin.title')}>
      <p className="admin-narrative-eyebrow">{eyebrow}</p>
      <h1 className="admin-narrative-lead">
        {t('admin.narrative.revenue').replace('{amount}', revenueAmount)}
      </h1>
      <p className="admin-narrative-supporting">{ordersLine}</p>

      {alerts.length > 0 && (
        <ul className="admin-narrative-alerts" role="list">
          {alerts.map((a, i) => (
            <li key={i}>
              <button
                type="button"
                className="admin-narrative-alert"
                onClick={a.onClick}
              >
                <span aria-hidden="true" className="admin-narrative-alert-dot" />
                {a.text}
              </button>
            </li>
          ))}
        </ul>
      )}

      {supportingLines.length > 0 && (
        <p className="admin-narrative-secondary">
          {supportingLines.join(' · ')}
        </p>
      )}
    </section>
  );
}

interface AlertLine {
  tone: 'alert';
  text: string;
  onClick: () => void;
}
