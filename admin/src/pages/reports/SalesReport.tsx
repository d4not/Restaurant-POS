import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState, KPICard, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { MiniBars } from '../../components/charts/MiniBars';
import { useOrders } from '../../hooks/useOrders';
import type { Order, PaymentMethod } from '../../types/operations';
import {
  PAYMENT_METHODS,
  paymentMethodLabel,
} from '../../types/operations';
import { paymentMethodTone } from '../staff/operations-meta';
import { formatDateTime, formatMoney } from '../../utils/format';
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

export function SalesReport() {
  const { t } = useTranslation();
  const [from, setFrom] = useState<string>(daysAgoYMD(6));
  const [to, setTo] = useState<string>(todayYMD());

  const filters = useMemo(
    () => ({
      status: 'PAID' as const,
      from: toIsoDayStart(from),
      to:   toIsoDayEnd(to),
    }),
    [from, to],
  );

  const query = useOrders(filters);
  const orders = useMemo<Order[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  /* ── Aggregations ─────────────────────────────────────── */

  const totalSales = orders.reduce((sum, o) => sum + Number(o.total), 0);
  // Tax-inclusive pricing: total is what the customer paid, subtotal is the
  // revenue portion, tax_amount is the tax extracted from the total. For
  // SAT / accounting reporting we need those broken out clearly.
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.subtotal), 0);
  const totalTax = orders.reduce((sum, o) => sum + Number(o.tax_amount), 0);
  const totalDiscounts = orders.reduce(
    (sum, o) => sum + Number(o.discount_amount),
    0,
  );
  const count = orders.length;
  const avgTicket = count > 0 ? totalSales / count : 0;

  const breakdown = useMemo<PaymentBreakdown[]>(() => {
    const agg = new Map<PaymentMethod, PaymentBreakdown>();
    for (const method of PAYMENT_METHODS) {
      agg.set(method, { method, total: 0, count: 0 });
    }
    for (const o of orders) {
      for (const p of o.payments ?? []) {
        const row = agg.get(p.method);
        if (!row) continue;
        // Cash "amount" tendered includes change given back, so the actual
        // value captured for that order is amount − change_amount.
        const captured = Number(p.amount) - Number(p.change_amount ?? 0);
        row.total += captured;
        row.count += 1;
      }
    }
    return [...agg.values()].filter((r) => r.count > 0 || r.total > 0);
  }, [orders]);

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

  return (
    <>
      <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: '0 0 180px' }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            {t('common.from')}
          </label>
          <input
            type="date"
            className="search-box"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div style={{ flex: '0 0 180px' }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            {t('common.to')}
          </label>
          <input
            type="date"
            className="search-box"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="filter-pill"
          onClick={() => { setFrom(daysAgoYMD(6));  setTo(todayYMD()); }}
        >
          {t('dashboard.salesLast7')}
        </button>
        <button
          type="button"
          className="filter-pill"
          onClick={() => { setFrom(daysAgoYMD(29)); setTo(todayYMD()); }}
        >
          30
        </button>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KPICard
          accent
          label={t('salesReport.totalSales')}
          value={formatMoney(totalSales)}
          sub={query.isLoading ? `${t('common.loading')}…` : `${count} ${t('orders.statusPaid').toLowerCase()}`}
        />
        <KPICard
          label={t('expenses.income')}
          value={formatMoney(totalRevenue)}
          sub={t('salesReport.subtitle')}
        />
        <KPICard
          label={t('common.tax')}
          value={formatMoney(totalTax)}
          sub={t('salesReport.subtitle')}
        />
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <KPICard
          label={t('salesReport.orderCount')}
          value={count}
          sub={t('orders.statusPaid')}
        />
        <KPICard
          label={t('salesReport.avgTicket')}
          value={formatMoney(avgTicket)}
          sub={count > 0 ? t('orders.statusPaid') : t('orders.empty')}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title={t('salesReport.byMethod')}>
          {query.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : breakdown.length === 0 ? (
            <EmptyState
              icon="💳"
              message={t('orders.empty')}
              sub={t('salesReport.subtitle')}
            />
          ) : (
            <MiniBars
              rows={breakdown.map((b) => ({
                label: `${paymentMethodLabel(b.method)} · ${b.count}`,
                value: b.total,
              }))}
              formatValue={(row) => formatMoney(row.value)}
            />
          )}
        </Card>

        <Card title={t('salesReport.title')}>
          <div className="detail-grid">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">{t('expenses.income')}</div>
                <div className="dv">{formatMoney(totalRevenue)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">{t('common.tax')}</div>
                <div className="dv">{formatMoney(totalTax)}</div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">{t('common.discount')}</div>
                <div className="dv red">−{formatMoney(totalDiscounts)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">{t('common.total')}</div>
                <div className="dv gold">{formatMoney(totalSales)}</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

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
