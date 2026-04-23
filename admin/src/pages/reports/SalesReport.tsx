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

interface PaymentBreakdown {
  method: PaymentMethod;
  total: number;
  count: number;
}

export function SalesReport() {
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
      header: 'Date / time',
      width: '170px',
      render: (o) => (
        <span className="fs-12 text-muted">{formatDateTime(o.created_at)}</span>
      ),
    },
    {
      key: 'cashier',
      header: 'Cashier',
      width: '1fr',
      render: (o) => <span className="fs-13">{o.user?.name ?? '—'}</span>,
    },
    {
      key: 'items',
      header: 'Items',
      width: '90px',
      render: (o) => {
        const n = (o.items ?? []).reduce((sum, i) => sum + i.quantity, 0);
        return <span className="fs-13">{n}</span>;
      },
    },
    {
      key: 'payment',
      header: 'Payment',
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
      header: 'Total',
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
            From
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
            To
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
          Last 7 days
        </button>
        <button
          type="button"
          className="filter-pill"
          onClick={() => { setFrom(daysAgoYMD(29)); setTo(todayYMD()); }}
        >
          Last 30 days
        </button>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KPICard
          accent
          label="Total sales"
          value={formatMoney(totalSales)}
          sub={query.isLoading ? 'Loading…' : `${count} paid order${count === 1 ? '' : 's'}`}
        />
        <KPICard
          label="Revenue (before tax)"
          value={formatMoney(totalRevenue)}
          sub="For P&L reporting"
        />
        <KPICard
          label="Tax collected"
          value={formatMoney(totalTax)}
          sub="For SAT / remittance"
        />
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <KPICard
          label="Orders"
          value={count}
          sub="Paid orders only"
        />
        <KPICard
          label="Average ticket"
          value={formatMoney(avgTicket)}
          sub={count > 0 ? 'Per paid order' : 'No orders in range'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Payment method breakdown">
          {query.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              Loading…
            </div>
          ) : breakdown.length === 0 ? (
            <EmptyState
              icon="💳"
              message="No payments in range"
              sub="Paid orders captured by method will appear here."
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

        <Card title="Summary">
          {/* Prices include tax. Customer pays Total; revenue + tax = total
              (before discount). Kept here for a quick sanity cross-check —
              the KPIs above carry the accountant-friendly numbers. */}
          <div className="detail-grid">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Revenue (before tax)</div>
                <div className="dv">{formatMoney(totalRevenue)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Tax collected</div>
                <div className="dv">{formatMoney(totalTax)}</div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Discounts</div>
                <div className="dv red">−{formatMoney(totalDiscounts)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Total (customer paid)</div>
                <div className="dv gold">{formatMoney(totalSales)}</div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Orders in range">
        <Table
          columns={columns}
          rows={orders}
          getRowKey={(o) => o.id}
          isInitialLoad={query.isLoading}
          error={query.error as Error | null}
          emptyMessage="No paid orders in this range"
          emptySub="Adjust the date range to see sales."
          hasMore={!!query.hasNextPage}
          isLoadingMore={query.isFetchingNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </Card>
    </>
  );
}
