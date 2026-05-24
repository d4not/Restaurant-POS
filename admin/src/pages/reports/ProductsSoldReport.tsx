import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CSVExportButton, EmptyState, KPICard, Table } from '../../components/ui';
import type { TableColumn, SortState } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import {
  DateRangeFilter,
  type DateRangeValue,
} from '../../components/forms/DateRangeFilter';
import {
  FilterChips,
  buildChipPredicate,
  type FilterChip,
  type FilterField,
} from '../../components/forms/FilterChips';
import { getProductsSold } from '../../api/reports';
import type { ProductsSoldRow } from '../../api/reports';
import { useEmployees } from '../../hooks/useEmployees';
import { formatMoney, formatPct } from '../../utils/format';
import { csvFilename } from '../../utils/csv';
import {
  daysAgoYMD,
  toIsoDayEnd,
  toIsoDayStart,
  todayYMD,
} from './date-range';
import { useTranslation } from '../../i18n';

type SortKey =
  | 'product'
  | 'quantity'
  | 'gross_sales'
  | 'discount'
  | 'revenue'
  | 'profit'
  | 'share';

interface CategoryBarRow {
  label: string;
  revenue: number;
  quantity: number;
}

/** Modifier signature is a `, `-joined alphabetized list of modifier names —
 *  see src/modules/reports/service.ts. We split it back into individual values
 *  so each modifier is filterable on its own (e.g. "Medium" without also
 *  matching "Medium, Soy Milk"). */
function splitModifiers(sig: string): string[] {
  if (!sig) return [];
  return sig.split(',').map((s) => s.trim()).filter(Boolean);
}

function getRowFieldValue(
  row: ProductsSoldRow,
  field: string,
): string | string[] | null {
  switch (field) {
    case 'product':  return row.product_name;
    case 'category': return row.category_name;
    case 'variant':  return row.variant_name;
    case 'modifier': {
      const mods = splitModifiers(row.modifier_signature);
      return mods.length === 0 ? null : mods;
    }
    default: return null;
  }
}

