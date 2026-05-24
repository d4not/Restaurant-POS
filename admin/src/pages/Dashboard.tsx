import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, EmptyState, KPICard, Table } from '../components/ui';
import type { TableColumn } from '../components/ui';
import { SalesBarChart, type SalesBarDatum } from '../components/charts/SalesBarChart';
import { useOrders } from '../hooks/useOrders';
import { useLowStock } from '../hooks/useAlerts';
import type { LowStockAlert } from '../api/alerts';
import type { Order } from '../types/operations';
import { orderStatusLabel, orderTypeLabel } from '../types/operations';
import { orderStatusTone, orderTypeTone } from './staff/operations-meta';
import {
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
} from '../utils/format';
import { useTranslation } from '../i18n';

/** Midnight of `daysAgo` days before today, local time → ISO. */
function startOfDayOffset(daysAgo: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

/** End-of-day today, local time → ISO. */
function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** YYYY-MM-DD local-timezone key for grouping by day. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localDayKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Last 7 days of PAID orders — feeds both the 7-day chart and the
  // "today" KPIs (just the subset with created_at in today's bucket).
  const sevenDayRange = useMemo(
    () => ({
      status: 'PAID' as const,
      from: startOfDayOffset(6),
      to:   endOfToday(),
    }),
    [],
  );
  const weekOrdersQ = useOrders(sevenDayRange);
  const weekOrders = useMemo<Order[]>(
    () => weekOrdersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [weekOrdersQ.data],
  );

  // Most-recent 10 orders across all statuses — the "Recent orders" card.
  const recentQ = useOrders({});
  const recent = useMemo<Order[]>(
    () => (recentQ.data?.pages.flatMap((p) => p.items) ?? []).slice(0, 10),
    [recentQ.data],
  );

  const lowStockQ = useLowStock();
  const lowStock = lowStockQ.data?.items ?? [];

  /* ── KPIs ─────────────────────────────────────────────── */

  const todayKey = localDayKeyFromDate(new Date());
  const todayOrders = useMemo(
    () => weekOrders.filter((o) => localDayKey(o.created_at) === todayKey),
    [weekOrders, todayKey],
  );
  const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.total), 0);
  const todayCount = todayOrders.length;
  const avgTicket = todayCount > 0 ? todaySales / todayCount : 0;

  /* ── 7-day chart data ─────────────────────────────────── */

  const chartData = useMemo<SalesBarDatum[]>(() => {
    // Build the 7 buckets explicitly so days with zero sales still show up.
    const buckets: SalesBarDatum[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      buckets.push({
        label: formatDateShort(d),
        value: 0,
      });
    }
    const byKey = new Map<string, SalesBarDatum>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      byKey.set(localDayKeyFromDate(d), buckets[6 - i]!);
    }
    for (const o of weekOrders) {
      const bucket = byKey.get(localDayKey(o.created_at));
      if (bucket) bucket.value += Number(o.total);
    }
    return buckets;
  }, [weekOrders]);

  /* ── Recent orders table ──────────────────────────────── */

  const orderColumns: TableColumn<Order>[] = [
    {
      key: 'number',
      header: '#',
      width: '70px',
      render: (o) => <span className="fw-600 fs-13">#{o.order_number}</span>,
    },
    {
      key: 'date',
      header: t('common.date'),
      width: '170px',
      render: (o) => (
        <span className="fs-12 text-muted">{formatDateTime(o.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: t('common.type'),
      width: '110px',
      render: (o) => (
        <Badge tone={orderTypeTone(o.order_type)}>
          {orderTypeLabel(o.order_type)}
        </Badge>
      ),
    },
    {
      key: 'cashier',
      header: t('role.cashier'),
      width: '1fr',
      render: (o) => <span className="fs-13">{o.user?.name ?? '—'}</span>,
    },
    {
      key: 'total',
      header: t('common.total'),
      width: '120px',
      render: (o) => (
        <span className="fw-600 fs-13">{formatMoney(Number(o.total))}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '110px',
      render: (o) => (
        <Badge tone={orderStatusTone(o.status)}>
          {orderStatusLabel(o.status)}
        </Badge>
      ),
    },
  ];

  /* ── Low-stock list ───────────────────────────────────── */

  // Sort low-stock alerts so the most urgent (out, then biggest shortfall)
  // surface at the top of the dashboard card.
  const sortedLowStock = [...lowStock].sort((a, b) => {
    const aOut = Number.parseFloat(a.quantity) <= 0;
    const bOut = Number.parseFloat(b.quantity) <= 0;
    if (aOut !== bOut) return aOut ? -1 : 1;
    return Number.parseFloat(b.shortfall) - Number.parseFloat(a.shortfall);
  });

  const alertColumns: TableColumn<LowStockAlert>[] = [
    {
      key: 'severity',
      header: '',
      width: '70px',
      render: (a) => {
        const isOut = Number.parseFloat(a.quantity) <= 0;
        const label = isOut ? t('stock.severity.out') : t('stock.severity.low');
        const cls = isOut ? 'badge badge-red' : 'badge badge-gold';
        return <span className={cls}>{label}</span>;
      },
    },
    {
      key: 'supply',
      header: t('nav.supplies'),
      width: '1.4fr',
      render: (a) => (
        <div>
          <div className="fw-600 fs-13">{a.supply_name}</div>
          <div className="fs-11 text-muted">{a.storage_name}</div>
        </div>
      ),
    },
    {
      key: 'stock',
      header: t('supplies.colStock'),
      width: '120px',
      render: (a) => {
        const qty = Number.parseFloat(a.quantity);
        const min = Number.parseFloat(a.min_stock);
        const ratio = min > 0 ? Math.max(0, Math.min(1, qty / min)) : 0;
        const isOut = qty <= 0;
        const fillClass = isOut ? 'low' : 'warn';
        return (
          <div>
            <div className="fs-13">
              {formatNumber(a.quantity, 2)}{' '}
              <span className="text-muted fs-11">/ {formatNumber(a.min_stock, 2)}</span>
            </div>
            <div className="stock-track mt-4">
              <div className={`stock-fill ${fillClass}`} style={{ width: `${ratio * 100}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'short',
      header: t('supplies.lowStock'),
      width: '90px',
      render: (a) => {
        const isOut = Number.parseFloat(a.quantity) <= 0;
        return (
          <span className={`fw-600 fs-13 ${isOut ? 'text-red' : 'text-gold'}`}>
            −{formatNumber(a.shortfall, 2)}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard
          accent
          label={t('dashboard.salesToday')}
          value={formatMoney(todaySales)}
          sub={weekOrdersQ.isLoading ? `${t('common.loading')}…` : `${todayCount} ${t('orders.statusPaid').toLowerCase()}`}
        />
        <KPICard
          label={t('dashboard.ordersToday')}
          value={todayCount}
          sub={weekOrdersQ.isLoading ? `${t('common.loading')}…` : t('orders.statusPaid')}
        />
        <KPICard
          label={t('dashboard.avgTicket')}
          value={formatMoney(avgTicket)}
          sub={todayCount > 0 ? t('orders.statusPaid') : t('orders.empty')}
        />
        <KPICard
          label={t('dashboard.lowStock')}
          value={lowStock.length}
          valueColor={lowStock.length > 0 ? 'red' : 'default'}
          sub={lowStockQ.isLoading ? `${t('common.loading')}…` : lowStock.length === 0 ? t('common.ok') : t('error.tryAgain')}
        />
      </div>

      <div className="section-grid-3">
        <Card title={t('dashboard.salesLast7')}>
          {weekOrdersQ.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : chartData.every((d) => d.value === 0) ? (
            <EmptyState
              icon="📈"
              message={t('orders.empty')}
              sub={t('dashboard.salesLast7')}
            />
          ) : (
            <SalesBarChart data={chartData} />
          )}
        </Card>

        <Card
          title={t('dashboard.lowStockAlerts')}
          actions={
            lowStock.length > 0 ? (
              <button
                type="button"
                className="filter-pill"
                onClick={() => navigate('/inventory/supplies')}
              >
                {t('nav.supplies')}
              </button>
            ) : null
          }
        >
          {lowStockQ.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : lowStock.length === 0 ? (
            <EmptyState
              icon="🔔"
              message={t('common.ok')}
              sub={t('dashboard.lowStockAlerts')}
            />
          ) : (
            <Table
              columns={alertColumns}
              rows={sortedLowStock.slice(0, 8)}
              getRowKey={(a) => `${a.supply_id}|${a.storage_id}`}
              onRowClick={(a) => navigate(`/inventory/supplies/${a.supply_id}`)}
            />
          )}
        </Card>
      </div>

      <div className="mt-16">
        <Card
          title={t('dashboard.recentOrders')}
          actions={
            <button
              type="button"
              className="filter-pill"
              onClick={() => navigate('/orders')}
            >
              {t('common.all')}
            </button>
          }
        >
          <Table
            columns={orderColumns}
            rows={recent}
            getRowKey={(o) => o.id}
            onRowClick={(o) => navigate(`/orders?id=${o.id}`)}
            isInitialLoad={recentQ.isLoading}
            error={recentQ.error as Error | null}
            emptyMessage={t('orders.empty')}
            emptySub={t('dashboard.recentOrders')}
          />
        </Card>
      </div>
    </>
  );
}
