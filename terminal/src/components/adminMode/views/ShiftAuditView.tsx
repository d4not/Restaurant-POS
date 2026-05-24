// Shift Audit — the night-cut surface for the admin. Lists every shift in
// the selected period grouped by day, surfaces the per-shift payment mix
// and variance, and hosts the close-shift / end-day actions that the cashier
// POS no longer exposes.
//
// Layout
//   ┌─ Filters (status pills + date range + only-flagged toggle) ─────┐
//   ┌─ End-day prompt (only when no shift is OPEN) ───────────────────┐
//   ┌─ KPIs (period count, revenue, total variance, flagged) ─────────┐
//   ┌─ Day groups, newest first ─────────────────────────────────────┐
//   │   Day header: date + per-column labels + day totals             │
//   │   ╶ Shift row ╶  (active shift renders here too, pre-expanded)  │
//   │     ↳ expanded detail (apertura / breakdown / movimientos)      │
//
// Variance is the only column that gets color. Zero is muted, ≤ $5 is
// "rounding territory" (subtle), > $5 lights up red (shortage) or gold
// (surplus). Every other money column is tabular grey.

import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import {
  fetchAllRegisters,
  closeRegister,
  type CashRegisterDetail,
} from '../../../api/registers';
import {
  closeDailyReport,
  fetchTodayDailyReport,
  listDailyReports,
  reopenDailyReport,
  type DailyReportSummary,
} from '../../../api/daily-reports';
import { DailyReportInlineView } from './DailyReportInlineView';
import { ApiError } from '../../../api/client';
import { useSession } from '../../../store/session';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { formatMoney, formatMoneyPlain } from '../../../utils/format';
import { Spinner } from '../../Spinner';
import { IconChevronDown } from '../../Icons';

const ROLES_CAN_CLOSE_SHIFT: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);
const ROLES_CAN_END_DAY: ReadonlySet<string> = new Set(['MANAGER', 'ADMIN']);

// Rounding-territory threshold for variance — anything inside ±$5 (500 cents)
// reads as "honest mistake", outside that is a real flag worth attention.
const VARIANCE_FLAG_CENTS = 500;

interface ShiftAuditViewProps {
  onBack: () => void;
}

type StatusFilter = 'ALL' | 'OPEN' | 'CLOSED';

// Folio render — Z-0003. Centralised so the audit ribbon and any future
// surface (toasts, print headers) stay consistent.
function folioLabel(folio: number): string {
  return `Z-${String(folio).padStart(4, '0')}`;
}

type CloseAction =
  | { kind: 'close'; shift: CashRegisterDetail }
  | { kind: 'endDay' }
  | { kind: 'reopenDay'; report: DailyReportSummary }
  | null;

// ── Avatar palette: six muted hues that sit on warm cream without
//    shouting. Same hue → same person across the day, derived from
//    user_id (or name as fallback).
const AVATAR_PALETTE = [
  '#b86840', // terracotta
  '#7a8a4a', // olive
  '#5a8082', // teal-stone
  '#a06070', // dusty rose
  '#8a6e3e', // bronze
  '#5a6878', // slate
] as const;

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function paletteFor(seed: string): string {
  const idx = hashStr(seed || 'x') % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) {
    const w = parts[0]!;
    return (w[0]! + (w[1] ?? '')).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function isoFromInput(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDayHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function fmtDayYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getFullYear());
}

function elapsedMs(from: string, to: string | null): number {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Local YYYY-MM-DD key for grouping shifts and matching against "today".
function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Group registers by their local opened_at date, preserving the backend's
// newest-first ordering. Returns [{ dayKey, iso, rows }] with rows already
// ordered newest-first (so today's OPEN shift sits at the top of today).
function groupByDay(
  rows: CashRegisterDetail[],
): Array<{ dayKey: string; iso: string; rows: CashRegisterDetail[] }> {
  const map = new Map<string, { iso: string; rows: CashRegisterDetail[] }>();
  for (const r of rows) {
    const key = dayKeyOf(new Date(r.opened_at));
    const slot = map.get(key);
    if (slot) slot.rows.push(r);
    else map.set(key, { iso: r.opened_at, rows: [r] });
  }
  return Array.from(map.entries()).map(([dayKey, slot]) => ({
    dayKey,
    iso: slot.iso,
    rows: slot.rows,
  }));
}

function sumField(
  rows: CashRegisterDetail[],
  picker: (r: CashRegisterDetail) => string | null | undefined,
): string {
  return rows
    .reduce((acc, r) => acc.add(new Decimal(picker(r) ?? '0')), new Decimal(0))
    .toFixed(0);
}

function isFlagged(diff: string | null | undefined): boolean {
  if (diff === null || diff === undefined) return false;
  const n = Number(diff);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n) > VARIANCE_FLAG_CENTS;
}

// ─── Main view ────────────────────────────────────────────────────────────

