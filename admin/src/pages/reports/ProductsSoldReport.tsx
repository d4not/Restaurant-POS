import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, KPICard, Table } from '../../components/ui';
import type { TableColumn, SortState } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { getProductsSold } from '../../api/reports';
import type { ProductsSoldRow } from '../../api/reports';
import { useProductCategories } from '../../hooks/useProductCategories';
import { useEmployees } from '../../hooks/useEmployees';
import { formatMoney } from '../../utils/format';
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
  | 'profit';

export function ProductsSoldReport() {
  const { t } = useTranslation();
  const [from, setFrom] = useState<string>(daysAgoYMD(29));
  const [to, setTo] = useState<string>(todayYMD());
  const [categoryId, setCategoryId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [sort, setSort] = useState<SortState>({ key: 'quantity', dir: 'desc' });

  const params = useMemo(
    () => ({
      from: toIsoDayStart(from) ?? '',
      to: toIsoDayEnd(to) ?? '',
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(userId ? { user_id: userId } : {}),
      ...(search.trim() ? { q: search.trim() } : {}),
    }),
    [from, to, categoryId, userId, search],
  );

  const reportQuery = useQuery({
    queryKey: ['reports', 'products-sold', params],
    queryFn: () => getProductsSold(params),
    enabled: !!params.from && !!params.to,
  });

  const categoriesQuery = useProductCategories();
  const employeesQuery = useEmployees({ active: true });

  const employees = useMemo(
    () => employeesQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [employeesQuery.data],
  );

  const rows = useMemo<ProductsSoldRow[]>(() => {
    const arr = reportQuery.data?.rows ?? [];
    const sorted = [...arr];
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
          return (Number(a.revenue) - Number(b.revenue)) * dir;
        case 'profit':
          return (Number(a.profit) - Number(b.profit)) * dir;
        default:
          return 0;
      }
    });
    return sorted;
  }, [reportQuery.data, sort]);

  const totals = reportQuery.data?.totals;

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
      width: '2fr',
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
      width: '110px',
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
      width: '130px',
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
      width: '120px',
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
      width: '130px',
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
      key: 'profit',
      header: t('productsSold.colProfit'),
      width: '130px',
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

  const distinctCount = rows.length;

  return (
    <>
      <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: '0 0 170px' }}>
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
        <div style={{ flex: '0 0 170px' }}>
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
          onClick={() => {
            setFrom(daysAgoYMD(6));
            setTo(todayYMD());
          }}
        >
          7 {t('common.from').toLowerCase()}
        </button>
        <button
          type="button"
          className="filter-pill"
          onClick={() => {
            setFrom(daysAgoYMD(29));
            setTo(todayYMD());
          }}
        >
          30
        </button>
        <button
          type="button"
          className="filter-pill"
          onClick={() => {
            setFrom(daysAgoYMD(89));
            setTo(todayYMD());
          }}
        >
          90
        </button>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard
          accent
          label={t('productsSold.kpiLines')}
          value={distinctCount}
          sub={t('productsSold.kpiLinesSub')}
        />
        <KPICard
          label={t('productsSold.kpiQuantity')}
          value={totals?.quantity ?? 0}
          sub={t('productsSold.kpiQuantitySub')}
        />
        <KPICard
          label={t('productsSold.kpiRevenue')}
          value={formatMoney(totals?.revenue ?? 0)}
          sub={t('productsSold.kpiRevenueSub')}
        />
        <KPICard
          label={t('productsSold.kpiProfit')}
          value={formatMoney(totals?.profit ?? 0)}
          valueColor={Number(totals?.profit ?? 0) < 0 ? 'red' : 'green'}
          sub={t('productsSold.kpiProfitSub')}
        />
      </div>

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('productsSold.searchPlaceholder')}
        />
        <select
          className="search-box"
          style={{ flex: '0 0 200px' }}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">{t('productsSold.filterAllCategories')}</option>
          {(categoriesQuery.data?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
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
        {(categoryId || userId || search) && (
          <button
            type="button"
            className="filter-pill"
            onClick={() => {
              setCategoryId('');
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