export function ProductsSoldReport() {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRangeValue>({
    from: daysAgoYMD(29),
    to: todayYMD(),
  });
  const [userId, setUserId] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [sort, setSort] = useState<SortState>({ key: 'quantity', dir: 'desc' });
  const [chips, setChips] = useState<FilterChip[]>([]);

  /* ── Server params (chips are applied client-side, so they don't go here) ─ */

  const params = useMemo(
    () => ({
      from: toIsoDayStart(range.from) ?? '',
      to: toIsoDayEnd(range.to) ?? '',
      ...(userId ? { user_id: userId } : {}),
      ...(search.trim() ? { q: search.trim() } : {}),
    }),
    [range, userId, search],
  );

  const reportQuery = useQuery({
    queryKey: ['reports', 'products-sold', params],
    queryFn: () => getProductsSold(params),
    enabled: !!params.from && !!params.to,
  });

  const employeesQuery = useEmployees({ active: true });
  const employees = useMemo(
    () => employeesQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [employeesQuery.data],
  );

  /* ── Distinct values for the chip combobox suggestions ─────────────────── */

  const filterFields = useMemo<FilterField[]>(() => {
    const products  = new Set<string>();
    const categories = new Set<string>();
    const variants   = new Set<string>();
    const modifiers  = new Set<string>();
    for (const r of reportQuery.data?.rows ?? []) {
      products.add(r.product_name);
      if (r.category_name) categories.add(r.category_name);
      if (r.variant_name) variants.add(r.variant_name);
      for (const m of splitModifiers(r.modifier_signature)) modifiers.add(m);
    }
    const sortAlpha = (a: string, b: string) => a.localeCompare(b);
    return [
      { key: 'product',  label: t('productsSold.colProduct'),  options: [...products].sort(sortAlpha) },
      { key: 'category', label: t('common.category'),          options: [...categories].sort(sortAlpha) },
      { key: 'variant',  label: t('products.tabVariants'),     options: [...variants].sort(sortAlpha) },
      { key: 'modifier', label: t('productsSold.colModifier'), options: [...modifiers].sort(sortAlpha) },
    ];
  }, [reportQuery.data, t]);

  /* ── Apply chip predicate, then sort ───────────────────────────────────── */

  const filteredRows = useMemo<ProductsSoldRow[]>(() => {
    const predicate = buildChipPredicate<ProductsSoldRow>(chips, getRowFieldValue);
    return (reportQuery.data?.rows ?? []).filter(predicate);
  }, [reportQuery.data, chips]);

  const rows = useMemo<ProductsSoldRow[]>(() => {
    const sorted = [...filteredRows];
    const dir = sort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sort.key as SortKey) {
        case 'product':
          return a.product_name.localeCompare(b.product_name) * dir;
        case 'quantity':
          return (a.quantity - b.quantity) * dir;
        case 'gross_sales':
          return (Number(a.gross_sales) - Number(b.gross_sales)) * dir;
        case 'discount':
          return (Number(a.discount) - Number(b.discount)) * dir;
        case 'revenue':
        case 'share':
          return (Number(a.revenue) - Number(b.revenue)) * dir;
        case 'profit':
          return (Number(a.profit) - Number(b.profit)) * dir;
        default:
          return 0;
      }
    });
    return sorted;
  }, [filteredRows, sort]);

  /* ── Re-derive totals from the filtered set (the API totals are pre-chip) ─ */

  const totals = useMemo(() => {
    let quantity = 0, gross = 0, discount = 0, revenue = 0, profit = 0;
    for (const r of filteredRows) {
      quantity += r.quantity;
      gross += Number(r.gross_sales);
      discount += Number(r.discount);
      revenue += Number(r.revenue);
      profit += Number(r.profit);
    }
    return { quantity, gross, discount, revenue, profit };
  }, [filteredRows]);

  const totalRevenue = totals.revenue;

  const categoryAgg = useMemo<CategoryBarRow[]>(() => {
    const map = new Map<string, CategoryBarRow>();
    for (const r of filteredRows) {
      const label = r.category_name ?? 'Uncategorized';
      const cur = map.get(label) ?? { label, revenue: 0, quantity: 0 };
      cur.revenue += Number(r.revenue);
      cur.quantity += r.quantity;
      map.set(label, cur);
    }
    return [...map.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [filteredRows]);

  const avgPrice = totals.quantity > 0 ? totals.revenue / totals.quantity : 0;

  /* ── Table columns ─────────────────────────────────────────────────────── */

  const columns: TableColumn<ProductsSoldRow>[] = [
    {
      key: 'product',
      header: t('productsSold.colProduct'),
      width: '1.6fr',
      sortable: true,
      render: (r) => (
        <div>
          <div className="fw-600 fs-13">{r.product_name}</div>
          {r.category_name && (
            <div className="fs-11 text-muted">{r.category_name}</div>
          )}
        </div>
      ),
    },
    {
      key: 'modifiers',
      header: t('productsSold.colModifier'),
      width: '1.8fr',
      render: (r) => {
        const parts = [
          r.variant_name ?? null,
          r.modifier_signature || null,
        ].filter(Boolean);
        return parts.length === 0 ? (
          <span className="fs-12 text-muted">—</span>
        ) : (
          <span className="fs-13">{parts.join(' · ')}</span>
        );
      },
    },
    {
      key: 'quantity',
      header: t('productsSold.colQuantity'),
      width: '100px',
      sortable: true,
      render: (r) => (
        <span className="fs-13" style={{ textAlign: 'right', display: 'block' }}>
          {r.quantity}
          <span className="fs-11 text-muted"> pcs</span>
        </span>
      ),
    },
    {
      key: 'gross_sales',
      header: t('productsSold.colGrossSales'),
      width: '120px',
      sortable: true,
      render: (r) => (
        <span className="fs-13" style={{ textAlign: 'right', display: 'block' }}>
          {formatMoney(r.gross_sales)}
        </span>
      ),
    },
    {
      key: 'discount',
      header: t('productsSold.colDiscount'),
      width: '110px',
      sortable: true,
      render: (r) => {
        const value = Number(r.discount);
        return (
          <span
            className="fs-13"
            style={{
              textAlign: 'right',
              display: 'block',
              color: value > 0 ? 'var(--red)' : 'var(--text3)',
            }}
          >
            {formatMoney(r.discount)}
          </span>
        );
      },
    },
    {
      key: 'revenue',
      header: t('productsSold.colRevenue'),
      width: '120px',
      sortable: true,
      render: (r) => (
        <span
          className="fw-600 fs-13"
          style={{ textAlign: 'right', display: 'block' }}
        >
          {formatMoney(r.revenue)}
        </span>
      ),
    },
    {
      key: 'share',
      header: t('reports.shareOfRevenue'),
      width: '90px',
      sortable: true,
      render: (r) => {
        const pct = totalRevenue > 0 ? (Number(r.revenue) / totalRevenue) * 100 : 0;
        return (
          <span
            className="fs-12 text-muted"
            style={{ textAlign: 'right', display: 'block' }}
          >
            {formatPct(pct, 1)}
          </span>
        );
      },
    },
    {
      key: 'profit',
      header: t('productsSold.colProfit'),
      width: '120px',
      sortable: true,
      render: (r) => {
        const value = Number(r.profit);
        const tone =
          value < 0 ? 'var(--red)' : value > 0 ? 'var(--green)' : 'var(--text)';
        return (
          <span
            className="fw-600 fs-13"
            style={{ textAlign: 'right', display: 'block', color: tone }}
          >
            {formatMoney(r.profit)}
          </span>
        );
      },
    },
  ];

  /* ── CSV export ────────────────────────────────────────────────────────── */

  const buildCsvRows = () => {
    const header = ['product', 'category', 'variant', 'modifiers', 'quantity', 'gross_sales', 'discount', 'revenue', 'share_pct', 'profit'];
    const out: (string | number)[][] = [header];
    for (const r of rows) {
      const share = totalRevenue > 0 ? (Number(r.revenue) / totalRevenue) * 100 : 0;
      out.push([
        r.product_name,
        r.category_name ?? '',
        r.variant_name ?? '',
        r.modifier_signature,
        r.quantity,
        Number(r.gross_sales) / 100,
        Number(r.discount) / 100,
        Number(r.revenue) / 100,
        Number(share.toFixed(2)),
        Number(r.profit) / 100,
      ]);
    }
    return out;
  };

  const distinctCount = rows.length;

  return (
    <>
      <DateRangeFilter
        value={range}
        onChange={setRange}
        rightSlot={
          <CSVExportButton
            filename={csvFilename('products-sold', range.from, range.to)}
            buildRows={buildCsvRows}
            disabled={rows.length === 0}
          />
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard
          accent
          label={t('productsSold.kpiRevenue')}
          value={formatMoney(totals.revenue)}
          sub={t('productsSold.kpiRevenueSub')}
        />
        <KPICard
          label={t('productsSold.kpiQuantity')}
          value={totals.quantity}
          sub={`${distinctCount} ${t('productsSold.kpiLines').toLowerCase()}`}
        />
        <KPICard
          label={t('productsSold.kpiProfit')}
          value={formatMoney(totals.profit)}
          valueColor={totals.profit < 0 ? 'red' : 'green'}
          sub={t('productsSold.kpiProfitSub')}
        />
        <KPICard
          label={t('common.price')}
          value={formatMoney(avgPrice)}
          sub={t('productsSold.kpiQuantitySub')}
        />
      </div>

      <Card title={t('reports.byCategory')} className="mb-16">
        {reportQuery.isLoading ? (
          <div className="loading-block">
            <span className="spinner" />
            {t('common.loading')}…
          </div>
        ) : categoryAgg.length === 0 ? (
          <EmptyState icon="📊" message={t('productsSold.empty')} sub={t('productsSold.emptySub')} />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, categoryAgg.length * 32)}>
            <BarChart
              data={categoryAgg}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                stroke="var(--text3)"
                tick={{ fontSize: 11, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                tickFormatter={(v) => formatMoney(Number(v))}
              />
              <YAxis
                type="category"
                dataKey="label"
                stroke="var(--text3)"
                tick={{ fontSize: 12, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                width={150}
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
                formatter={(v, _n, item) => {
                  const qty = (item?.payload as CategoryBarRow | undefined)?.quantity ?? 0;
                  return [`${formatMoney(Number(v))} · ${qty} pcs`, ''];
                }}
              />
              <Bar dataKey="revenue" fill="var(--gold)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <FilterChips
        fields={filterFields}
        chips={chips}
        onChange={setChips}
        storageKey="products-sold"
      />

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('productsSold.searchPlaceholder')}
        />
        <select
          className="search-box"
          style={{ flex: '0 0 200px' }}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">{t('productsSold.filterAllWaiters')}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {(userId || search) && (
          <button
            type="button"
            className="filter-pill"
            onClick={() => {
              setUserId('');
              setSearch('');
            }}
          >
            {t('common.cancel')}
          </button>
        )}
      </div>

      <Card>
        <Table
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.key}
          isInitialLoad={reportQuery.isLoading}
          error={reportQuery.error as Error | null}
          emptyMessage={t('productsSold.empty')}
          emptySub={t('productsSold.emptySub')}
          sort={sort}
          onSortChange={setSort}
        />
      </Card>
    </>
  );
}
