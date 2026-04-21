import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useMovements } from '../../hooks/useMovements';
import { useStorages } from '../../hooks/useStorages';
import { useSupplies } from '../../hooks/useSupplies';
import {
  STOCK_MOVEMENT_TYPES,
  type StockMovement,
  type StockMovementType,
} from '../../types/inventory';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
} from '../../utils/format';
import { movementTypeTone } from './movement-meta';

function toIsoDayStart(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toIsoDayEnd(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function MovementsPage() {
  const [urlParams, setUrlParams] = useSearchParams();

  const [type, setType] = useState<StockMovementType | ''>('');
  const [storageId, setStorageId] = useState('');
  const [supplySearch, setSupplySearch] = useState('');
  const [supplyId, setSupplyId] = useState<string>(urlParams.get('supply_id') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const storagesQ = useStorages();
  const suppliesQ = useSupplies({ search: supplySearch || undefined });

  // If the URL arrived with supply_id already selected, fetch that one supply
  // so we can show its name in the picker.
  const selectedSupply = useMemo(() => {
    if (!supplyId) return null;
    return (
      suppliesQ.data?.pages
        .flatMap((p) => p.items)
        .find((s) => s.id === supplyId) ?? null
    );
  }, [suppliesQ.data, supplyId]);

  // Keep the URL in sync with the supply_id so reloads preserve the filter.
  useEffect(() => {
    const current = urlParams.get('supply_id') ?? '';
    if (supplyId === current) return;
    const next = new URLSearchParams(urlParams);
    if (supplyId) next.set('supply_id', supplyId);
    else next.delete('supply_id');
    setUrlParams(next, { replace: true });
  }, [supplyId, urlParams, setUrlParams]);

  const filters = useMemo(
    () => ({
      type: (type || undefined) as StockMovementType | undefined,
      storage_id: storageId || undefined,
      supply_id: supplyId || undefined,
      from: toIsoDayStart(from),
      to: toIsoDayEnd(to),
    }),
    [type, storageId, supplyId, from, to],
  );

  const query = useMovements(filters);

  const rows = useMemo<StockMovement[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const columns: TableColumn<StockMovement>[] = [
    {
      key: 'date',
      header: 'Date',
      width: '170px',
      render: (m) => (
        <span className="fs-12 text-muted">{formatDateTime(m.created_at)}</span>
      ),
    },
    {
      key: 'supply',
      header: 'Supply',
      width: '1.6fr',
      render: (m) => (
        <div className="fw-600 fs-13">{m.supply?.name ?? '—'}</div>
      ),
    },
    {
      key: 'storage',
      header: 'Storage',
      width: '1fr',
      render: (m) => <span className="fs-13">{m.storage?.name ?? '—'}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      width: '130px',
      render: (m) => <Badge tone={movementTypeTone(m.type)}>{m.type}</Badge>,
    },
    {
      key: 'qty',
      header: 'Qty',
      width: '120px',
      render: (m) => {
        const qty = Number(m.quantity);
        const cls = qty < 0 ? 'text-red' : 'text-green';
        const sign = qty > 0 ? '+' : '';
        return (
          <span className={`fw-600 fs-13 ${cls}`}>
            {sign}
            {formatNumber(qty, 4)}
          </span>
        );
      },
    },
    {
      key: 'cost',
      header: 'Unit cost',
      width: '120px',
      render: (m) => (
        <span className="fs-12 text-muted">
          {formatMoney(Number(m.unit_cost))}
        </span>
      ),
    },
    {
      key: 'ref',
      header: 'Reference',
      width: '1fr',
      render: (m) => (
        <span className="fs-11 text-muted" title={m.reference_id}>
          {m.reference_type}
        </span>
      ),
    },
  ];

  const clearAll = () => {
    setType('');
    setStorageId('');
    setSupplyId('');
    setSupplySearch('');
    setFrom('');
    setTo('');
  };

  const hasActiveFilters =
    !!(type || storageId || supplyId || from || to);

  return (
    <>
      <div
        className="toolbar"
        style={{ alignItems: 'flex-end', gap: 10 }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 220 }}>
          <label className="fs-11 text-muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Type
          </label>
          <select
            className="search-box"
            value={type}
            onChange={(e) => setType(e.target.value as StockMovementType | '')}
            style={{ cursor: 'pointer' }}
          >
            <option value="">All types</option>
            {STOCK_MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 220px', minWidth: 220 }}>
          <label className="fs-11 text-muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Storage
          </label>
          <select
            className="search-box"
            value={storageId}
            onChange={(e) => setStorageId(e.target.value)}
            disabled={storagesQ.isLoading}
            style={{ cursor: 'pointer' }}
          >
            <option value="">All storages</option>
            {storagesQ.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 260 }}>
          <label className="fs-11 text-muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Supply
          </label>
          <SearchInput
            value={supplySearch}
            onChange={setSupplySearch}
            placeholder="Search supply…"
          />
          <select
            className="search-box mt-4"
            value={supplyId}
            onChange={(e) => setSupplyId(e.target.value)}
            style={{ cursor: 'pointer' }}
          >
            <option value="">Any supply</option>
            {selectedSupply && !suppliesQ.data?.pages[0]?.items.some((s) => s.id === selectedSupply.id) && (
              <option value={selectedSupply.id}>{selectedSupply.name}</option>
            )}
            {suppliesQ.data?.pages
              .flatMap((p) => p.items)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>

        <div style={{ flex: '0 0 160px' }}>
          <label className="fs-11 text-muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            From
          </label>
          <input
            type="date"
            className="search-box"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div style={{ flex: '0 0 160px' }}>
          <label className="fs-11 text-muted" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            To
          </label>
          <input
            type="date"
            className="search-box"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="filter-pill"
            onClick={clearAll}
            style={{ alignSelf: 'flex-end' }}
          >
            Clear filters
          </button>
        )}
      </div>

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(m) => m.id}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={hasActiveFilters ? 'No movements match these filters' : 'No movements yet'}
        emptySub={
          hasActiveFilters
            ? 'Try clearing some filters.'
            : 'Movements are created automatically from purchases, sales, transfers, and inventory adjustments.'
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />
    </>
  );
}
