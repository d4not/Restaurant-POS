import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  fetchOrderHistory,
  type ActiveOrder,
  type ActiveOrderItem,
  type OrderStatus,
} from '../api/orders';
import { ApiError } from '../api/client';
import { MetricCard } from '../components/MetricCard';
import { Spinner } from '../components/Spinner';
import { formatMoney } from '../utils/format';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n/en';

type StatusFilter = 'ALL' | 'PAID' | 'CANCELLED';

const STATUS_FILTERS: { value: StatusFilter; labelKey: TranslationKey }[] = [
  { value: 'ALL', labelKey: 'history.filterAll' },
  { value: 'PAID', labelKey: 'history.filterPaid' },
  { value: 'CANCELLED', labelKey: 'history.filterCancelled' },
];

// Default to today (local-time start of day → end of day). The backend
// translates these to UTC, which is fine for a single-timezone deployment.
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function toDateInputValue(d: Date): string {
  // <input type=date> wants YYYY-MM-DD in local time.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fromDateInputValue(value: string, kind: 'start' | 'end'): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (kind === 'start') dt.setHours(0, 0, 0, 0);
  else dt.setHours(23, 59, 59, 999);
  return dt;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    background: 'var(--bg)',
  },
  head: {
    padding: '22px 32px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
  },
  titleBlock: { minWidth: 0 },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 28,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  sub: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
  },
  toolbar: {
    display: 'flex',
    gap: 12,
    padding: '14px 32px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    flexWrap: 'wrap',
    background: 'var(--bg)',
  },
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    width: 280,
    minHeight: 42,
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    flex: 1,
    fontSize: 14,
    fontFamily: 'inherit',
    color: 'var(--text1)',
  },
  dateGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    minHeight: 42,
  },
  dateLabel: {
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  dateInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: 'var(--text1)',
    fontFamily: 'inherit',
    padding: '4px 0',
    minWidth: 130,
  },
  pillRow: { display: 'flex', gap: 6, marginLeft: 'auto' },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '20px 32px 32px',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 14,
    marginBottom: 22,
  },
  table: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  },
  th: {
    display: 'grid',
    gridTemplateColumns: '90px 90px 110px 70px 1fr 100px 110px 110px 36px',
    columnGap: 18,
    padding: '14px 22px',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--text3)',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
  },
  trBase: {
    display: 'grid',
    gridTemplateColumns: '90px 90px 110px 70px 1fr 100px 110px 110px 36px',
    columnGap: 18,
    padding: '18px 22px',
    fontSize: 13,
    color: 'var(--text1)',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'background 0.12s',
    fontFamily: 'inherit',
    background: 'transparent',
  },
  cellMuted: { color: 'var(--text2)' },
  cellNum: {
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  cellOrderNum: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  expandIcon: {
    color: 'var(--text3)',
    fontSize: 14,
    transition: 'transform 0.15s',
    textAlign: 'center',
  },
  expandedBody: {
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    padding: '16px 22px 22px',
  },
  expandedGrid: {
    display: 'grid',
    gridTemplateColumns: '1.5fr 1fr',
    gap: 18,
  },
  expandedSection: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  expandedHd: {
    padding: '12px 16px',
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--text3)',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
  },
  itemRow: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr auto',
    gap: 12,
    padding: '12px 16px',
    borderBottom: '1px solid rgba(44,36,32,0.06)',
    alignItems: 'flex-start',
  },
  itemQty: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  itemName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
    lineHeight: 1.3,
  },
  itemMods: {
    fontSize: 11,
    color: 'var(--text2)',
    fontStyle: 'italic',
    marginTop: 2,
  },
  itemNote: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text1)',
    fontFamily: "'Playfair Display', serif",
  },
  paymentRow: {
    display: 'grid',
    gridTemplateColumns: '70px 1fr auto',
    gap: 10,
    padding: '10px 16px',
    borderBottom: '1px solid rgba(44,36,32,0.06)',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
  },
  totalsBlock: {
    padding: '14px 16px',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    rowGap: 6,
    columnGap: 12,
    fontSize: 13,
    color: 'var(--text2)',
  },
  totalsAmt: {
    color: 'var(--text1)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  },
  grandLabel: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text1)',
    paddingTop: 8,
    marginTop: 4,
    borderTop: '1px solid var(--border)',
  },
  grandAmt: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    paddingTop: 8,
    marginTop: 4,
    borderTop: '1px solid var(--border)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    padding: 80,
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 14,
  },
  errorState: {
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.25)',
    color: 'var(--red)',
    borderRadius: 10,
    padding: '20px 24px',
    fontSize: 13,
    textAlign: 'center',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
    gap: 14,
    color: 'var(--text2)',
  },
  loadMore: {
    margin: '20px auto 0',
    padding: '12px 28px',
    borderRadius: 10,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  noteBlock: {
    fontSize: 12,
    color: 'var(--text2)',
    padding: '10px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg)',
    fontStyle: 'italic',
  },
};

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 999,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text2)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 36,
  fontFamily: 'inherit',
});

