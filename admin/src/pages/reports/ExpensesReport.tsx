import { useMemo, useState } from 'react';
import { Badge, Card, CSVExportButton, EmptyState, KPICard, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import {
  IncomeExpenseChart,
  type IncomeExpenseDatum,
} from '../../components/charts/IncomeExpenseChart';
import { MiniBars } from '../../components/charts/MiniBars';
import {
  DateRangeFilter,
  type DateRangeValue,
} from '../../components/forms/DateRangeFilter';
import { SearchInput } from '../../components/forms/SearchInput';
import { useOrders } from '../../hooks/useOrders';
import { usePurchases } from '../../hooks/usePurchases';
import type { Purchase } from '../../api/purchases';
import type { Order } from '../../types/operations';
import { formatDate, formatMoney, formatPct } from '../../utils/format';
import { csvFilename } from '../../utils/csv';
import {
  daysAgoYMD,
  todayYMD,
  toIsoDayEnd,
  toIsoDayStart,
} from './date-range';
import { useTranslation } from '../../i18n';

/* ── Month helpers (for the historical chart) ─────────────── */

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
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRangeValue>({
    from: daysAgoYMD(29),
    to: todayYMD(),
  });
  const [supplierId, setSupplierId] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  // The 6-month chart is independent of the range filter; it always shows
  // the rolling half-year so trends stay visible regardless of zoom level.
  const buckets = useMemo(() => monthsBack(6), []);
  const windowStart = buckets[0]!.start;
  const windowEnd = buckets[buckets.length - 1]!.end;

  /* ── Long-window queries (for the chart) ───────────────── */
  const ordersChartQ = useOrders({
    status: 'PAID',
    from: windowStart.toISOString(),
    to:   windowEnd.toISOString(),
  });
  const ordersChart = useMemo<Order[]>(
    () => ordersChartQ.data?.pages.flatMap((p) => p.items) ?? [],
    [ordersChartQ.data],
  );

  const purchasesChartQ = usePurchases({
    status: 'CONFIRMED',
    from: windowStart.toISOString(),
    to:   windowEnd.toISOString(),
  });
  const purchasesChart = useMemo<Purchase[]>(
    () => purchasesChartQ.data?.pages.flatMap((p) => p.items) ?? [],
    [purchasesChartQ.data],
  );

  /* ── Range queries (for KPIs, breakdown, table) ────────── */
  const ordersRangeQ = useOrders({
    status: 'PAID',
    from: toIsoDayStart(range.from),
    to:   toIsoDayEnd(range.to),
  });
  const ordersRange = useMemo<Order[]>(
    () => ordersRangeQ.data?.pages.flatMap((p) => p.items) ?? [],
    [ordersRangeQ.data],
  );

  const purchasesRangeQ = usePurchases({
    status: 'CONFIRMED',
    from: toIsoDayStart(range.from),
    to:   toIsoDayEnd(range.to),
  });
  const purchasesRange = useMemo<Purchase[]>(
    () => purchasesRangeQ.data?.pages.flatMap((p) => p.items) ?? [],
    [purchasesRangeQ.data],
  );

  /* ── Supplier list (derived from purchases in chart window — that's the
   *    widest set we know about). Used by the supplier dropdown. ─────── */
  const supplierOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of purchasesChart) {
      if (p.supplier?.id) map.set(p.supplier.id, p.supplier.name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [purchasesChart]);

  /* ── Filtered purchases (after supplier + search) ──────── */
  const filteredPurchases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return purchasesRange.filter((p) => {
      if (supplierId && p.supplier?.id !== supplierId) return false;
      if (!needle) return true;
      const hay = [p.supplier?.name ?? '', p.notes ?? '', p.storage?.name ?? '']
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [purchasesRange, supplierId, search]);

  /* ── Chart data ────────────────────────────────────────── */

  const chartData = useMemo<IncomeExpenseDatum[]>(() => {
    return buckets.map((b) => {
      const income = ordersChart
        .filter((o) => {
          const d = new Date(o.created_at);
          return d >= b.start && d <= b.end;
        })
        .reduce((sum, o) => sum + Number(o.total), 0);
      const expenses = purchasesChart
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
  }, [buckets, ordersChart, purchasesChart]);

  /* ── KPIs (driven by the date range, not the chart window) ─ */

  const income = useMemo(
    () => ordersRange.reduce((s, o) => s + Number(o.total), 0),
    [ordersRange],
  );
  const expenses = useMemo(
    () => filteredPurchases.reduce((s, p) => s + Number(p.total), 0),
    [filteredPurchases],
  );
  const profit = income - expenses;
  const marginPct = income > 0 ? (profit / income) * 100 : 0;

  /* ── Expense breakdown (by supplier) ──────────────────── */

  const breakdown = useMemo(() => {
    const byKey = new Map<string, { label: string; value: number }>();
    for (const p of filteredPurchases) {
      const label = p.supplier?.name ?? 'Unknown supplier';
      const row = byKey.get(label) ?? { label, value: 0 };
      row.value += Number(p.total);
      byKey.set(label, row);
    }
    return [...byKey.values()].sort((a, b) => b.value - a.value);
  }, [filteredPurchases]);

  /* ── Recorded expenses table ──────────────────────────── */

  const tableRows = useMemo<Purchase[]>(() => {
    return [...filteredPurchases].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [filteredPurchases]);

  const columns: TableColumn<Purchase>[] = [
    {
      key: 'concept',
      header: t('common.description'),
      width: '1.4fr',
      render: (p) => (
        <div className="fw-600 fs-13">
          {p.notes ?? `${t('purchases.title')} · ${p.supplier?.name ?? t('suppliers.title')}`}
        </div>
      ),
    },
    {
      key: 'supplier',
      header: t('suppliers.title'),
      width: '1fr',
      render: (p) => (
        <Badge tone="gray">{p.supplier?.name ?? t('suppliers.title')}</Badge>
      ),
    },
    {
      key: 'storage',
      header: t('common.description'),
      width: '1.2fr',
      render: (p) => (
        <span className="text-muted fs-12">
          {p.storage?.name ?? '—'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('common.amount'),
      width: '120px',
      render: (p) => (
        <span className="fw-600 fs-13 text-red">
          −{formatMoney(Number(p.total))}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('common.date'),
      width: '110px',
      render: (p) => (
        <span className="text-muted fs-12">{formatDate(p.date, 'MMM d')}</span>
      ),
    },
  ];

  /* ── CSV export ───────────────────────────────────────── */

  const buildCsvRows = () => {
    const header = ['date', 'supplier', 'storage', 'notes', 'total'];
    const rows: (string | number)[][] = [header];
    for (const p of tableRows) {
      rows.push([
        new Date(p.date).toISOString(),
        p.supplier?.name ?? '',
        p.storage?.name ?? '',
        p.notes ?? '',
        Number(p.total) / 100,
      ]);
    }
    return rows;
  };

  const bothLoading = ordersRangeQ.isLoading || purchasesRangeQ.isLoading;

  return (
    <>
      <DateRangeFilter
        value={range}
        onChange={setRange}
        rightSlot={
          <CSVExportButton
            filename={csvFilename('expenses', range.from, range.to)}
            buildRows={buildCsvRows}
            disabled={tableRows.length === 0}
          />
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KPICard
          accent
          label={t('expenses.income')}
          value={formatMoney(income)}
          sub={bothLoading ? `${t('common.loading')}…` : `${ordersRange.length} ${t('orders.statusPaid').toLowerCase()}`}
        />
        <KPICard
          label={t('expenses.expense')}
          value={formatMoney(expenses)}
          sub={bothLoading ? `${t('common.loading')}…` : `${tableRows.length} ${t('purchases.statusConfirmed').toLowerCase()}`}
        />
        <KPICard
          label={t('expenses.profit')}
          value={formatMoney(profit)}
          valueColor={profit >= 0 ? 'green' : 'red'}
          sub={income > 0 ? `${formatPct(marginPct, 0)} ${t('common.discount')}` : t('orders.empty')}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title={t('expenses.last6Months')}>
          {ordersChartQ.isLoading || purchasesChartQ.isLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : chartData.every((d) => d.income === 0 && d.expenses === 0) ? (
            <EmptyState
              icon="📊"
              message={t('orders.empty')}
              sub={t('expenses.subtitle')}
            />
          ) : (
            <IncomeExpenseChart data={chartData} />
          )}
        </Card>

        <Card title={t('reports.expensesBySupplier')}>
          {bothLoading ? (
            <div className="loading-block">
              <span className="spinner" />
              {t('common.loading')}…
            </div>
          ) : breakdown.length === 0 ? (
            <EmptyState
              icon="📦"
              message={t('orders.empty')}
              sub={t('expenses.subtitle')}
            />
          ) : (
            <MiniBars
              rows={breakdown.slice(0, 6)}
              formatValue={(row, total) =>
                `${formatMoney(row.value)} (${formatPct(total > 0 ? (row.value / total) * 100 : 0, 0)})`
              }
            />
          )}
        </Card>
      </div>

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('reports.searchSupplier')}
        />
        <select
          className="search-box"
          style={{ flex: '0 0 220px' }}
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">{t('reports.allSuppliers')}</option>
          {supplierOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {(supplierId || search) && (
          <button
            type="button"
            className="filter-pill"
            onClick={() => { setSupplierId(''); setSearch(''); }}
          >
            {t('common.cancel')}
          </button>
        )}
      </div>

      <Card title={t('expenses.title')}>
        <Table
          columns={columns}
          rows={tableRows}
          getRowKey={(p) => p.id}
          isInitialLoad={purchasesRangeQ.isLoading}
          error={purchasesRangeQ.error as Error | null}
          emptyMessage={t('expenses.title')}
          emptySub={t('expenses.subtitle')}
          hasMore={!!purchasesRangeQ.hasNextPage}
          isLoadingMore={purchasesRangeQ.isFetchingNextPage}
          onLoadMore={() => purchasesRangeQ.fetchNextPage()}
        />
      </Card>
    </>
  );
}