export function ShiftAuditView({ onBack }: ShiftAuditViewProps) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canCloseShift = ROLES_CAN_CLOSE_SHIFT.has(role);
  const canEndDay = ROLES_CAN_END_DAY.has(role);

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [modal, setModal] = useState<CloseAction>(null);

  const [collapsedActive, setCollapsedActive] = useState(false);
  const [expandedClosed, setExpandedClosed] = useState<Set<string>>(new Set());

  // Day-level collapse: only today's day-group is expanded by default; older
  // days collapse to their summary header so the page lands on a single
  // glanceable day. Captured at mount; the rare "page open past midnight"
  // edge case isn't worth defending against here.
  const [todayKey] = useState<string>(() => dayKeyOf(new Date()));
  const [expandedDays, setExpandedDays] = useState<Set<string>>(
    () => new Set([todayKey]),
  );

  function toggleDay(dayKey: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }

  function isDayExpanded(dayKey: string): boolean {
    return expandedDays.has(dayKey);
  }

  const params = useMemo(
    () => ({
      ...(status === 'ALL' ? {} : { status }),
      from: isoFromInput(from),
      to: isoFromInput(to, true),
    }),
    [status, from, to],
  );

  const query = useQuery({
    queryKey: ['admin', 'shifts', params],
    queryFn: () => fetchAllRegisters(params),
    staleTime: 30_000,
    // Keeps the active shift's elapsed time fresh without a separate clock.
    refetchInterval: 60_000,
  });

  // Today's daily report — null until loaded, then either the row (day already
  // closed) or null (day still open). Used to suppress the End-day affordances
  // so the user never triggers the unique-date 409. Only managers/admins are
  // allowed to hit /daily-reports anyway, so gate the query on canEndDay.
  const todayDailyReportQuery = useQuery({
    queryKey: ['daily-reports', 'today'],
    queryFn: fetchTodayDailyReport,
    enabled: canEndDay,
    staleTime: 30_000,
  });
  const todayClosed = todayDailyReportQuery.data ?? null;

  // Daily reports across the visible audit window so each DayGroup header can
  // render its Z-folio + view/reopen affordances. Same role gate as the
  // today-query; shares the ['daily-reports', ...] cache prefix so close/reopen
  // mutations refresh both with one invalidate.
  const auditDailyReportsQuery = useQuery({
    queryKey: ['daily-reports', 'audit', params],
    queryFn: () => listDailyReports({ from: params.from, to: params.to }),
    enabled: canEndDay,
    staleTime: 30_000,
  });
  const dailyReportByDayKey = useMemo(() => {
    // DailyReport.date is a UTC midnight ISO like "2026-05-20T00:00:00.000Z".
    // We key by the YYYY-MM-DD prefix to dodge timezone parsing — the audit
    // view groups shifts by local-date opened_at, and for shifts opened during
    // the local business day the two strings line up. Late-night closes that
    // cross UTC midnight are a known mismatch (the close-day groups by UTC
    // closed_at), tolerated rather than over-engineered.
    const map = new Map<string, DailyReportSummary>();
    for (const r of auditDailyReportsQuery.data ?? []) {
      map.set(r.date.slice(0, 10), r);
    }
    return map;
  }, [auditDailyReportsQuery.data]);

  const allRows = query.data ?? [];
  const rows = useMemo(
    () => (onlyFlagged ? allRows.filter((r) => isFlagged(r.difference)) : allRows),
    [allRows, onlyFlagged],
  );
  const openShift = allRows.find((r) => r.status === 'OPEN') ?? null;
  const days = useMemo(() => groupByDay(rows), [rows]);

  const kpis = useMemo(() => {
    const variance = allRows.reduce((acc, r) => {
      if (r.difference === null || r.difference === undefined) return acc;
      return acc.plus(new Decimal(r.difference));
    }, new Decimal(0));
    const revenue = allRows.reduce(
      (acc, r) => acc.plus(new Decimal(r.totals?.total_sales ?? '0')),
      new Decimal(0),
    );
    const flagged = allRows.filter((r) => isFlagged(r.difference)).length;
    return {
      count: allRows.length,
      revenue: revenue.toFixed(0),
      variance: variance.toFixed(0),
      flagged,
    };
  }, [allRows]);

  function toggleRow(row: CashRegisterDetail) {
    if (row.status === 'OPEN') {
      setCollapsedActive((v) => !v);
      return;
    }
    setExpandedClosed((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  function isExpanded(row: CashRegisterDetail): boolean {
    if (row.status === 'OPEN') return !collapsedActive;
    return expandedClosed.has(row.id);
  }

  // Inline Z-report viewer. The "View report" button on a day group sets this
  // to the DailyReportSummary; while it's non-null we render the dedicated
  // inline view in place of the audit table (window.open() is denied in
  // Electron's main window). The view's own Back arrow clears the state.
  const [viewingReport, setViewingReport] = useState<DailyReportSummary | null>(null);

  if (viewingReport) {
    return (
      <DailyReportInlineView
        report={viewingReport}
        onBack={() => setViewingReport(null)}
      />
    );
  }

  return (
    <AdminViewShell
      titleKey="admin.shiftAudit.title"
      subtitleKey="admin.shiftAudit.subtitle"
      onBack={onBack}
    >
      {/* ─── Filters ─────────────────────────────────────────────────── */}
      <div style={filterRow}>
        <div style={adminStyles.filterField}>
          <span style={adminStyles.filterLabel}>
            {t('admin.shiftAudit.filter.status')}
          </span>
          <div style={adminStyles.pillRow}>
            {(
              [
                ['ALL', 'admin.shiftAudit.filter.statusAll'],
                ['OPEN', 'admin.shiftAudit.filter.statusOpen'],
                ['CLOSED', 'admin.shiftAudit.filter.statusClosed'],
              ] as const
            ).map(([key, labelKey]) => (
              <button
                key={key}
                type="button"
                style={{
                  ...adminStyles.pillBtn,
                  ...(status === key ? adminStyles.pillBtnActive : null),
                }}
                onClick={() => setStatus(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div style={adminStyles.filterField}>
          <label htmlFor="shift-from" style={adminStyles.filterLabel}>
            {t('admin.shiftAudit.filter.from')}
          </label>
          <input
            id="shift-from"
            type="date"
            style={adminStyles.dateInput}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div style={adminStyles.filterField}>
          <label htmlFor="shift-to" style={adminStyles.filterLabel}>
            {t('admin.shiftAudit.filter.to')}
          </label>
          <input
            id="shift-to"
            type="date"
            style={adminStyles.dateInput}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div style={{ ...adminStyles.filterField, marginLeft: 'auto' }}>
          <span style={adminStyles.filterLabel}>
            {t('admin.shiftAudit.filter.flagged')}
          </span>
          <button
            type="button"
            style={{
              ...adminStyles.pillBtn,
              ...(onlyFlagged ? flaggedPillActive : null),
            }}
            onClick={() => setOnlyFlagged((v) => !v)}
            aria-pressed={onlyFlagged}
          >
            {onlyFlagged ? '● ' : '○ '}
            {t('admin.shiftAudit.filter.onlyFlagged')}
            {kpis.flagged > 0 && (
              <span style={flaggedPillBadge}>{kpis.flagged}</span>
            )}
          </button>
        </div>
      </div>

      {/* End-day prompt — only when there's no shift open AND the user can
          close the day AND today isn't already closed. The close-shift modal
          already offers "also end day", so this is for managers arriving
          after everyone went home. */}
      {!openShift && canEndDay && !todayClosed && (
        <EndDayPrompt onEndDay={() => setModal({ kind: 'endDay' })} />
      )}

      {/* ─── KPIs ────────────────────────────────────────────────────── */}
      <div style={adminStyles.kpiRow}>
        <KpiTile label={t('admin.shiftAudit.kpi.shifts')} value={String(kpis.count)} />
        <KpiTile
          label={t('admin.shiftAudit.kpi.revenue')}
          value={formatMoney(kpis.revenue)}
        />
        <KpiTile
          label={t('admin.shiftAudit.kpi.totalVariance')}
          value={null}
          custom={<VarianceCell diff={kpis.variance} size="kpi" />}
        />
        <KpiTile
          label={t('admin.shiftAudit.kpi.flagged')}
          value={String(kpis.flagged)}
          interactive={kpis.flagged > 0}
          active={onlyFlagged}
          onClick={() => {
            if (kpis.flagged > 0) setOnlyFlagged((v) => !v);
          }}
        />
      </div>

      {/* ─── Day groups ──────────────────────────────────────────────── */}
      {query.isLoading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spinner />
        </div>
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : days.length === 0 ? (
        <EmptyState
          flagged={onlyFlagged}
          onClearFlag={() => setOnlyFlagged(false)}
        />
      ) : (
        <div style={dayList}>
          {days.map((group) => (
            <DayGroup
              key={group.dayKey}
              dayKey={group.dayKey}
              iso={group.iso}
              rows={group.rows}
              isToday={group.dayKey === todayKey}
              expanded={isDayExpanded(group.dayKey)}
              onToggleDay={() => toggleDay(group.dayKey)}
              canCloseShift={canCloseShift}
              isRowExpanded={isExpanded}
              onToggleRow={toggleRow}
              onCloseShift={(shift) => setModal({ kind: 'close', shift })}
              dailyReport={dailyReportByDayKey.get(group.dayKey) ?? null}
              canManageDay={canEndDay}
              onViewDailyReport={(report) => setViewingReport(report)}
              onReopenDailyReport={(report) =>
                setModal({ kind: 'reopenDay', report })
              }
            />
          ))}
        </div>
      )}

      {/* ─── Modals ──────────────────────────────────────────────────── */}
      {modal?.kind === 'close' && (
        <CloseShiftPanel
          shift={modal.shift}
          todayClosed={Boolean(todayClosed)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'endDay' && <EndDayPanel onClose={() => setModal(null)} />}
      {modal?.kind === 'reopenDay' && (
        <ReopenDayPanel
          report={modal.report}
          onClose={() => setModal(null)}
        />
      )}
    </AdminViewShell>
  );
}

// ─── KPI tile (replaces the generic kpiCard for this view) ───────────────

interface KpiTileProps {
  label: string;
  value: string | null;
  custom?: React.ReactNode;
  interactive?: boolean;
  active?: boolean;
  onClick?: () => void;
}

function KpiTile({ label, value, custom, interactive, active, onClick }: KpiTileProps) {
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`admin-kpi-tile is-clickable${active ? ' is-active' : ''}`}
        style={{
          ...adminStyles.kpiCard,
          ...(active ? kpiTileActive : null),
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <span style={adminStyles.kpiLabel}>{label}</span>
        {custom ?? <span style={adminStyles.kpiValue}>{value}</span>}
      </button>
    );
  }
  return (
    <div className="admin-kpi-tile" style={adminStyles.kpiCard}>
      <span style={adminStyles.kpiLabel}>{label}</span>
      {custom ?? <span style={adminStyles.kpiValue}>{value}</span>}
    </div>
  );
}

// ─── End-day prompt (slim banner) ─────────────────────────────────────────

function EndDayPrompt({ onEndDay }: { onEndDay: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={endDayPromptStyle.root}>
      <div style={endDayPromptStyle.text}>
        <div style={endDayPromptStyle.title}>
          {t('admin.shiftAudit.endDayPrompt.title')}
        </div>
        <div style={endDayPromptStyle.sub}>
          {t('admin.shiftAudit.endDayPrompt.sub')}
        </div>
      </div>
      <button type="button" style={endDayPromptStyle.btn} onClick={onEndDay}>
        {t('admin.shiftAudit.live.endDay')}
      </button>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────

function EmptyState({
  flagged,
  onClearFlag,
}: {
  flagged: boolean;
  onClearFlag: () => void;
}) {
  const { t } = useTranslation();
  if (flagged) {
    return (
      <div style={emptyStateStyle.root}>
        <div style={emptyStateStyle.title}>
          {t('admin.shiftAudit.emptyFlagged.title')}
        </div>
        <div style={emptyStateStyle.sub}>
          {t('admin.shiftAudit.emptyFlagged.sub')}
        </div>
        <button type="button" style={emptyStateStyle.btn} onClick={onClearFlag}>
          {t('admin.shiftAudit.emptyFlagged.clear')}
        </button>
      </div>
    );
  }
  return <div style={emptyStateStyle.root}>{t('admin.shiftAudit.empty')}</div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={errorStateStyle.root}>
      <div style={errorStateStyle.title}>{t('common.error')}</div>
      <button type="button" style={errorStateStyle.btn} onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  );
}

// ─── Day group: header + shift rows ───────────────────────────────────────

interface DayGroupProps {
  dayKey: string;
  iso: string;
  rows: CashRegisterDetail[];
  isToday: boolean;
  expanded: boolean;
  onToggleDay: () => void;
  canCloseShift: boolean;
  isRowExpanded: (row: CashRegisterDetail) => boolean;
  onToggleRow: (row: CashRegisterDetail) => void;
  onCloseShift: (shift: CashRegisterDetail) => void;
  // Closed daily report for this day, if one exists. When present the header
  // grows a Z-report ribbon with the folio + view/reopen actions.
  dailyReport: DailyReportSummary | null;
  // Whether the current user can manage day-level actions (view/reopen). We
  // still surface the folio label for read-only roles; we just don't show
  // the buttons.
  canManageDay: boolean;
  onViewDailyReport: (report: DailyReportSummary) => void;
  onReopenDailyReport: (report: DailyReportSummary) => void;
}

function DayGroup({
  dayKey,
  iso,
  rows,
  isToday,
  expanded,
  onToggleDay,
  canCloseShift,
  isRowExpanded,
  onToggleRow,
  onCloseShift,
  dailyReport,
  canManageDay,
  onViewDailyReport,
  onReopenDailyReport,
}: DayGroupProps) {
  const { t } = useTranslation();
  const revenue = sumField(rows, (r) => r.totals?.total_sales);
  const cashSales = sumField(rows, (r) => r.totals?.cash_sales);
  const cardSales = sumField(rows, (r) => r.totals?.card_sales);
  const transferSales = sumField(rows, (r) => r.totals?.transfer_sales);
  const variance = sumField(rows, (r) => r.difference);

  function handleHeadKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleDay();
    }
  }

  return (
    <section
      style={dayGroupStyle.root}
      aria-labelledby={`day-${dayKey}-title`}
    >
      <header
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`day-${dayKey}-rows`}
        className={`admin-day-head${expanded ? '' : ' is-collapsed'}`}
        style={dayGroupStyle.head}
        onClick={onToggleDay}
        onKeyDown={handleHeadKey}
      >
        <div style={dayGroupStyle.headRow}>
          <div style={dayGroupStyle.titleCell}>
            <span id={`day-${dayKey}-title`} style={dayGroupStyle.title}>
              {fmtDayHeader(iso)}
            </span>
            {isToday && (
              <span style={dayGroupStyle.todayBadge}>
                {t('admin.shiftAudit.day.today')}
              </span>
            )}
            <span style={dayGroupStyle.titleYear}>{fmtDayYear(iso)}</span>
          </div>
          <ColumnLabel>{t('admin.shiftAudit.day.revenue')}</ColumnLabel>
          <ColumnLabel>{t('admin.shiftAudit.day.cash')}</ColumnLabel>
          <ColumnLabel>{t('admin.shiftAudit.day.card')}</ColumnLabel>
          <ColumnLabel>{t('admin.shiftAudit.day.transfer')}</ColumnLabel>
          <ColumnLabel>{t('admin.shiftAudit.day.variance')}</ColumnLabel>
          <span style={dayGroupStyle.headChevronSlot}>
            <span
              className={`admin-shift-chevron${expanded ? ' is-expanded' : ''}`}
              aria-hidden="true"
            >
              <IconChevronDown style={{ fontSize: 16 }} />
            </span>
          </span>
        </div>
        <div style={dayGroupStyle.headRow}>
          <div style={dayGroupStyle.subTitleCell}>
            <span style={dayGroupStyle.shiftCount}>
              {rows.length === 1
                ? t('admin.shiftAudit.day.oneShift')
                : t('admin.shiftAudit.day.nShifts').replace('{n}', String(rows.length))}
            </span>
            {dailyReport && (
              <span
                style={dayGroupStyle.zRibbon}
                onClick={(e) => e.stopPropagation()}
              >
                <span style={dayGroupStyle.zFolio}>
                  {folioLabel(dailyReport.folio)}
                </span>
                {canManageDay && (
                  <>
                    <button
                      type="button"
                      style={dayGroupStyle.zBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewDailyReport(dailyReport);
                      }}
                    >
                      {t('admin.shiftAudit.zReport.view')}
                    </button>
                    <button
                      type="button"
                      style={{ ...dayGroupStyle.zBtn, ...dayGroupStyle.zBtnDanger }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReopenDailyReport(dailyReport);
                      }}
                    >
                      {t('admin.shiftAudit.zReport.reopen')}
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
          <DayTotal value={revenue} strong />
          <DayTotal value={cashSales} />
          <DayTotal value={cardSales} />
          <DayTotal value={transferSales} />
          <span style={dayGroupStyle.varianceTotal}>
            <VarianceCell diff={variance} size="day" />
          </span>
          <span />
        </div>
      </header>

      {expanded && (
        <div
          id={`day-${dayKey}-rows`}
          className="admin-shift-expand"
          style={dayGroupStyle.rows}
        >
          {rows.map((row) => (
            <ShiftRow
              key={row.id}
              row={row}
              expanded={isRowExpanded(row)}
              canCloseShift={canCloseShift}
              onToggle={() => onToggleRow(row)}
              onCloseShift={() => onCloseShift(row)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return <span style={dayGroupStyle.colLabel}>{children}</span>;
}

function DayTotal({ value, strong }: { value: string; strong?: boolean }) {
  return (
    <span
      style={{
        ...dayGroupStyle.colValue,
        fontWeight: strong ? 700 : 500,
        color: strong ? 'var(--text1)' : 'var(--text2)',
      }}
    >
      {formatMoneyPlain(value)}
    </span>
  );
}

// ─── Shift row + expanded detail ──────────────────────────────────────────

interface ShiftRowProps {
  row: CashRegisterDetail;
  expanded: boolean;
  canCloseShift: boolean;
  onToggle: () => void;
  onCloseShift: () => void;
}

function ShiftRow({
  row,
  expanded,
  canCloseShift,
  onToggle,
  onCloseShift,
}: ShiftRowProps) {
  const { t } = useTranslation();
  const isOpen = row.status === 'OPEN';
  const name = row.user?.name ?? '—';
  const seed = row.user?.id ?? name;
  const palette = paletteFor(seed);
  const duration = fmtDuration(elapsedMs(row.opened_at, isOpen ? null : row.closed_at));

  const totalSales = row.totals?.total_sales ?? '0';
  const cashSales = row.totals?.cash_sales ?? '0';
  const cardSales = row.totals?.card_sales ?? '0';
  const transferSales = row.totals?.transfer_sales ?? '0';

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  }

  function handleClose(e: React.MouseEvent) {
    e.stopPropagation();
    onCloseShift();
  }

  return (
    <div
      className="admin-shift-row-wrapper"
      style={{
        ...shiftRowStyle.wrapper,
        ...(expanded ? shiftRowStyle.wrapperExpanded : null),
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className={`admin-shift-row${isOpen ? ' is-open' : ''}`}
        style={shiftRowStyle.row}
        onClick={onToggle}
        onKeyDown={handleKey}
      >
        {/* col 1: identity */}
        <div style={shiftRowStyle.identity}>
          <CashierAvatar initials={initials(name)} color={palette} />
          <div style={shiftRowStyle.identityText}>
            <div style={shiftRowStyle.name}>{name}</div>
            <div style={shiftRowStyle.timeRange}>
              <span>{fmtTime(row.opened_at)}</span>
              <span style={shiftRowStyle.arrow}>→</span>
              <span>
                {isOpen ? t('admin.shiftAudit.now') : fmtTime(row.closed_at)}
              </span>
            </div>
          </div>
        </div>

        {/* col 2: status pill */}
        <div style={shiftRowStyle.statusSlot}>
          <StatusPill isOpen={isOpen} provisional={row.is_provisional} />
        </div>

        {/* col 3: duration */}
        <span style={shiftRowStyle.duration}>{duration}</span>

        {/* col 4-7: payment columns */}
        <span style={shiftRowStyle.numStrong}>{formatMoneyPlain(totalSales)}</span>
        <span style={shiftRowStyle.numMuted}>{formatMoneyPlain(cashSales)}</span>
        <span style={shiftRowStyle.numMuted}>{formatMoneyPlain(cardSales)}</span>
        <span style={shiftRowStyle.numMuted}>{formatMoneyPlain(transferSales)}</span>

        {/* col 8: variance — the only column that carries color */}
        <span style={shiftRowStyle.varianceSlot}>
          <VarianceCell diff={row.difference} size="row" />
        </span>

        {/* col 9: action — close button (active+permitted) or chevron */}
        <div style={shiftRowStyle.actionSlot}>
          {isOpen && canCloseShift ? (
            <button
              type="button"
              style={{
                ...shiftRowStyle.closeBtn,
                ...(row.is_provisional ? shiftRowStyle.closeBtnDisabled : null),
              }}
              onClick={handleClose}
              disabled={row.is_provisional}
              title={row.is_provisional ? t('provisional.closeBlocked') : undefined}
              aria-label={t('admin.shiftAudit.live.closeShift')}
            >
              {t('admin.shiftAudit.row.close')}
            </button>
          ) : (
            <span
              className={`admin-shift-chevron${expanded ? ' is-expanded' : ''}`}
              style={shiftRowStyle.chevron}
              aria-hidden="true"
            >
              <IconChevronDown style={{ fontSize: 16 }} />
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="admin-shift-expand" style={shiftRowStyle.expand}>
          <ShiftDetail row={row} />
        </div>
      )}
    </div>
  );
}

function CashierAvatar({
  initials,
  color,
}: {
  initials: string;
  color: string;
}) {
  return (
    <span
      style={{
        ...avatarStyle.root,
        background: color,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

function StatusPill({ isOpen, provisional }: { isOpen: boolean; provisional: boolean }) {
  const { t } = useTranslation();
  if (provisional) {
    return (
      <span style={{ ...statusPillStyle.base, ...statusPillStyle.provisional }}>
        {t('admin.shiftAudit.row.provisional')}
      </span>
    );
  }
  if (isOpen) {
    return (
      <span style={{ ...statusPillStyle.base, ...statusPillStyle.open }}>
        <span
          className="admin-shift-status-dot is-live"
          style={statusPillStyle.openDot}
        />
        {t('admin.shiftAudit.row.statusOpen')}
      </span>
    );
  }
  return (
    <span style={{ ...statusPillStyle.base, ...statusPillStyle.closed }}>
      {t('admin.shiftAudit.row.statusClosed')}
    </span>
  );
}

// ─── Variance cell ────────────────────────────────────────────────────────

type VarianceSize = 'row' | 'day' | 'kpi';

function VarianceCell({
  diff,
  size,
}: {
  diff: string | null | undefined;
  size: VarianceSize;
}) {
  const s = varianceSizes[size];

  if (diff === null || diff === undefined) {
    return <span style={{ ...s.base, ...s.empty }}>—</span>;
  }
  const n = Number(diff);
  if (!Number.isFinite(n)) {
    return <span style={{ ...s.base, ...s.empty }}>—</span>;
  }
  if (n === 0) {
    return (
      <span style={{ ...s.base, ...s.zero }}>
        {size === 'kpi' ? formatMoney(0) : formatMoneyPlain(0)}
      </span>
    );
  }
  const abs = Math.abs(n);
  const rounding = abs <= VARIANCE_FLAG_CENTS;
  let color: string;
  if (rounding) color = 'var(--text2)';
  else if (n < 0) color = 'var(--red)';
  else color = 'var(--gold)';

  const glyph = n < 0 ? '▼' : '▲';
  const sign = n < 0 ? '−' : '+';
  const formatted =
    size === 'kpi' ? formatMoney(abs) : `$${formatMoneyPlain(abs)}`;

  return (
    <span style={{ ...s.base, ...s.value, color }}>
      <span style={s.glyph}>{glyph}</span>
      <span>{sign}{formatted}</span>
    </span>
  );
}

// ─── Expanded detail ──────────────────────────────────────────────────────

function ShiftDetail({ row }: { row: CashRegisterDetail }) {
  const { t } = useTranslation();
  const movements = row.cash_movements ?? [];
  const provisionalDiff = row.provisional_difference;
  const provisionalActual = row.provisional_actual_amount;

  return (
    <div style={detailStyle.root}>
      <div style={detailStyle.cols}>
        {/* Left column: opening + sales breakdown + cash movements totals */}
        <dl style={detailStyle.dl}>
          <DetailRow
            label={t('admin.shiftAudit.col.opening')}
            value={row.opening_amount}
          />
          <DetailRow
            label={t('admin.shiftAudit.col.cashSales')}
            value={row.totals?.cash_sales ?? '0'}
          />
          <DetailRow
            label={t('admin.shiftAudit.col.card')}
            value={row.totals?.card_sales ?? '0'}
          />
          <DetailRow
            label={t('admin.shiftAudit.col.transfer')}
            value={row.totals?.transfer_sales ?? '0'}
          />
          <DetailRow
            label={t('admin.shiftAudit.col.other')}
            value={row.totals?.other_sales ?? '0'}
          />
          <DetailRow
            label={t('admin.shiftAudit.col.cashIn')}
            value={row.totals?.cash_in ?? '0'}
          />
          <DetailRow
            label={t('admin.shiftAudit.col.cashOut')}
            value={row.totals?.cash_out ?? '0'}
          />
        </dl>

        {/* Right column: the reconciliation trio */}
        <dl style={detailStyle.dl}>
          <DetailRow
            label={t('admin.shiftAudit.col.expected')}
            value={row.totals?.expected_cash ?? row.expected_amount}
            strong
          />
          <DetailRow
            label={t('admin.shiftAudit.col.actual')}
            value={row.actual_amount}
            empty={row.actual_amount === null}
          />
          <DetailRow
            label={t('admin.shiftAudit.col.diff')}
            customValue={<VarianceCell diff={row.difference} size="row" />}
            strong
          />
        </dl>
      </div>

      {provisionalDiff !== null &&
        provisionalDiff !== undefined &&
        provisionalActual !== null &&
        provisionalActual !== undefined && (
          <div style={detailStyle.provisional}>
            {t('admin.shiftAudit.detail.provisionalCut')
              .replace('{actual}', formatMoneyPlain(provisionalActual))
              .replace('{diff}', formatMoneyPlain(provisionalDiff))}
          </div>
        )}

      {movements.length > 0 && (
        <div style={detailStyle.movementsSection}>
          <div style={detailStyle.movementsTitle}>
            {t('admin.shiftAudit.detail.movements').replace(
              '{n}',
              String(movements.length),
            )}
          </div>
          <ul style={detailStyle.movementsList}>
            {movements.map((m) => {
              const isIn = m.type === 'CASH_IN';
              return (
                <li key={m.id} style={detailStyle.movementRow}>
                  <span style={detailStyle.movementTime}>{fmtTime(m.created_at)}</span>
                  <span
                    style={{
                      ...detailStyle.movementAmt,
                      color: isIn ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {isIn ? '+' : '−'}${formatMoneyPlain(m.amount)}
                  </span>
                  <span style={detailStyle.movementReason}>{m.reason}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  customValue,
  strong,
  empty,
}: {
  label: string;
  value?: string | number | null;
  customValue?: React.ReactNode;
  strong?: boolean;
  empty?: boolean;
}) {
  return (
    <div style={detailStyle.row}>
      <dt style={detailStyle.label}>{label}</dt>
      <dd
        style={{
          ...detailStyle.value,
          fontWeight: strong ? 700 : 500,
          opacity: empty ? 0.5 : 1,
        }}
      >
        {customValue ?? (empty ? '—' : `$${formatMoneyPlain(value ?? '0')}`)}
      </dd>
    </div>
  );
}

// ─── Close-shift modal ────────────────────────────────────────────────────

function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

interface CloseShiftPanelProps {
  shift: CashRegisterDetail;
  // True when today's daily report already exists. When set, the "Also end
  // day" toggle is disabled so the cashier can't trigger a 409.
  todayClosed: boolean;
  onClose: () => void;
}

function CloseShiftPanel({ shift, todayClosed, onClose }: CloseShiftPanelProps) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  // End-day requires both the role AND that today isn't already closed.
  const canEndDay = ROLES_CAN_END_DAY.has(role) && !todayClosed;
  const queryClient = useQueryClient();
  const [actualInput, setActualInput] = useState('');
  const [endDay, setEndDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    expected: string;
    submitted: number;
    diff: string;
    dayClosedFolio: number | null;
    dayError: string | null;
  } | null>(null);

  const closeMutation = useMutation({
    mutationFn: async (amount: number) => {
      const closed = await closeRegister(shift.id, { actual_amount: amount });
      if (endDay && canEndDay) {
        try {
          const day = await closeDailyReport();
          return { closed, dayClosedFolio: day.folio, dayError: null as string | null };
        } catch (err) {
          const msg =
            err instanceof ApiError ? err.message : t('register.couldNotClose');
          return { closed, dayClosedFolio: null as number | null, dayError: msg };
        }
      }
      return {
        closed,
        dayClosedFolio: null as number | null,
        dayError: null as string | null,
      };
    },
    onSuccess: ({ closed, dayClosedFolio, dayError }, amount) => {
      queryClient.setQueryData(['register', 'current'], null);
      queryClient.invalidateQueries({ queryKey: ['register'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'shifts'] });
      if (dayClosedFolio !== null) {
        queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
        queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      }
      setResult({
        expected: closed.expected_amount,
        submitted: amount,
        diff: closed.difference ?? '0',
        dayClosedFolio,
        dayError,
      });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('register.couldNotClose')),
  });

  function submit() {
    setError(null);
    const amt = parseAmount(actualInput);
    if (amt == null) {
      setError(t('register.enterCounted'));
      return;
    }
    closeMutation.mutate(amt);
  }

  const diffNum = result ? Number(result.diff) : 0;
  const diffPrefix = diffNum > 0 ? '+' : '';
  const diffColor =
    diffNum === 0 ? 'var(--green)' : diffNum > 0 ? 'var(--gold)' : 'var(--red)';

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()} role="dialog">
        <header style={modalHead}>
          <div style={modalTitle}>
            {result ? t('register.resultsTitle') : t('register.closeShift')}
          </div>
          <div style={modalSub}>
            {result
              ? result.dayClosedFolio !== null
                ? t('register.resultsSubDayClosed').replace(
                    '{folio}',
                    `Z-${String(result.dayClosedFolio).padStart(4, '0')}`,
                  )
                : t('register.resultsSubNormal')
              : t('register.closeShiftSub')}
          </div>
        </header>

        <div style={modalBody}>
          {result ? (
            <>
              <div style={resultsGrid}>
                <span>{t('register.expected')}</span>
                <span style={resultsAmt}>{formatMoney(result.expected)}</span>
                <span>{t('register.counted')}</span>
                <span style={resultsAmt}>{formatMoney(result.submitted)}</span>
              </div>
              <div style={{ ...resultsGrid, ...diffRow, color: diffColor }}>
                <span>{t('register.difference')}</span>
                <span style={{ ...diffAmt, color: 'inherit' }}>
                  {diffNum === 0
                    ? formatMoney(0)
                    : diffPrefix + formatMoney(result.diff)}
                </span>
              </div>
              {result.dayClosedFolio !== null && (
                <div style={dayBannerOk}>
                  {t('register.dayClosedBadge').replace(
                    '{folio}',
                    `Z-${String(result.dayClosedFolio).padStart(4, '0')}`,
                  )}
                </div>
              )}
              {result.dayError && (
                <div style={dayBannerErr}>
                  {t('register.dayCloseFailed').replace('{error}', result.dayError)}
                </div>
              )}
            </>
          ) : (
            <>
              <label style={fieldLabel}>
                {t('register.blindCountPrompt')} (MXN)
              </label>
              <input
                autoFocus
                inputMode="decimal"
                style={fieldInput}
                placeholder="0.00"
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div style={fieldHint}>{t('register.blindCountHint')}</div>

              <label
                style={{
                  ...endDayToggle.root,
                  borderColor: endDay && canEndDay ? 'var(--text1)' : 'var(--border)',
                  background:
                    endDay && canEndDay ? 'rgba(44,36,32,0.05)' : 'var(--bg2)',
                  opacity: canEndDay ? 1 : 0.5,
                  cursor: canEndDay ? 'pointer' : 'not-allowed',
                }}
              >
                <input
                  type="checkbox"
                  checked={endDay && canEndDay}
                  disabled={!canEndDay}
                  onChange={(e) => setEndDay(e.target.checked)}
                  style={endDayToggle.checkbox}
                />
                <div>
                  <div style={endDayToggle.title}>
                    {t('register.endChoiceEndDay')}
                  </div>
                  <div style={endDayToggle.hint}>
                    {canEndDay
                      ? t('register.endChoiceEndDayHint')
                      : todayClosed
                        ? t('register.endChoiceDayClosed')
                        : t('register.endChoiceManagerOnly')}
                  </div>
                </div>
              </label>

              {error && <div style={errBanner}>{error}</div>}
            </>
          )}
        </div>

        <footer style={modalFooter}>
          {!result && (
            <button type="button" style={cancelBtn} onClick={onClose}>
              {t('common.cancel')}
            </button>
          )}
          <button
            type="button"
            style={primaryBtn}
            disabled={!result && closeMutation.isPending}
            onClick={result ? onClose : submit}
          >
            {closeMutation.isPending && <Spinner size={12} />}
            {result
              ? t('common.done')
              : endDay && canEndDay
                ? t('register.submitCountAndEndDay')
                : t('register.submitCount')}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── End-day-only modal ───────────────────────────────────────────────────

function EndDayPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [folio, setFolio] = useState<number | null>(null);

  const endDayMutation = useMutation({
    mutationFn: () => closeDailyReport(),
    onSuccess: (day) => {
      setFolio(day.folio);
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'shifts'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('register.couldNotClose')),
  });

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()} role="dialog">
        <header style={modalHead}>
          <div style={modalTitle}>
            {folio !== null
              ? t('register.resultsTitle')
              : t('admin.shiftAudit.endDay.title')}
          </div>
          <div style={modalSub}>
            {folio !== null
              ? t('register.resultsSubDayClosed').replace(
                  '{folio}',
                  `Z-${String(folio).padStart(4, '0')}`,
                )
              : t('admin.shiftAudit.endDay.sub')}
          </div>
        </header>
        <div style={modalBody}>
          {folio !== null ? (
            <div style={dayBannerOk}>
              {t('register.dayClosedBadge').replace(
                '{folio}',
                `Z-${String(folio).padStart(4, '0')}`,
              )}
            </div>
          ) : (
            <div style={fieldHint}>{t('admin.shiftAudit.endDay.confirm')}</div>
          )}
          {error && <div style={errBanner}>{error}</div>}
        </div>
        <footer style={modalFooter}>
          {folio === null ? (
            <>
              <button type="button" style={cancelBtn} onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                style={primaryBtn}
                disabled={endDayMutation.isPending}
                onClick={() => endDayMutation.mutate()}
              >
                {endDayMutation.isPending && <Spinner size={12} />}
                {t('admin.shiftAudit.endDay.confirmBtn')}
              </button>
            </>
          ) : (
            <button type="button" style={primaryBtn} onClick={onClose}>
              {t('common.done')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ─── Reopen daily report modal ───────────────────────────────────────────

function ReopenDayPanel({
  report,
  onClose,
}: {
  report: DailyReportSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const reopenMutation = useMutation({
    mutationFn: () => reopenDailyReport(report.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'shifts'] });
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : t('admin.shiftAudit.zReport.reopenFailed')),
  });

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()} role="dialog">
        <header style={modalHead}>
          <div style={modalTitle}>
            {t('admin.shiftAudit.zReport.reopenTitle').replace(
              '{folio}',
              folioLabel(report.folio),
            )}
          </div>
          <div style={modalSub}>{t('admin.shiftAudit.zReport.reopenSub')}</div>
        </header>
        <div style={modalBody}>
          <div style={fieldHint}>{t('admin.shiftAudit.zReport.reopenConfirm')}</div>
          {error && <div style={errBanner}>{error}</div>}
        </div>
        <footer style={modalFooter}>
          <button
            type="button"
            style={cancelBtn}
            onClick={onClose}
            disabled={reopenMutation.isPending}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={primaryBtn}
            disabled={reopenMutation.isPending}
            onClick={() => reopenMutation.mutate()}
          >
            {reopenMutation.isPending && <Spinner size={12} />}
            {t('admin.shiftAudit.zReport.reopenBtn')}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

// 9-column track shared between day-group header and shift rows.
const COLUMN_TRACK =
  'minmax(220px, 1.6fr) 96px 64px 116px 100px 100px 110px 144px 76px';


const filterRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 16,
  alignItems: 'flex-end',
  marginBottom: 16,
};

const flaggedPillActive: CSSProperties = {
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  borderColor: 'rgba(196,80,64,0.45)',
};

const flaggedPillBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 18,
  height: 18,
  padding: '0 5px',
  borderRadius: 999,
  marginLeft: 6,
  background: 'rgba(196,80,64,0.18)',
  color: 'var(--red)',
  fontSize: 10,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const kpiTileActive: CSSProperties = {
  background: 'rgba(196,80,64,0.06)',
  borderColor: 'rgba(196,80,64,0.45)',
};

const endDayPromptStyle = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: '12px 16px',
    background: 'var(--bg2)',
    border: '1px dashed rgba(201,164,92,0.55)',
    borderRadius: 10,
    marginBottom: 14,
  } as CSSProperties,
  text: { display: 'flex', flexDirection: 'column', gap: 2 } as CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
  } as CSSProperties,
  sub: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.4,
  } as CSSProperties,
  btn: {
    padding: '9px 16px',
    borderRadius: 8,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    minHeight: 40,
    fontFamily: 'inherit',
  } as CSSProperties,
};

const dayList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  overflowX: 'auto',
  paddingBottom: 4,
};

const emptyStateStyle = {
  root: {
    padding: '48px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    background: 'var(--bg2)',
    border: '1px dashed var(--border)',
    borderRadius: 12,
  } as CSSProperties,
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    marginBottom: 6,
  } as CSSProperties,
  sub: {
    fontSize: 13,
    color: 'var(--text2)',
    marginBottom: 16,
    lineHeight: 1.5,
  } as CSSProperties,
  btn: {
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as CSSProperties,
};

const errorStateStyle = {
  root: {
    padding: '32px 24px',
    textAlign: 'center',
    background: 'rgba(196,80,64,0.06)',
    border: '1px solid rgba(196,80,64,0.28)',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
  } as CSSProperties,
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--red)',
  } as CSSProperties,
  btn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid rgba(196,80,64,0.45)',
    background: 'var(--bg2)',
    color: 'var(--red)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
  } as CSSProperties,
};

const dayGroupStyle = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: '0 1px 0 rgba(44,36,32,0.02), 0 2px 10px rgba(44,36,32,0.04)',
    minWidth: 1080,
    flexShrink: 0,
  } as CSSProperties,
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '14px 0 14px',
    outline: 'none',
  } as CSSProperties,
  headRow: {
    display: 'grid',
    gridTemplateColumns: COLUMN_TRACK,
    alignItems: 'baseline',
    gap: 12,
    padding: '0 18px',
  } as CSSProperties,
  titleCell: {
    gridColumn: '1 / 4',
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  } as CSSProperties,
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    textTransform: 'capitalize',
    letterSpacing: '-0.005em',
    lineHeight: 1.2,
  } as CSSProperties,
  titleYear: {
    fontSize: 11,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.1em',
  } as CSSProperties,
  todayBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    background: 'rgba(201,164,92,0.22)',
    color: '#7a5d2a',
  } as CSSProperties,
  headChevronSlot: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
  } as CSSProperties,
  subTitleCell: {
    gridColumn: '1 / 4',
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    minWidth: 0,
    flexWrap: 'wrap',
  } as CSSProperties,
  shiftCount: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 700,
  } as CSSProperties,
  // Z-report ribbon — folio chip + view/reopen actions, shown when the day's
  // DailyReport exists. stopPropagation on the wrapper so clicks don't toggle
  // the day-expand header.
  zRibbon: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'default',
  } as CSSProperties,
  zFolio: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    padding: '4px 10px',
    borderRadius: 999,
    background: 'rgba(74,140,92,0.16)',
    color: '#3a6a48',
    fontVariantNumeric: 'tabular-nums',
    textTransform: 'uppercase',
  } as CSSProperties,
  zBtn: {
    appearance: 'none',
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '0.02em',
  } as CSSProperties,
  zBtnDanger: {
    color: 'var(--red)',
    borderColor: 'rgba(196,80,64,0.4)',
  } as CSSProperties,
  colLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  colValue: {
    fontSize: 14,
    color: 'var(--text2)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  } as CSSProperties,
  varianceTotal: {
    textAlign: 'right',
    fontSize: 14,
  } as CSSProperties,
  rows: {
    display: 'flex',
    flexDirection: 'column',
  } as CSSProperties,
};

const shiftRowStyle = {
  wrapper: {} as CSSProperties,
  wrapperExpanded: {
    background: 'rgba(44,36,32,0.022)',
  } as CSSProperties,
  row: {
    display: 'grid',
    gridTemplateColumns: COLUMN_TRACK,
    alignItems: 'center',
    gap: 12,
    padding: '14px 18px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: 'var(--text1)',
    outline: 'none',
  } as CSSProperties,
  identity: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  } as CSSProperties,
  identityText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  } as CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  timeRange: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  arrow: { color: 'var(--text3)', fontSize: 11 } as CSSProperties,
  statusSlot: {
    display: 'flex',
    justifyContent: 'flex-start',
  } as CSSProperties,
  duration: {
    fontSize: 12,
    color: 'var(--text2)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  numStrong: {
    fontSize: 14,
    color: 'var(--text1)',
    fontWeight: 600,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  numMuted: {
    fontSize: 13,
    color: 'var(--text2)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 400,
  } as CSSProperties,
  varianceSlot: {
    textAlign: 'right',
    fontSize: 14,
  } as CSSProperties,
  actionSlot: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
  } as CSSProperties,
  chevron: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
  } as CSSProperties,
  closeBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    minHeight: 36,
    fontFamily: 'inherit',
    letterSpacing: '0.02em',
  } as CSSProperties,
  closeBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  } as CSSProperties,
  expand: {
    padding: '4px 18px 18px',
  } as CSSProperties,
};

const avatarStyle = {
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: '50%',
    color: '#fdf9f1',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'inherit',
    letterSpacing: '0.04em',
    flexShrink: 0,
    boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12), 0 1px 0 rgba(255,255,255,0.08)',
  } as CSSProperties,
};

const statusPillStyle = {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  open: {
    background: 'rgba(74,140,92,0.16)',
    color: '#2f6d45',
  } as CSSProperties,
  openDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--green)',
    boxShadow: '0 0 0 2px rgba(74,140,92,0.18)',
  } as CSSProperties,
  closed: {
    background: 'rgba(168,152,136,0.16)',
    color: 'var(--text2)',
  } as CSSProperties,
  provisional: {
    background: 'rgba(201,164,92,0.18)',
    color: '#8a6d2a',
  } as CSSProperties,
};

const varianceSizes: Record<
  VarianceSize,
  {
    base: CSSProperties;
    value: CSSProperties;
    empty: CSSProperties;
    zero: CSSProperties;
    glyph: CSSProperties;
  }
> = {
  row: {
    base: {
      display: 'inline-flex',
      alignItems: 'baseline',
      justifyContent: 'flex-end',
      gap: 4,
      fontVariantNumeric: 'tabular-nums',
      width: '100%',
      fontSize: 14,
    } as CSSProperties,
    value: { fontWeight: 600 } as CSSProperties,
    empty: { color: 'var(--text3)' } as CSSProperties,
    zero: { color: 'var(--text3)', fontWeight: 400 } as CSSProperties,
    glyph: { fontSize: 10, position: 'relative', top: -1 } as CSSProperties,
  },
  day: {
    base: {
      display: 'inline-flex',
      alignItems: 'baseline',
      justifyContent: 'flex-end',
      gap: 4,
      fontVariantNumeric: 'tabular-nums',
      width: '100%',
      fontSize: 14,
    } as CSSProperties,
    value: { fontWeight: 700 } as CSSProperties,
    empty: { color: 'var(--text3)' } as CSSProperties,
    zero: { color: 'var(--text3)', fontWeight: 500 } as CSSProperties,
    glyph: { fontSize: 10, position: 'relative', top: -1 } as CSSProperties,
  },
  kpi: {
    base: {
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: 6,
      fontFamily: "'Playfair Display', serif",
      fontSize: 22,
      fontWeight: 600,
      lineHeight: 1.1,
      fontVariantNumeric: 'tabular-nums',
    } as CSSProperties,
    value: {} as CSSProperties,
    empty: { color: 'var(--text3)' } as CSSProperties,
    zero: { color: 'var(--text1)' } as CSSProperties,
    glyph: { fontSize: 14, position: 'relative', top: -2 } as CSSProperties,
  },
};

const detailStyle = {
  root: {
    padding: '4px 4px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    borderTop: '1px dashed rgba(168,152,136,0.35)',
    paddingTop: 14,
  } as CSSProperties,
  cols: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0 32px',
  } as CSSProperties,
  dl: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
  } as CSSProperties,
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'baseline',
    padding: '7px 0',
    borderBottom: '1px dashed rgba(168,152,136,0.25)',
    gap: 12,
  } as CSSProperties,
  label: {
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    margin: 0,
  } as CSSProperties,
  value: {
    fontSize: 14,
    color: 'var(--text1)',
    margin: 0,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  } as CSSProperties,
  provisional: {
    fontSize: 12,
    color: '#7a5d2a',
    background: 'rgba(201,164,92,0.10)',
    border: '1px solid rgba(201,164,92,0.28)',
    padding: '8px 12px',
    borderRadius: 8,
    lineHeight: 1.5,
  } as CSSProperties,
  movementsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } as CSSProperties,
  movementsTitle: {
    fontSize: 11,
    color: 'var(--text3)',
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
  } as CSSProperties,
  movementsList: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  } as CSSProperties,
  movementRow: {
    display: 'grid',
    gridTemplateColumns: '80px 110px 1fr',
    gap: 14,
    alignItems: 'baseline',
    padding: '5px 0',
    fontSize: 13,
  } as CSSProperties,
  movementTime: {
    color: 'var(--text3)',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  movementAmt: {
    fontWeight: 600,
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  } as CSSProperties,
  movementReason: {
    color: 'var(--text2)',
    fontSize: 13,
  } as CSSProperties,
};