const statusBadgeStyle = (status: OrderStatus): React.CSSProperties => {
  const palette: Record<OrderStatus, { bg: string; col: string }> = {
    OPEN: { bg: 'rgba(91,122,140,0.16)', col: '#3a566b' },
    PAID: { bg: 'rgba(74,140,92,0.18)', col: 'var(--green)' },
    CANCELLED: { bg: 'rgba(196,80,64,0.14)', col: 'var(--red)' },
  };
  const c = palette[status];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 999,
    background: c.bg,
    color: c.col,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    width: 'fit-content',
  };
};

function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatHistoryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function summarizePayments(
  order: ActiveOrder,
  t: (key: string) => string,
): { label: string; tag: string } {
  if (order.status === 'CANCELLED' || order.payments.length === 0) {
    return { label: '—', tag: '—' };
  }
  const methods = Array.from(new Set(order.payments.map((p) => p.method)));
  if (methods.length === 1) {
    const m = methods[0];
    return {
      label: m === 'CASH' ? t('payment.cash') : m === 'CARD' ? t('payment.card') : t('payment.transfer'),
      tag: m,
    };
  }
  return { label: t('history.split'), tag: 'split' };
}

function tableLabel(order: ActiveOrder, t: (key: string) => string): string {
  if (order.order_type === 'TAKEOUT') return t('detail.takeoutLabel');
  if (order.table) return `${t('detail.tableLabel')} ${order.table.number}`;
  return '—';
}

function matchesSearch(order: ActiveOrder, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return (
    String(order.order_number).includes(q) ||
    order.user.name.toLowerCase().includes(q) ||
    (order.table?.zone.name.toLowerCase() ?? '').includes(q) ||
    (order.table ? `table ${order.table.number}` : '').includes(q) ||
    order.notes?.toLowerCase().includes(q) === true
  );
}

