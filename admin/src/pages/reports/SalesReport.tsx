import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Card, CSVExportButton, EmptyState, KPICard, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { MiniBars } from '../../components/charts/MiniBars';
import {
  DateRangeFilter,
  previousPeriod,
  type DateRangeValue,
} from '../../components/forms/DateRangeFilter';
import { useOrders } from '../../hooks/useOrders';
import type { Order, PaymentMethod } from '../../types/operations';
import {
  PAYMENT_METHODS,
  paymentMethodLabel,
} from '../../types/operations';
import { paymentMethodTone } from '../staff/operations-meta';
import { formatDateTime, formatMoney, formatNumber, formatPct } from '../../utils/format';
import { csvFilename } from '../../utils/csv';
import {
  daysAgoYMD,
  todayYMD,
  toIsoDayEnd,
  toIsoDayStart,
} from './date-range';
import { useTranslation } from '../../i18n';

interface PaymentBreakdown {
  method: PaymentMethod;
  total: number;
  count: number;
}

interface DayPoint {
  ymd: string;
  label: string;
  total: number;
  count: number;
}

interface HourPoint {
  hour: number;
  total: number;
  count: number;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function aggregateOrders(orders: Order[]) {
  let total = 0, revenue = 0, tax = 0, discount = 0;
  for (const o of orders) {
    total += Number(o.total);
    revenue += Number(o.subtotal);
    tax += Number(o.tax_amount);
    discount += Number(o.discount_amount);
  }
  return { total, revenue, tax, discount, count: orders.length };
}

function buildDailySeries(orders: Order[], from: string, to: string): DayPoint[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const points: DayPoint[] = [];
  const map = new Map<string, DayPoint>();
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    const k = ymd(d);
    const point: DayPoint = {
      ymd: k,
      label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
      total: 0,
      count: 0,
    };
    points.push(point);
    map.set(k, point);
  }
  for (const o of orders) {
    const d = new Date(o.created_at);
    const k = ymd(d);
    const p = map.get(k);
    if (!p) continue;
    p.total += Number(o.total);
    p.count += 1;
  }
  return points;
}

function buildHourlySeries(orders: Order[]): HourPoint[] {
  const points: HourPoint[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h, total: 0, count: 0,
  }));
  for (const o of orders) {
    const h = new Date(o.created_at).getHours();
    const p = points[h];
    if (!p) continue;
    p.total += Number(o.total);
    p.count += 1;
  }
  return points;
}

function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function DeltaBadge({ value }: { value: number | null }) {
  const { t } = useTranslation();
  if (value == null) return <span className="fs-11 text-muted">{t('reports.noPrev')}</span>;
  const positive = value >= 0;
  const tone = positive ? 'green' : 'red';
  const sign = positive ? '+' : '';
  return (
    <Badge tone={tone}>
      {sign}{formatNumber(value, 1)}% {t('reports.vsPrev')}
    </Badge>
  );
}

