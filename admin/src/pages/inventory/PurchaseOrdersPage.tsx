import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { usePurchases } from '../../hooks/usePurchases';
import { useSuppliers } from '../../hooks/useSuppliers';
import { formatDate, formatMoney } from '../../utils/format';
import type { Purchase, PurchaseKind, PurchaseStatus } from '../../types/inventory';
import { useTranslation } from '../../i18n';
import { KIND_ICON, STATUS_I18N_KEY, STATUS_PILL_CLASS } from '../../components/purchase-orders/status';

type KindFilter = 'ALL' | PurchaseKind;

// Status options grouped by lifecycle so the dropdown reads top-down.
const ALL_STATUSES: PurchaseStatus[] = [
  'DRAFT',
  'SENT_TO_SUPPLIER',
  'SUPPLIER_REPLIED',
  'PAID',
  'IN_TRANSIT',
  'ARRIVED',
  'DISPATCHED',
  'RETURNED',
  'VERIFIED',
  'REJECTED',
  'CANCELLED',
];

function lastActionAt(p: Purchase): string {
  // Surface the most recent state-change timestamp so the operator can sort
  // by "what's most stale" at a glance.
  return (
    p.verified_at ||
    p.cancelled_at ||
    p.returned_at ||
    p.arrived_at ||
    p.in_transit_at ||
    p.paid_at ||
    p.supplier_replied_at ||
    p.message_sent_at ||
    p.dispatched_at ||
    p.updated_at
  );
}

function lastActor(p: Purchase): string {
  return (
    p.verifier?.name ||
    p.canceller?.name ||
    p.runner?.name ||
    p.user?.name ||
    '—'
  );
}

export function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const [supplierId, setSupplierId] = useState('');

  const suppliersQ = useSuppliers({ active: true });

  const filters = useMemo(
    () => ({
      status: (status || undefined) as PurchaseStatus | undefined,
      kind: kindFilter === 'ALL' ? undefined : kindFilter,
      supplier_id: supplierId || undefined,
    }),
    [status, kindFilter, supplierId],
  );

  const query = usePurchases(filters);
  const rows = useMemo<Purchase[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const columns: TableColumn<Purchase>[] = [
    {
      key: 'kind',
      header: t('po.list.colKind'),
      width: '80px',
      render: (p) => (
        <span className="po-kind-pill">
          <span aria-hidden>{KIND_ICON[p.kind]}</span>
          {t(p.kind === 'DELIVERY' ? 'po.kind.delivery' : 'po.kind.errand')}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('purchases.colDate'),
      width: '110px',
      render: (p) => <span className="fs-13">{formatDate(p.date)}</span>,
    },
    {
      key: 'supplier',
      header: t('po.list.colSupplier'),
      width: '1.4fr',
      render: (p) => (
        <span className="fs-13 fw-600">{p.supplier?.name ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('po.list.colStatus'),
      width: '160px',
      render: (p) => (
        <span className={STATUS_PILL_CLASS[p.status]}>{t(STATUS_I18N_KEY[p.status])}</span>
      ),
    },
    {
      key: 'total',
      header: t('po.list.colTotal'),
      width: '130px',
      render: (p) => (
        <span className="fs-13 fw-600">{formatMoney(Number(p.total))}</span>
      ),
    },
    {
      key: 'lastAction',
      header: t('po.list.colLastAction'),
      width: '180px',
      render: (p) => (
        <span className="fs-12 text-muted">{formatDate(lastActionAt(p))}</span>
      ),
    },
    {
      key: 'actor',
      header: t('po.list.colActor'),
      width: '140px',
      render: (p) => <span className="fs-12 text-muted">{lastActor(p)}</span>,
    },
  ];

  const hasActiveFilters = !!(status || supplierId || kindFilter !== 'ALL');

  return (
    <>
      {/* Kind tabs — the primary axis of navigation. Status is secondary. */}
      <div className="toolbar" style={{ gap: 6, marginBottom: 12 }}>
        {(['ALL', 'DELIVERY', 'ERRAND'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`filter-pill ${kindFilter === k ? 'active' : ''}`}
            onClick={() => setKindFilter(k)}
          >
            {k === 'ALL'
              ? t('po.tab.all')
              : k === 'DELIVERY'
                ? `${KIND_ICON.DELIVERY} ${t('po.tab.delivery')}`
                : `${KIND_ICON.ERRAND} ${t('po.tab.errand')}`}
          </button>
        ))}
      </div>

      <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: '1 1 200px', minWidth: 200 }}>
          <label className="fs-11 text-muted fw-600" style={{ display: 'block', marginBottom: 4 }}>
            {t('common.status')}
          </label>
          <select
            className="search-box"
            value={status}
            onChange={(e) => setStatus(e.target.value as PurchaseStatus | '')}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')}</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(STATUS_I18N_KEY[s])}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 220px', minWidth: 220 }}>
          <label className="fs-11 text-muted fw-600" style={{ display: 'block', marginBottom: 4 }}>
            {t('po.list.colSupplier')}
          </label>
          <select
            className="search-box"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={suppliersQ.isLoading}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')}</option>
            {suppliersQ.data?.pages
              .flatMap((p) => p.items)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="filter-pill"
            onClick={() => {
              setStatus('');
              setSupplierId('');
              setKindFilter('ALL');
            }}
          >
            {t('common.cancel')}
          </button>
        )}

        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <Button
            variant="secondary"
            onClick={() => navigate('/inventory/purchases/new?kind=ERRAND')}
          >
            + {t('po.newErrand')}
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate('/inventory/purchases/new?kind=DELIVERY')}
          >
            + {t('po.newDelivery')}
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/inventory/purchases/${p.id}`)}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={t('po.list.empty')}
        emptySub={t('po.list.emptyHint')}
        emptyAction={
          !hasActiveFilters && (
            <Button
              variant="primary"
              onClick={() => navigate('/inventory/purchases/new?kind=DELIVERY')}
            >
              + {t('po.newDelivery')}
            </Button>
          )
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />
    </>
  );
}
