import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useModifierGroups } from '../../hooks/useModifierGroups';
import type { ModifierGroup } from '../../types/menu';
import { ModifierGroupFormModal } from './ModifierGroupFormModal';

export function ModifierGroupsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const filters = useMemo(
    () => ({ search: search || undefined }),
    [search],
  );

  const query = useModifierGroups(filters);

  const rows = useMemo<ModifierGroup[]>(
    () => query.data?.items ?? [],
    [query.data],
  );

  const columns: TableColumn<ModifierGroup>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '1.8fr',
      render: (g) => (
        <div>
          <div className="fw-600 fs-13">{g.name}</div>
          {g.required && (
            <div className="fs-11 mt-4">
              <Badge tone="gold">Required</Badge>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '90px',
      render: (g) =>
        g.type === 'SWAP' ? (
          <Badge tone="blue">SWAP</Badge>
        ) : (
          <Badge tone="gray">ADD</Badge>
        ),
    },
    {
      key: 'default',
      header: 'Default',
      width: '1.5fr',
      render: (g) => {
        if (g.type !== 'SWAP') return <span className="fs-12 text-muted">—</span>;
        const def = g.modifiers?.find((m) => m.is_default);
        return (
          <span className="fs-12 text-muted">{def?.name ?? '—'}</span>
        );
      },
    },
    {
      key: 'selection',
      header: 'Min / Max',
      width: '120px',
      render: (g) => (
        <span className="fs-12">
          {g.min_selection} / {g.max_selection}
        </span>
      ),
    },
    {
      key: 'modifiers',
      header: 'Modifiers',
      width: '110px',
      render: (g) => (
        <span className="fs-13">{g.modifiers?.length ?? 0}</span>
      ),
    },
    {
      key: 'linked',
      header: 'Linked products',
      width: '140px',
      render: (g) => (
        <span className="fs-13">{g._count?.product_links ?? 0}</span>
      ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search modifier groups…"
        />

        <Button variant="primary" onClick={() => setModalOpen(true)}>
          + New group
        </Button>
      </div>

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(g) => g.id}
        onRowClick={(g) => navigate(`/menu/modifier-groups/${g.id}`)}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage="No modifier groups yet"
        emptySub="Create a group (e.g. Milk Type, Extras) to offer customizable items."
        emptyAction={
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + New group
          </Button>
        }
      />

      <ModifierGroupFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
