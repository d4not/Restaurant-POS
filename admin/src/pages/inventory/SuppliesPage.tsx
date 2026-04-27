import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Table } from '../../components/ui';
import type { TableColumn, SortState } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useSupplies } from '../../hooks/useSupplies';
import { useSupplyCategories } from '../../hooks/useSupplyCategories';
import { formatMoney, formatNumber } from '../../utils/format';
import type { Supply } from '../../types/inventory';
import { useTranslation } from '../../i18n';

export function SuppliesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });

  const categoriesQ = useSupplyCategories();

  // Only pass `active: true` when we want to hide inactive. Undefined returns
  // both (matches the backend schema).
  const filters = useMemo(
    () => ({
      search: search || undefined,
      category_id: categoryId || undefined,
      active: showInactive ? undefined : true,
    }),
    [search, categoryId, showInactive],
  );

  const query = useSupplies(filters);

  const rows = useMemo<Supply[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const mult = sort.dir === 'asc' ? 1 : -1;
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * mult;
        case 'category':
          return (a.category?.name ?? '').localeCompare(b.category?.name ?? '') * mult;
        case 'base_unit':
          return a.base_unit.localeCompare(b.base_unit) * mult;
        case 'avg_cost':
          return (Number(a.average_cost) - Number(b.average_cost)) * mult;
        default:
          return 0;
      }
    });
    return out;
  }, [rows, sort]);

  const columns: TableColumn<Supply>[] = [
    {
      key: 'name',
      header: t('supplies.colName'),
      sortable: true,
      width: '2fr',
      render: (row) => (
        <div>
          <div className="fw-600 fs-13">{row.name}</div>
          {row.barcode && (
            <div className="text-muted fs-11">{row.barcode}</div>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: t('supplies.colCategory'),
      sortable: true,
      width: '1fr',
      render: (row) => (
        <span className="text-muted fs-12">{row.category?.name ?? '—'}</span>
      ),
    },
    {
      key: 'base_unit',
      header: t('supplies.baseUnit'),
      sortable: true,
      width: '110px',
      render: (row) => <Badge tone="gray">{row.base_unit}</Badge>,
    },
    {
      key: 'content',
      header: t('supplies.contentPerUnit'),
      width: '130px',
      render: (row) =>
        row.content_per_unit && row.content_unit ? (
          <span className="fs-12 text-muted">
            {formatNumber(row.content_per_unit)} {row.content_unit.toLowerCase()}
          </span>
        ) : (
          <span className="fs-12 text-muted">—</span>
        ),
    },
    {
      key: 'avg_cost',
      header: t('supplies.colCost'),
      sortable: true,
      width: '120px',
      render: (row) => (
        <span className="fw-600 fs-13">
          {formatMoney(Number(row.average_cost))}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '110px',
      render: (row) =>
        row.active ? (
          <Badge tone="green">{t('common.active')}</Badge>
        ) : (
          <Badge tone="red">{t('common.inactive')}</Badge>
        ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('supplies.searchPlaceholder')}
        />

        <div style={{ minWidth: 180 }}>
          <select
            className="search-box"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={categoriesQ.isLoading}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')} — {t('supplies.colCategory')}</option>
            {categoriesQ.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={`filter-pill ${showInactive ? 'active' : ''}`}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? `✓ ${t('common.inactive')}` : t('supplies.showInactive')}
        </button>

        <Button
          variant="secondary"
          onClick={() => navigate('/inventory/supplies/quick-add')}
        >
          ⚡ {t('supplies.quickAdd')}
        </Button>
        <Button variant="primary" onClick={() => navigate('/inventory/supplies/new')}>
          + {t('supplies.newSupply')}
        </Button>
      </div>

      <Table
        columns={columns}
        rows={sorted}
        getRowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/inventory/supplies/${s.id}`)}
        sort={sort}
        onSortChange={setSort}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={t('supplies.empty')}
        emptySub={t('supplies.subtitle')}
        emptyAction={
          <Button variant="primary" onClick={() => navigate('/inventory/supplies/new')}>
            + {t('supplies.newSupply')}
          </Button>
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />
    </>
  );
}
