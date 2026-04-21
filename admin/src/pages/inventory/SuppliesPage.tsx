import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Table } from '../../components/ui';
import type { TableColumn, SortState } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useSupplies } from '../../hooks/useSupplies';
import { useSupplyCategories } from '../../hooks/useSupplyCategories';
import { formatMoney, formatNumber } from '../../utils/format';
import type { Supply } from '../../types/inventory';
import { SupplyFormModal } from './SupplyFormModal';

export function SuppliesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [modalOpen, setModalOpen] = useState(false);

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
      header: 'Name',
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
      header: 'Category',
      sortable: true,
      width: '1fr',
      render: (row) => (
        <span className="text-muted fs-12">{row.category?.name ?? '—'}</span>
      ),
    },
    {
      key: 'base_unit',
      header: 'Base unit',
      sortable: true,
      width: '110px',
      render: (row) => <Badge tone="gray">{row.base_unit}</Badge>,
    },
    {
      key: 'content',
      header: 'Content',
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
      header: 'Avg cost',
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
      header: 'Status',
      width: '110px',
      render: (row) =>
        row.active ? (
          <Badge tone="green">Active</Badge>
        ) : (
          <Badge tone="red">Inactive</Badge>
        ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search supplies by name or barcode…"
        />

        <div style={{ minWidth: 180 }}>
          <select
            className="search-box"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={categoriesQ.isLoading}
            style={{ cursor: 'pointer' }}
          >
            <option value="">All categories</option>
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
          {showInactive ? '✓ Inactive visible' : 'Show inactive'}
        </button>

        <Button variant="primary" onClick={() => setModalOpen(true)}>
          + New supply
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
        emptyMessage="No supplies yet"
        emptySub="Create your first supply to start tracking inventory."
        emptyAction={
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + New supply
          </Button>
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />

      <SupplyFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