export function OrderHistory() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [from, setFrom] = useState<Date>(startOfToday());
  const [to, setTo] = useState<Date>(endOfToday());
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const queryStatus: OrderStatus | undefined =
    statusFilter === 'ALL' ? undefined : (statusFilter as OrderStatus);

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery({
      queryKey: ['orders', 'history', queryStatus, from.toISOString(), to.toISOString()],
      queryFn: ({ pageParam }) =>
        fetchOrderHistory({
          status: queryStatus,
          from,
          to,
          cursor: pageParam,
          limit: 30,
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  // Refetch when the date range changes — useInfiniteQuery handles this via the
  // changing queryKey. We also collapse any expanded row so the user sees fresh
  // results from the top.
  useEffect(() => {
    setExpanded(null);
  }, [from, to, statusFilter]);

  // Escape collapses the open row. Without this, a cashier inspecting an order
  // would have to click outside or hit the row again.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const orders = useMemo(
    () => (data?.pages.flatMap((page) => page.items) ?? []),
    [data],
  );

  // Local search across whatever the server returned. Server-side search
  // doesn't exist on /orders yet, but for shift-scoped lookups (typical use
  // case) the page already contains the right rows.
  const visible = useMemo(
    () => orders.filter((o) => matchesSearch(o, search)),
    [orders, search],
  );

  const summary = useMemo(() => {
    let revenue = 0;
    let paidCount = 0;
    let cancelledCount = 0;
    for (const o of orders) {
      if (o.status === 'PAID') {
        paidCount += 1;
        revenue += Number(o.total);
      } else if (o.status === 'CANCELLED') {
        cancelledCount += 1;
      }
    }
    const avg = paidCount === 0 ? 0 : Math.round(revenue / paidCount);
    return { revenue, paidCount, cancelledCount, avg, total: orders.length };
  }, [orders]);

  const subtitle = useMemo(() => {
    const sameDay =
      from.getFullYear() === to.getFullYear() &&
      from.getMonth() === to.getMonth() &&
      from.getDate() === to.getDate();
    if (sameDay) {
      const today = startOfToday();
      const isToday = today.getTime() === from.getTime();
      return isToday
        ? t('history.subtitle')
        : from.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }
    return `${formatHistoryDate(from.toISOString())} – ${formatHistoryDate(to.toISOString())}`;
  }, [from, to, t]);

  return (
    <div style={styles.root}>
      <header style={styles.head}>
        <div style={styles.titleBlock}>
          <h1 style={styles.title}>{t('history.title')}</h1>
          <div style={styles.sub}>{subtitle}</div>
        </div>
      </header>

      <div style={styles.toolbar}>
        <div style={styles.search}>
          <span style={{ color: 'var(--text3)', fontSize: 14 }}>⌕</span>
          <input
            style={styles.searchInput}
            placeholder={t('history.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={styles.dateGroup}>
          <span style={styles.dateLabel}>{t('history.from')}</span>
          <input
            type="date"
            style={styles.dateInput}
            value={toDateInputValue(from)}
            max={toDateInputValue(to)}
            onChange={(e) => {
              const next = fromDateInputValue(e.target.value, 'start');
              if (next) setFrom(next);
            }}
          />
        </div>
        <div style={styles.dateGroup}>
          <span style={styles.dateLabel}>{t('history.to')}</span>
          <input
            type="date"
            style={styles.dateInput}
            value={toDateInputValue(to)}
            min={toDateInputValue(from)}
            onChange={(e) => {
              const next = fromDateInputValue(e.target.value, 'end');
              if (next) setTo(next);
            }}
          />
        </div>
        <div style={styles.pillRow}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              style={pillStyle(statusFilter === f.value)}
              onClick={() => setStatusFilter(f.value)}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.body}>
        <div style={styles.metrics}>
          <MetricCard label={t('history.metricsOrders')} value={summary.total.toString()} />
          <MetricCard label={t('history.metricsRevenue')} value={formatMoney(String(summary.revenue))} />
          <MetricCard
            label={t('history.metricsAvgTicket')}
            value={summary.paidCount > 0 ? formatMoney(String(summary.avg)) : '—'}
            hint={summary.paidCount > 0 ? `${summary.paidCount} ${t('payment.paid').toLowerCase()}` : undefined}
          />
          <MetricCard
            label={t('history.metricsCancelled')}
            value={summary.cancelledCount.toString()}
            tone={summary.cancelledCount > 0 ? 'red' : 'default'}
          />
        </div>

        {isLoading && (
          <div style={styles.loadingState}>
            <Spinner size={26} />
            <div>{t('common.loading')}…</div>
          </div>
        )}

        {!isLoading && error && (
          <div style={styles.errorState}>
            {error instanceof ApiError ? error.message : t('orders.failedLoad')}
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                style={styles.loadMore}
                onClick={() => refetch()}
              >
                {t('common.retry')}
              </button>
            </div>
          </div>
        )}

        {!isLoading && !error && (
          <div style={styles.table}>
            <div style={styles.th}>
              <span>{t('history.colOrder')} #</span>
              <span>{t('history.colTime')}</span>
              <span>{t('history.colTable')}</span>
              <span style={styles.cellNum}>{t('history.colItems')}</span>
              <span>{t('history.colWaiter')}</span>
              <span>{t('history.colPayment')}</span>
              <span style={styles.cellNum}>{t('history.colTotal')}</span>
              <span>{t('history.colStatus')}</span>
              <span />
            </div>

            {visible.length === 0 && (
              <div style={styles.empty}>
                {t('history.empty')}
              </div>
            )}

            {visible.map((order, idx) => {
              const isOpen = expanded === order.id;
              const pay = summarizePayments(order, t);
              const itemCount = order.items.reduce((acc, i) => acc + i.quantity, 0);
              const rowBg =
                idx % 2 === 0 ? 'transparent' : 'rgba(168,152,136,0.04)';
              return (
                <div key={order.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    style={{ ...styles.trBase, background: isOpen ? 'rgba(201,164,92,0.06)' : rowBg }}
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpanded(isOpen ? null : order.id);
                      }
                    }}
                  >
                    <span style={styles.cellOrderNum}>#{order.order_number}</span>
                    <span style={styles.cellMuted}>{formatHistoryTime(order.created_at)}</span>
                    <span>{tableLabel(order, t)}</span>
                    <span style={{ ...styles.cellNum, ...styles.cellMuted }}>{itemCount}</span>
                    <span style={styles.cellMuted}>{order.user.name}</span>
                    <span style={styles.cellMuted}>{pay.label}</span>
                    <span style={styles.cellNum}>{formatMoney(order.total)}</span>
                    <span>
                      <span style={statusBadgeStyle(order.status)}>{order.status}</span>
                    </span>
                    <span
                      style={{
                        ...styles.expandIcon,
                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    >
                      ⌃
                    </span>
                  </div>
                  {isOpen && <ExpandedOrder order={order} />}
                </div>
              );
            })}
          </div>
        )}

        {hasNextPage && !error && (
          <button
            type="button"
            style={styles.loadMore}
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? <Spinner size={14} /> : null}
            {isFetchingNextPage ? `${t('common.loading')}…` : t('history.loadMore')}
          </button>
        )}
      </div>
    </div>
  );
}

function ExpandedOrder({ order }: { order: ActiveOrder }) {
  const { t } = useTranslation();
  const items: ActiveOrderItem[] = order.items;

  return (
    <div style={styles.expandedBody}>
      <div style={styles.expandedGrid}>
        <div style={styles.expandedSection}>
          <div style={styles.expandedHd}>{t('orders.itemsLabel')} ({items.length})</div>
          {items.length === 0 ? (
            <div style={{ padding: 18, color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
              {t('orders.noItemsAdded')}
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} style={styles.itemRow}>
                <span style={styles.itemQty}>{item.quantity}×</span>
                <div>
                  <div style={styles.itemName}>
                    {item.product.name}
                    {item.variant && ` · ${item.variant.name}`}
                  </div>
                  {item.modifiers.length > 0 && (
                    <div style={styles.itemMods}>
                      {item.modifiers.map((m) => m.name).join(' · ')}
                    </div>
                  )}
                  {item.notes && <div style={styles.itemNote}>{t('orders.note')}: {item.notes}</div>}
                </div>
                <span style={styles.itemPrice}>{formatMoney(item.line_total)}</span>
              </div>
            ))
          )}
          {order.notes && <div style={styles.noteBlock}>{t('orders.notes')}: {order.notes}</div>}
        </div>

        <div>
          <div style={styles.expandedSection}>
            <div style={styles.expandedHd}>{t('history.totals')}</div>
            <div style={styles.totalsBlock}>
              <span>{t('payment.subtotal')}</span>
              <span style={styles.totalsAmt}>{formatMoney(order.subtotal)}</span>
              <span>{t('payment.tax')}</span>
              <span style={styles.totalsAmt}>{formatMoney(order.tax_amount)}</span>
              {Number(order.discount_amount) > 0 && (
                <>
                  <span>{t('detail.discount')}</span>
                  <span style={{ ...styles.totalsAmt, color: 'var(--red)' }}>
                    – {formatMoney(order.discount_amount)}
                  </span>
                </>
              )}
              <span style={styles.grandLabel}>{t('payment.total')}</span>
              <span style={styles.grandAmt}>{formatMoney(order.total)}</span>
            </div>
          </div>

          <div style={{ ...styles.expandedSection, marginTop: 14 }}>
            <div style={styles.expandedHd}>
              {t('history.colPayment')} ({order.payments.length})
            </div>
            {order.payments.length === 0 ? (
              <div
                style={{
                  padding: 18,
                  color: 'var(--text3)',
                  fontSize: 13,
                  fontStyle: 'italic',
                }}
              >
                {order.status === 'CANCELLED' ? t('history.orderCancelled') : t('history.noPayments')}
              </div>
            ) : (
              order.payments.map((p) => (
                <div key={p.id} style={styles.paymentRow}>
                  <span style={{ color: 'var(--text2)' }}>
                    {p.method === 'CASH' ? t('payment.cash') : p.method === 'CARD' ? t('payment.card') : t('payment.transfer')}
                  </span>
                  <span
                    style={{
                      color: 'var(--text3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.reference || formatHistoryTime(p.created_at)}
                  </span>
                  <span style={{ color: 'var(--text1)', fontWeight: 600 }}>
                    {formatMoney(p.amount)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
