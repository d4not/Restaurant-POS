import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useOrders } from '../../hooks/useOrders';
import { useZones } from '../../hooks/useZones';
import type { Order, OrderStatus, OrderType } from '../../types/operations';
import {
  ORDER_STATUSES,
  ORDER_TYPES,
  orderStatusLabel,
  orderTypeLabel,
  paymentMethodLabel,
} from '../../types/operations';
import { formatDateTime, formatMoney } from '../../utils/format';
import {
  orderStatusTone,
  orderTypeTone,
  paymentMethodTone,
} from '../staff/operations-meta';
import { OrderDetailModal } from './OrderDetailModal';
import { NewOrderModal } from './NewOrderModal';

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

export function OrdersPage() {
  const [urlParams, setUrlParams] = useSearchParams();

  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [orderType, setOrderType] = useState<OrderType | ''>('');
  const [zoneId, setZoneId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const zonesQ = useZones({ active: true });
  const zones = zonesQ.data?.items ?? [];

  // Detail modal is driven by ?id=<uuid> so shift-detail links can deep-link.
  const selectedId = urlParams.get('id');
  const setSelectedId = (id: string | null) => {
    const next = new URLSearchParams(urlParams);
    if (id) next.set('id', id);
    else next.delete('id');
    setUrlParams(next, { replace: true });
  };

  const [newOrderOpen, setNewOrderOpen] = useState(false);

  const filters = useMemo(
    () => ({
      status: (status || undefined) as OrderStatus | undefined,
      order_type: (orderType || undefined) as OrderType | undefined,
      zone_id: zoneId || undefined,
      from: toIsoDayStart(from),
      to: toIsoDayEnd(to),
    }),
    [status, orderType, zoneId, from, to],
  );

  const query = useOrders(filters);

  const allRows = useMemo<Order[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  // Client-side search by order_number or cashier name — cheap and keeps the
  // backend filter surface small.
  const rows = useMemo<Order[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((o) => {
      if (String(o.order_number).includes(q)) return true;
      if (o.user?.name?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [allRows, search]);

  const columns: TableColumn<Order>[] = [
    {
      key: 'number',
      header: '#',
      width: '70px',
      render: (o) => <span className="fw-600 fs-13">#{o.order_number}</span>,
    },
    {
      key: 'date',
      header: 'Date / time',
      width: '170px',
      render: (o) => (
        <span className="fs-12 text-muted">{formatDateTime(o.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '110px',
      render: (o) => (
        <Badge tone={orderTypeTone(o.order_type)}>
          {orderTypeLabel(o.order_type)}
        </Badge>
      ),
    },
    {
      key: 'table',
      header: 'Table',
      width: '160px',
      render: (o) => {
        if (!o.table) {
          return <span className="fs-12 text-muted">—</span>;
        }
        return (
          <span className="fs-13">
            <span className="fw-600">#{o.table.number}</span>
            <span className="text-muted"> · {o.table.zone.name}</span>
          </span>
        );
      },
    },
    {
      key: 'cashier',
      header: 'Cashier',
      width: '1fr',
      render: (o) => <span className="fs-13">{o.user?.name ?? '—'}</span>,
    },
    {
      key: 'items',
      header: 'Items',
      width: '90px',
      render: (o) => {
        const count = (o.items ?? []).reduce((sum, i) => sum + i.quantity, 0);
        return <span className="fs-13">{count}</span>;
      },
    },
    {
      key: 'total',
      header: 'Total',
      width: '120px',
      render: (o) => (
        <span className="fw-600 fs-13">{formatMoney(Number(o.total))}</span>
      ),
    },
    {
      key: 'payment',
      header: 'Payment',
      width: '130px',
      render: (o) => {
        const methods = Array.from(
          new Set((o.payments ?? []).map((p) => p.method)),
        );
        if (methods.length === 0) {
          return <span className="fs-12 text-muted">—</span>;
        }
        if (methods.length === 1) {
          const m = methods[0]!;
          return <Badge tone={paymentMethodTone(m)}>{paymentMethodLabel(m)}</Badge>;
        }
        return <Badge tone="gray">Split</Badge>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (o) => (
        <Badge tone={orderStatusTone(o.status)}>
          {orderStatusLabel(o.status)}
        </Badge>
      ),
    },
  ];

  const clearAll = () => {
    setStatus('');
    setOrderType('');
    setZoneId('');
    setFrom('');
    setTo('');
    setSearch('');
  };

  const hasActiveFilters =
    !!(status || orderType || zoneId || from || to || search);

  return (
    <>
      <div className="flex-between mb-12">
        <div />
        <Button variant="primary" onClick={() => setNewOrderOpen(true)}>
          + New order
        </Button>
      </div>

      <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: '1 1 260px', minWidth: 220 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            Search
          </label>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Order # or cashier…"
          />
        </div>

        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            Status
          </label>
          <select
            className="search-box"
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
            style={{ cursor: 'pointer' }}
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            Type
          </label>
          <select
            className="search-box"
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as OrderType | '')}
            style={{ cursor: 'pointer' }}
          >
            <option value="">All types</option>
            {ORDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {orderTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            Zone
          </label>
          <select
            className="search-box"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            style={{ cursor: 'pointer' }}
            disabled={zonesQ.isLoading}
          >
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '0 0 160px' }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
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
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
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
        getRowKey={(o) => o.id}
        onRowClick={(o) => setSelectedId(o.id)}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={
          hasActiveFilters ? 'No orders match these filters' : 'No orders yet'
        }
        emptySub={
          hasActiveFilters
            ? 'Try clearing some filters.'
            : 'Orders are created from the POS terminal. This view is read-only.'
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />

      <OrderDetailModal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        orderId={selectedId}
      />

      <NewOrderModal
        open={newOrderOpen}
        onClose={() => setNewOrderOpen(false)}
        onCreated={() => {
          /* Stay on the 'done' screen; user closes with Done button. */
        }}
      />
    </>
  );
}