export function SalesReport() {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRangeValue>({
    from: daysAgoYMD(6),
    to: todayYMD(),
  });
  const prev = useMemo(() => previousPeriod(range), [range]);

  const filtersCurrent = useMemo(
    () => ({
      status: 'PAID' as const,
      from: toIsoDayStart(range.from),
      to:   toIsoDayEnd(range.to),
    }),
    [range],
  );
  const filtersPrev = useMemo(
    () => ({
      status: 'PAID' as const,
      from: toIsoDayStart(prev.from),
      to:   toIsoDayEnd(prev.to),
    }),
    [prev],
  );

  const query = useOrders(filtersCurrent);
  const prevQuery = useOrders(filtersPrev);

  const orders = useMemo<Order[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const prevOrders = useMemo<Order[]>(
    () => prevQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [prevQuery.data],
  );

  /* ── Aggregations ─────────────────────────────────────── */

  const cur = useMemo(() => aggregateOrders(orders), [orders]);
  const old = useMemo(() => aggregateOrders(prevOrders), [prevOrders]);
  const avgTicket = cur.count > 0 ? cur.total / cur.count : 0;
  const oldAvgTicket = old.count > 0 ? old.total / old.count : 0;

  const dTotal = deltaPct(cur.total, old.total);
  const dCount = deltaPct(cur.count, old.count);
  const dAvg = deltaPct(avgTicket, oldAvgTicket);

  const breakdown = useMemo<PaymentBreakdown[]>(() => {
    const agg = new Map<PaymentMethod, PaymentBreakdown>();
    for (const method of PAYMENT_METHODS) {
      agg.set(method, { method, total: 0, count: 0 });
    }
    for (const o of orders) {
      for (const p of o.payments ?? []) {
        const row = agg.get(p.method);
        if (!row) continue;
        const captured = Number(p.amount) - Number(p.change_amount ?? 0);
        row.total += captured;
        row.count += 1;
      }
    }
    return [...agg.values()].filter((r) => r.count > 0 || r.total > 0);
  }, [orders]);

  const dailySeries = useMemo(
    () => buildDailySeries(orders, range.from, range.to),
    [orders, range.from, range.to],
  );
  const hourlySeries = useMemo(() => buildHourlySeries(orders), [orders]);

  const peakHour = useMemo(() => {
    let best = -1, bestVal = -1;
    for (const p of hourlySeries) {
      if (p.total > bestVal) { bestVal = p.total; best = p.hour; }
    }
    return bestVal > 0 ? best : null;
  }, [hourlySeries]);

  const bestDay = useMemo(() => {
    let best: DayPoint | null = null;
    for (const p of dailySeries) {
      if (!best || p.total > best.total) best = p;
    }
    return best && best.total > 0 ? best : null;
  }, [dailySeries]);

  /* ── Table columns ────────────────────────────────────── */

  const columns: TableColumn<Order>[] = [
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
      key: 'cashier',
      header: t('role.cashier'),
      width: '1fr',
      render: (o) => <span className="fs-13">{o.user?.name ?? '—'}</span>,
    },
    {
      key: 'items',
      header: t('orders.colItems'),
      width: '90px',
      render: (o) => {
        const n = (o.items ?? []).reduce((sum, i) => sum + i.quantity, 0);
        return <span className="fs-13">{n}</span>;
      },
    },
    {
      key: 'payment',
      header: t('orders.colPayment'),
      width: '130px',
      render: (o) => {
        const methods = Array.from(new Set((o.payments ?? []).map((p) => p.method)));
        if (methods.length === 0) return <span className="fs-12 text-muted">—</span>;
        if (methods.length === 1) {
          const m = methods[0]!;
          return <Badge tone={paymentMethodTone(m)}>{paymentMethodLabel(m)}</Badge>;
        }
        return <Badge tone="gray">Split</Badge>;
      },
    },
    {
      key: 'total',
      header: t('common.total'),
      width: '120px',
      render: (o) => (
        <span className="fw-600 fs-13">{formatMoney(Number(o.total))}</span>
      ),
    },
  ];

  /* ── CSV export builder ───────────────────────────────── */

  const buildCsvRows = () => {
    const header = ['order_number', 'created_at', 'cashier', 'items', 'payment_methods', 'subtotal', 'tax', 'discount', 'total'];
    const rows: (string | number)[][] = [header];
    for (const o of orders) {
      const items = (o.items ?? []).reduce((s, i) => s + i.quantity, 0);
      const methods = Array.from(new Set((o.payments ?? []).map((p) => p.method))).join('+');
      rows.push([
        o.order_number,
        o.created_at,
        o.user?.name ?? '',
        items,
        methods,
        Number(o.subtotal) / 100,
        Number(o.tax_amount) / 100,
        Number(o.discount_amount) / 100,
        Number(o.total) / 100,
      ]);
    }
    return rows;
  };

  return (
    <>
      <DateRangeFilter
        value={range}
        onChange={setRange}
        rightSlot={
          <CSVExportButton
            filename={csvFilename('sales', range.from, range.to)}
            buildRows={buildCsvRows}
            disabled={orders.length === 0}
          />
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard
          accent
          label={t('salesReport.totalSales')}
          value={formatMoney(cur.total)}
          sub={<DeltaBadge value={dTotal} />}
        />
        <KPICard
          label={t('salesReport.orderCount')}
          value={cur.count}
          sub={<DeltaBadge value={dCount} />}
        />
        <KPICard
          label={t('salesReport.avgTicket')}
          value={formatMoney(avgTicket)}
          sub={<DeltaBadge value={dAvg} />}
        />
        <KPICard
          label={t('common.tax')}
          value={formatMoney(cur.tax)}
          sub={`${t('common.discount')}: ${formatMoney(cur.discount)}`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card
          title={t('reports.salesByDay')}
          actions={
            bestDay && (
              <span className="fs-12 text-muted">
                {t('reports.bestDay')}: <span className="fw-600 text-gold">{bestDay.label}</span>
                {' '}({formatMoney(bestDay.total)})
              </span>
            )
          }
        >
          {query.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : dailySeries.every((d) => d.total === 0) ? (
            <EmptyState icon="📈" message={t('orders.empty')} sub={t('salesReport.subtitle')} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailySeries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="var(--text3)"
                  tick={{ fontSize: 11, fill: 'var(--text2)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                />
                <YAxis
                  stroke="var(--text3)"
                  tick={{ fontSize: 11, fill: 'var(--text2)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  tickFormatter={(v) => formatMoney(Number(v))}
                  width={80}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--gold)', strokeOpacity: 0.4 }}
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border2)',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'var(--text)',
                  }}
                  formatter={(value, _name, item) => {
                    const count = (item?.payload as DayPoint | undefined)?.count ?? 0;
                    return [`${formatMoney(Number(value))} · ${count} orders`, ''];
                  }}
                  labelFormatter={(label) => label}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="var(--gold)"
                  strokeWidth={2}
                  dot={{ r: 3, stroke: 'var(--gold)', strokeWidth: 2, fill: 'var(--surface)' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title={t('salesReport.byMethod')}>
          {query.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : breakdown.length === 0 ? (
            <EmptyState icon="💳" message={t('orders.empty')} sub={t('salesReport.subtitle')} />
          ) : (
            <MiniBars
              rows={breakdown.map((b) => ({
                label: `${paymentMethodLabel(b.method)} · ${b.count}`,
                value: b.total,
              }))}
              formatValue={(row, total) =>
                `${formatMoney(row.value)} (${formatPct(total > 0 ? (row.value / total) * 100 : 0, 0)})`
              }
            />
          )}
        </Card>
      </div>

      <Card
        title={t('reports.salesByHour')}
        actions={
          peakHour != null && (
            <span className="fs-12 text-muted">
              {t('reports.peakHour')}:{' '}
              <span className="fw-600 text-gold">
                {String(peakHour).padStart(2, '0')}:00
              </span>
            </span>
          )
        }
        className="mb-16"
      >
        {query.isLoading ? (
          <div className="loading-block">
            <span className="spinner" />
            {t('common.loading')}…
          </div>
        ) : hourlySeries.every((h) => h.total === 0) ? (
          <EmptyState icon="🕒" message={t('orders.empty')} />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="hour"
                stroke="var(--text3)"
                tick={{ fontSize: 10, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                tickFormatter={(h) => `${String(h).padStart(2, '0')}h`}
                interval={1}
              />
              <YAxis
                stroke="var(--text3)"
                tick={{ fontSize: 11, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                tickFormatter={(v) => formatMoney(Number(v))}
                width={80}
              />
              <Tooltip
                cursor={{ fill: 'var(--gold-bg)' }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border2)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                formatter={(v) => [formatMoney(Number(v)), 'Revenue']}
                labelFormatter={(h) => `${String(h).padStart(2, '0')}:00`}
              />
              <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                {hourlySeries.map((h) => (
                  <Cell
                    key={h.hour}
                    fill={h.hour === peakHour ? 'var(--gold)' : 'var(--border2)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title={t('salesReport.title')}>
        <Table
          columns={columns}
          rows={orders}
          getRowKey={(o) => o.id}
          isInitialLoad={query.isLoading}
          error={query.error as Error | null}
          emptyMessage={t('orders.empty')}
          emptySub={t('salesReport.subtitle')}
          hasMore={!!query.hasNextPage}
          isLoadingMore={query.isFetchingNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </Card>
    </>
  );
}