// ─── Modal styles ─────────────────────────────────────────────────────────

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 80,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};
const modalCard: CSSProperties = {
  width: 520,
  maxWidth: '100%',
  background: 'var(--bg2)',
  borderRadius: 14,
  border: '1px solid var(--border)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};
const modalHead: CSSProperties = {
  padding: '20px 24px 14px',
  borderBottom: '1px solid var(--border)',
};
const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  color: 'var(--text1)',
};
const modalSub: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  marginTop: 4,
  lineHeight: 1.4,
};
const modalBody: CSSProperties = {
  padding: '18px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const modalFooter: CSSProperties = {
  padding: '14px 24px 18px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
};
const fieldLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text2)',
};
const fieldInput: CSSProperties = {
  height: 44,
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '0 12px',
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 16,
  outline: 'none',
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'inherit',
};
const fieldHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  lineHeight: 1.5,
};
const errBanner: CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(196,80,64,0.10)',
  border: '1px solid rgba(196,80,64,0.3)',
  color: 'var(--red)',
  borderRadius: 8,
  fontSize: 12,
};
const dayBannerOk: CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(201,164,92,0.14)',
  border: '1px solid rgba(201,164,92,0.35)',
  color: 'var(--gold)',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
};
const dayBannerErr: CSSProperties = {
  padding: '10px 12px',
  background: 'rgba(196,80,64,0.10)',
  border: '1px solid rgba(196,80,64,0.3)',
  color: 'var(--red)',
  borderRadius: 8,
  fontSize: 12,
};
const resultsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  rowGap: 12,
  columnGap: 16,
  fontSize: 14,
  color: 'var(--text2)',
};
const resultsAmt: CSSProperties = {
  color: 'var(--text1)',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 600,
  fontSize: 16,
};
const diffRow: CSSProperties = {
  paddingTop: 14,
  borderTop: '1px solid var(--border)',
  fontWeight: 700,
  fontSize: 16,
};
const diffAmt: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};
const cancelBtn: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  background: 'var(--bg2)',
  color: 'var(--text2)',
  border: '1px solid var(--border)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  minHeight: 40,
  fontFamily: 'inherit',
};
const primaryBtn: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  background: 'var(--text1)',
  color: '#fff',
  border: 'none',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 40,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'inherit',
};
const endDayToggle = {
  root: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    fontFamily: 'inherit',
  } as CSSProperties,
  checkbox: {
    marginTop: 2,
    width: 18,
    height: 18,
    accentColor: 'var(--text1)',
  } as CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
  } as CSSProperties,
  hint: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 2,
    lineHeight: 1.4,
  } as CSSProperties,
};
