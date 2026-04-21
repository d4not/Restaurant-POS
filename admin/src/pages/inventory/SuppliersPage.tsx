import { useMemo, useState } from 'react';
import { Badge, Button, Table } from '../../components/ui';
import type { SortState, TableColumn } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useSuppliers } from '../../hooks/useSuppliers';
import type { Supplier } from '../../types/inventory';
import { SupplierFormModal } from './SupplierFormModal';

export function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      active: showInactive ? undefined : true,
    }),
    [search, showInactive],
  );

  const query = useSuppliers(filters);

  const rows = useMemo<Supplier[]>(
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
        case 'contact':
          return (a.contact_name ?? '').localeCompare(b.contact_name ?? '') * mult;
        case 'credit_days':
          return (a.credit_days - b.credit_days) * mult;
        default:
          return 0;
      }
    });
    return out;
  }, [rows, sort]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setModalOpen(true);
  };

  const columns: TableColumn<Supplier>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      width: '2fr',
      render: (s) => (
        <div className="fw-600 fs-13">{s.name}</div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      sortable: true,
      width: '1.2fr',
      render: (s) => (
        <span className="fs-13">{s.contact_name ?? '—'}</span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      width: '1fr',
      render: (s) => (
        <span className="fs-12 text-muted">{s.phone ?? '—'}</span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      width: '1.3fr',
      render: (s) => (
        <span className="fs-12 text-muted">{s.email ?? '—'}</span>
      ),
    },
    {
      key: 'credit_days',
      header: 'Credit days',
      sortable: true,
      width: '120px',
      render: (s) => <span className="fs-13">{s.credit_days}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (s) =>
        s.active ? (
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
          placeholder="Search suppliers…"
        />

        <button
          type="button"
          className={`filter-pill ${showInactive ? 'active' : ''}`}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? '✓ Inactive visible' : 'Show inactive'}
        </button>

        <Button variant="primary" onClick={openCreate}>
          + New supplier
        </Button>
      </div>

      <Table
        columns={columns}
        rows={sorted}
        getRowKey={(s) => s.id}
        onRowClick={openEdit}
        sort={sort}
        onSortChange={setSort}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage="No suppliers yet"
        emptySub="Add your first supplier to start registering purchases."
        emptyAction={
          <Button variant="primary" onClick={openCreate}>
            + New supplier
          </Button>
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />

      <SupplierFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        supplier={editing}
      />
    </>
  );
}
