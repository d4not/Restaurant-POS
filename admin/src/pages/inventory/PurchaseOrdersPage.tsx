import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { usePurchases } from '../../hooks/usePurchases';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useStorages } from '../../hooks/useStorages';
import { formatDate, formatMoney } from '../../utils/format';
import type { Purchase, PurchaseStatus } from '../../types/inventory';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

const STATUS_OPTIONS: { value: PurchaseStatus | ''; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'common.all' },
  { value: 'DRAFT', labelKey: 'purchases.statusDraft' },
  { value: 'CONFIRMED', labelKey: 'purchases.statusConfirmed' },
  { value: 'CANCELLED', labelKey: 'purchases.statusCancelled' },
];

function statusClass(status: PurchaseStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'draft';
    case 'CONFIRMED':
      return 'confirmed';
    case 'CANCELLED':
      return 'cancelled';
  }
}

export function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const [supplierId, setSupplierId] = useState('');
  const [storageId, setStorageId] = useState('');

  const suppliersQ = useSuppliers({ active: true });
  const storagesQ = useStorages();

  const filters = useMemo(
    () => ({
      status: (status || undefined) as PurchaseStatus | undefined,
      supplier_id: supplierId || undefined,
      storage_id: storageId || undefined,
    }),
    [status, supplierId, storageId],
  );

  const query = usePurchases(filters);

  const rows = useMemo<Purchase[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const columns: TableColumn<Purchase>[] = [
    {
      key: 'date',
      header: t('purchases.colDate'),
      width: '140px',
      render: (p) => (
        <span className="fs-13 fw-600">{formatDate(p.date)}</span>
      ),
    },
    {
      key: 'supplier',
      header: t('purchases.colSupplier'),
      width: '1.5fr',
      render: (p) => (
        <span className="fs-13">{p.supplier?.name ?? '—'}</span>
      ),
    },
    {
      key: 'storage',
      header: t('purchases.colStorage'),
      width: '1fr',
      render: (p) => (
        <span className="fs-12 text-muted">{p.storage?.name ?? '—'}</span>
      ),
    },
    {
      key: 'items',
      header: t('purchases.colItems'),
      width: '90px',
      render: (p) => (
        <span className="fs-13">{p.items?.length ?? 0}</span>
      ),
    },
    {
      key: 'total',
      header: t('purchases.colTotal'),
      width: '130px',
      render: (p) => (
        <span className="fs-13 fw-600">{formatMoney(Number(p.total))}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '130px',
      render: (p) => (
        <span className={`po-status-pill ${statusClass(p.status)}`}>
          {p.status}
        </span>
      ),
    },
  ];

  const hasActiveFilters = !!(status || supplierId || storageId);

  return (
    <>
      <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: '1 1 200px', minWidth: 200 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            {t('common.status')}
          </label>
          <select
            className="search-box"
            value={status}
            onChange={(e) => setStatus(e.target.value as PurchaseStatus | '')}
            style={{ cursor: 'pointer' }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 220px', minWidth: 220 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            {t('purchases.colSupplier')}
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

        <div style={{ flex: '1 1 200px', minWidth: 200 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            {t('purchases.colStorage')}
          </label>
          <select
            className="search-box"
            value={storageId}
            onChange={(e) => setStorageId(e.target.value)}
            disabled={storagesQ.isLoading}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')}</option>
            {storagesQ.data?.items.map((s) => (
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
              setStorageId('');
            }}
          >
            {t('common.cancel')}
          </button>
        )}

        <Button
          variant="primary"
          onClick={() => navigate('/inventory/purchases/new')}
        >
          + {t('purchases.newPurchase')}
        </Button>
      </div>

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/inventory/purchases/${p.id}`)}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={t('purchases.empty')}
        emptySub={t('purchases.subtitle')}
        emptyAction={
          !hasActiveFilters && (
            <Button
              variant="primary"
              onClick={() => navigate('/inventory/purchases/new')}
            >
              + {t('purchases.newPurchase')}
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
