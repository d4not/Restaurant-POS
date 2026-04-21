import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState, KPICard, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import {
  IncomeExpenseChart,
  type IncomeExpenseDatum,
} from '../../components/charts/IncomeExpenseChart';
import { MiniBars } from '../../components/charts/MiniBars';
import { useOrders } from '../../hooks/useOrders';
import { usePurchases } from '../../hooks/usePurchases';
import type { Purchase } from '../../api/purchases';
import type { Order } from '../../types/operations';
import { formatDate, formatMoney } from '../../utils/format';

/* ── Month helpers ────────────────────────────────────────── */

interface MonthBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleString('en-US', { month: 'short' });
}
function monthsBack(count: number): MonthBucket[] {
  const out: MonthBucket[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1, 0, 0, 0, 0);
    end.setMilliseconds(end.getMilliseconds() - 1);
    out.push({
      key:   monthKey(start),
      label: monthLabel(start),
      start,
      end,
    });
  }
  return out;
}

export function ExpensesReport() {
  // The six-month window that drives both the headline chart and the KPIs.
  // "This month" = the last bucket; "last 6 months" = full list.
  const buckets = useMemo(() => monthsBack(6), []);
  const [showCurrentMonthOnly, setShowCurrentMonthOnly] = useState(true);

  const current = buckets[buckets.length - 1]!;
  const windowStart = buckets[0]!.start;
  const windowEnd = current.end;

  const ordersQ = useOrders({
    status: 'PAID',
    from: windowStart.toISOString(),
    to:   windowEnd.toISOString(),
  });
  const orders = useMemo<Order[]>(
    () => ordersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [ordersQ.data],
  );

  const purchasesQ = usePurchases({
    status: 'CONFIRMED',
    from: windowStart.toISOString(),
    to:   windowEnd.toISOString(),
  });
  const purchases = useMemo<Purchase[]>(
    () => purchasesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [purchasesQ.data],
  );

  /* ── Monthly chart data ───────────────────────────────── */

  const chartData = useMemo<IncomeExpenseDatum[]>(() => {
    return buckets.map((b) => {
      const income = orders
        .filter((o) => {
          const d = new Date(o.created_at);
          return d >= b.start && d <= b.end;
        })
        .reduce((sum, o) => sum + Number(o.total), 0);
      const expenses = purchases
        .filter((p) => {
          const d = new Date(p.date);
          return d >= b.start && d <= b.end;
        })
        .reduce((sum, p) => sum + Number(p.total), 0);
      return {
        label: b.label,
        income,
        expenses,
        profit: income - expenses,
      };
    });
  }, [buckets, orders, purchases]);

  /* ── Current-month KPIs ───────────────────────────────── */

  const last = chartData[chartData.length - 1] ?? {
    income: 0,
    expenses: 0,
    profit: 0,
  };
  const marginPct = last.income > 0 ? (last.profit / last.income) * 100 : 0;

  /* ── Expense breakdown (by supplier) ──────────────────── */

  const breakdown = useMemo(() => {
    // Group expenses by supplier name. Suppliers are the closest category-like
    // grouping available in the purchases data; in a future phase this could
    // be replaced with dedicated expense categories (payroll, rent, utilities).
    const scope = showCurrentMonthOnly
      ? purchases.filter((p) => {
          const d = new Date(p.date);
          return d >= current.start && d <= current.end;
        })
      : purchases;
    const byKey = new Map<string, { label: string; value: number }>();
    for (const p of scope) {
      const label = p.supplier?.name ?? 'Unknown supplier';
      const row = byKey.get(label) ?? { label, value: 0 };
      row.value += Number(p.total);
      byKey.set(label, row);
    }
    return [...byKey.values()].sort((a, b) => b.value - a.value);
  }, [purchases, current, showCurrentMonthOnly]);

  /* ── Recorded expenses table ──────────────────────────── */

  const tableRows = useMemo<Purchase[]>(() => {
    const scope = showCurrentMonthOnly
      ? purchases.filter((p) => {
          const d = new Date(p.date);
          return d >= current.start && d <= current.end;
        })
      : purchases;
    return [...scope].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [purchases, current, showCurrentMonthOnly]);

  const columns: TableColumn<Purchase>[] = [
    {
      key: 'concept',
      header: 'Concept',
      width: '1.4fr',
      render: (p) => (
        <div className="fw-600 fs-13">
          {p.notes ?? `Purchase · ${p.supplier?.name ?? 'Supplier'}`}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: '1fr',
      render: () => <Badge tone="gray">Supplies</Badge>,
    },
    {
      key: 'description',
      header: 'Description',
      width: '1.2fr',
      render: (p) => (
        <span className="text-muted fs-12">
          {p.supplier?.name ?? 'Supplier'}
          {p.storage?.name ? ` → ${p.storage.name}` : ''}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '120px',
      render: (p) => (
        <span className="fw-600 fs-13 text-red">
          −{formatMoney(Number(p.total))}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      width: '110px',
      render: (p) => (
        <span className="text-muted fs-12">{formatDate(p.date, 'MMM d')}</span>
      ),
    },
  ];

  const bothLoading = ordersQ.isLoading || purchasesQ.isLoading;

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KPICard
          accent
          label="Income this month"
          value={formatMoney(last.income)}
          sub={bothLoading ? 'Loading…' : `Paid orders · ${current.label}`}
        />
        <KPICard
          label="Expenses this month"
          value={formatMoney(last.expenses)}
          sub={bothLoading ? 'Loading…' : 'Confirmed purchases'}
        />
        <KPICard
          label="Net profit"
          value={formatMoney(last.profit)}
          valueColor={last.profit >= 0 ? 'green' : 'red'}
          sub={
            last.income > 0
              ? `${marginPct.toFixed(0)}% margin`
              : 'No income yet'
          }
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Income vs Expenses — last 6 months">
          {bothLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              Loading chart…
            </div>
          ) : chartData.every((d) => d.income === 0 && d.expenses === 0) ? (
            <EmptyState
              icon="📊"
              message="No financial activity in the last 6 months"
              sub="Paid orders and confirmed purchases will chart here."
            />
          ) : (
            <IncomeExpenseChart data={chartData} />
          )}
        </Card>

        <Card
          title="Expense breakdown"
          actions={
            <button
              type="button"
              className="filter-pill"
              onClick={() => setShowCurrentMonthOnly((v) => !v)}
            >
              {showCurrentMonthOnly ? 'This month' : 'Last 6 months'}
            </button>
          }
        >
          {bothLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              Loading…
            </div>
          ) : breakdown.length === 0 ? (
            <EmptyState
              icon="📦"
              message="No expenses recorded"
              sub="Confirmed purchases grouped by supplier will appear here."
            />
          ) : (
            <MiniBars
              rows={breakdown.slice(0, 6)}
              formatValue={(row) => formatMoney(row.value)}
            />
          )}
        </Card>
      </div>

      <Card
        title="Recorded expenses"
        actions={
          <span className="fs-12 text-muted">
            {showCurrentMonthOnly ? current.label : 'Last 6 months'}
          </span>
        }
      >
        <Table
          columns={columns}
          rows={tableRows}
          getRowKey={(p) => p.id}
          isInitialLoad={purchasesQ.isLoading}
          error={purchasesQ.error as Error | null}
          emptyMessage="No expenses in this range"
          emptySub="Confirmed purchases from suppliers will appear here."
          hasMore={!!purchasesQ.hasNextPage}
          isLoadingMore={purchasesQ.isFetchingNextPage}
          onLoadMore={() => purchasesQ.fetchNextPage()}
        />
      </Card>
    </>
  );
}
