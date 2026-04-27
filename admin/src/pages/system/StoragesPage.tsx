import { useMemo, useState } from 'react';
import { Badge, Button, Table } from '../../components/ui';
import type { SortState, TableColumn } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useStoragesInfinite } from '../../hooks/useStorages';
import type { Storage } from '../../types/inventory';
import { StorageFormModal } from './StorageFormModal';

export function StoragesPage() {
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Storage | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      active: showInactive ? undefined : true,
    }),
    [search, showInactive],
  );

  const query = useStoragesInfinite(filters);

  const rows = useMemo<Storage[]>(
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
        case 'address':
          return (a.address ?? '').localeCompare(b.address ?? '') * mult;
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

  const openEdit = (s: Storage) => {
    setEditing(s);
    setModalOpen(true);
  };

  const columns: TableColumn<Storage>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      width: '1.5fr',
      render: (s) => <div className="fw-600 fs-13">{s.name}</div>,
    },
    {
      key: 'address',
      header: 'Address',
      sortable: true,
      width: '2fr',
      render: (s) => (
        <span className="fs-12 text-muted">{s.address ?? '—'}</span>
      ),
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
          placeholder="Search storages…"
        />

        <button
          type="button"
          className={`filter-pill ${showInactive ? 'active' : ''}`}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? '✓ Inactive visible' : 'Show inactive'}
        </button>

        <Button variant="primary" onClick={openCreate}>
          + New storage
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
        emptyMessage="No storages yet"
        emptySub="Add a storage location — bar, warehouse, fridge — to track stock against."
        emptyAction={
          <Button variant="primary" onClick={openCreate}>
            + New storage
          </Button>
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />

      <StorageFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        storage={editing}
      />
    </>
  );
}
