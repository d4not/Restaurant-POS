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
      header: 'Date / time',
      width: '170px',
      render: (o) => (
        <span className="fs-12 text-muted">{formatDateTime(o.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '110px',
      render: (o) => (
        <Badge tone={orderTypeTone(o.order_type)}>
          {orderTypeLabel(o.order_type)}
        </Badge>
      ),
    },
    {
      key: 'cashier',
      header: 'Cashier',
      width: '1fr',
      render: (o) => <span className="fs-13">{o.user?.name ?? '—'}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      width: '120px',
      render: (o) => (
        <span className="fw-600 fs-13">{formatMoney(Number(o.total))}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (o) => (
        <Badge tone={orderStatusTone(o.status)}>
          {orderStatusLabel(o.status)}
        </Badge>
      ),
    },
  ];

  /* ── Low-stock list ───────────────────────────────────── */

  const alertColumns: TableColumn<LowStockAlert>[] = [
    {
      key: 'supply',
      header: 'Supply',
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
      header: 'On hand',
      width: '110px',
      render: (a) => (
        <span className="fs-13">
          {formatNumber(a.quantity, 2)} <span className="text-muted fs-11">{a.base_unit.toLowerCase()}</span>
        </span>
      ),
    },
    {
      key: 'min',
      header: 'Min',
      width: '100px',
      render: (a) => (
        <span className="fs-12 text-muted">{formatNumber(a.min_stock, 2)}</span>
      ),
    },
    {
      key: 'short',
      header: 'Short by',
      width: '110px',
      render: (a) => (
        <span className="fw-600 fs-13 text-red">
          −{formatNumber(a.shortfall, 2)}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard
          accent
          label="Sales today"
          value={formatMoney(todaySales)}
          sub={weekOrdersQ.isLoading ? 'Loading…' : `${todayCount} paid order${todayCount === 1 ? '' : 's'}`}
        />
        <KPICard
          label="Orders today"
          value={todayCount}
          sub={weekOrdersQ.isLoading ? 'Loading…' : 'Paid orders only'}
        />
        <KPICard
          label="Average ticket"
          value={formatMoney(avgTicket)}
          sub={todayCount > 0 ? 'Per paid order' : 'No orders yet'}
        />
        <KPICard
          label="Low stock supplies"
          value={lowStock.length}
          valueColor={lowStock.length > 0 ? 'red' : 'default'}
          sub={lowStockQ.isLoading ? 'Loading…' : lowStock.length === 0 ? 'All supplies above min' : 'Attention required'}
        />
      </div>

      <div className="section-grid-3">
        <Card title="Sales — last 7 days">
          {weekOrdersQ.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              Loading chart…
            </div>
          ) : chartData.every((d) => d.value === 0) ? (
            <EmptyState
              icon="📈"
              message="No sales yet this week"
              sub="Paid orders from the last 7 days will show up here."
            />
          ) : (
            <SalesBarChart data={chartData} />
          )}
        </Card>

        <Card
          title="Stock alerts"
          actions={
            lowStock.length > 0 ? (
              <button
                type="button"
                className="filter-pill"
                onClick={() => navigate('/inventory/supplies')}
              >
                View supplies
              </button>
            ) : null
          }
        >
          {lowStockQ.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              Loading…
            </div>
          ) : lowStock.length === 0 ? (
            <EmptyState
              icon="🔔"
              message="No alerts"
              sub="Every supply is above its configured minimum."
            />
          ) : (
            <Table
              columns={alertColumns}
              rows={lowStock.slice(0, 8)}
              getRowKey={(a) => `${a.supply_id}|${a.storage_id}`}
              onRowClick={(a) => navigate(`/inventory/supplies/${a.supply_id}`)}
            />
          )}
        </Card>
      </div>

      <div className="mt-16">
        <Card
          title="Recent orders"
          actions={
            <button
              type="button"
              className="filter-pill"
              onClick={() => navigate('/orders')}
            >
              View all
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
            emptyMessage="No orders yet"
            emptySub="Orders created in the POS will appear here."
          />
        </Card>
      </div>
    </>
  );
}
