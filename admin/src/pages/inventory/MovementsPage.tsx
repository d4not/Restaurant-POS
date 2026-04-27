import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge, Button, Modal, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useMovements } from '../../hooks/useMovements';
import { useStorages } from '../../hooks/useStorages';
import { useSupplies } from '../../hooks/useSupplies';
import {
  type StockMovement,
  type StockMovementType,
} from '../../types/inventory';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
} from '../../utils/format';
import { movementTypeTone } from './movement-meta';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

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

// Tab definitions — each maps to a set of StockMovementType values. Transfers
// surface both legs of the trip (TRANSFER_OUT at the source, TRANSFER_IN at
// the destination) so a single transfer event shows two rows under one tab.
type CategoryId = 'all' | 'sales' | 'purchases' | 'transfers' | 'mermas' | 'adjustments';

interface CategoryDef {
  id: CategoryId;
  labelKey: TranslationKey;
  types: StockMovementType[];
  descriptionKey: TranslationKey;
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'all',
    labelKey: 'common.all',
    types: [],
    descriptionKey: 'movements.subtitle',
  },
  {
    id: 'sales',
    labelKey: 'movements.typeSale',
    types: ['SALE'],
    descriptionKey: 'movements.subtitle',
  },
  {
    id: 'purchases',
    labelKey: 'movements.typePurchase',
    types: ['PURCHASE'],
    descriptionKey: 'movements.subtitle',
  },
  {
    id: 'transfers',
    labelKey: 'movements.typeTransferIn',
    types: ['TRANSFER_OUT', 'TRANSFER_IN'],
    descriptionKey: 'movements.subtitle',
  },
  {
    id: 'mermas',
    labelKey: 'movements.typeWriteOff',
    types: ['WRITE_OFF'],
    descriptionKey: 'movements.subtitle',
  },
  {
    id: 'adjustments',
    labelKey: 'movements.typeAdjustment',
    types: ['ADJUSTMENT'],
    descriptionKey: 'movements.subtitle',
  },
];

export function MovementsPage() {
  const { t } = useTranslation();
  const [urlParams, setUrlParams] = useSearchParams();

  const [category, setCategory] = useState<CategoryId>('all');
  const [storageId, setStorageId] = useState('');
  const [supplySearch, setSupplySearch] = useState('');
  const [supplyId, setSupplyId] = useState<string>(urlParams.get('supply_id') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [terminalActionModal, setTerminalActionModal] = useState<
    'transfer' | 'write-off' | null
  >(null);

  const storagesQ = useStorages();
  const suppliesQ = useSupplies({ search: supplySearch || undefined });

  const selectedSupply = useMemo(() => {
    if (!supplyId) return null;
    return (
      suppliesQ.data?.pages
        .flatMap((p) => p.items)
        .find((s) => s.id === supplyId) ?? null
    );
  }, [suppliesQ.data, supplyId]);

  useEffect(() => {
    const current = urlParams.get('supply_id') ?? '';
    if (supplyId === current) return;
    const next = new URLSearchParams(urlParams);
    if (supplyId) next.set('supply_id', supplyId);
    else next.delete('supply_id');
    setUrlParams(next, { replace: true });
  }, [supplyId, urlParams, setUrlParams]);

  const activeCategory = CATEGORIES.find((c) => c.id === category) ?? CATEGORIES[0];

  const filters = useMemo(
    () => ({
      type: activeCategory.types.length > 0 ? activeCategory.types : undefined,
      storage_id: storageId || undefined,
      supply_id: supplyId || undefined,
      from: toIsoDayStart(from),
      to: toIsoDayEnd(to),
    }),
    [activeCategory, storageId, supplyId, from, to],
  );

  const query = useMovements(filters);

  const rows = useMemo<StockMovement[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const columns: TableColumn<StockMovement>[] = [
    {
      key: 'date',
      header: t('common.date'),
      width: '170px',
      render: (m) => (
        <span className="fs-12 text-muted">{formatDateTime(m.created_at)}</span>
      ),
    },
    {
      key: 'supply',
      header: t('movements.colSupply'),
      width: '1.6fr',
      render: (m) => (
        <div className="fw-600 fs-13">{m.supply?.name ?? '—'}</div>
      ),
    },
    {
      key: 'storage',
      header: t('movements.colStorage'),
      width: '1fr',
      render: (m) => <span className="fs-13">{m.storage?.name ?? '—'}</span>,
    },
    {
      key: 'type',
      header: t('common.type'),
      width: '130px',
      render: (m) => <Badge tone={movementTypeTone(m.type)}>{m.type}</Badge>,
    },
    {
      key: 'qty',
      header: t('common.qty'),
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
      header: t('movements.colCost'),
      width: '120px',
      render: (m) => (
        <span className="fs-12 text-muted">
          {formatMoney(Number(m.unit_cost))}
        </span>
      ),
    },
    {
      key: 'ref',
      header: t('movements.colReference'),
      width: '1fr',
      render: (m) => (
        <span className="fs-11 text-muted" title={m.reference_id}>
          {m.reference_type}
        </span>
      ),
    },
  ];

  const clearAll = () => {
    setCategory('all');
    setStorageId('');
    setSupplyId('');
    setSupplySearch('');
    setFrom('');
    setTo('');
  };

  const hasActiveFilters =
    category !== 'all' || !!(storageId || supplyId || from || to);

  return (
    <>
      {/* Category tab strip — primary segmentation of the movements ledger */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`filter-pill ${category === c.id ? 'active' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            {t(c.labelKey)}
          </button>
        ))}
      </div>
      <p className="fs-12 text-muted" style={{ marginBottom: 14 }}>
        {t(activeCategory.descriptionKey)}
      </p>

      {/* Action buttons — both flows live in the POS terminal app, the buttons
          here surface that affordance + open a brief explainer modal. */}
      <div
        className="flex gap-8"
        style={{ marginBottom: 14, flexWrap: 'wrap' }}
      >
        <Button
          variant="secondary"
          onClick={() => setTerminalActionModal('transfer')}
        >
          + Register transfer
        </Button>
        <Button
          variant="secondary"
          onClick={() => setTerminalActionModal('write-off')}
        >
          + Register write-off
        </Button>
      </div>

      {/* Fine-grained filters */}
      <div className="toolbar" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: '1 1 220px', minWidth: 220 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            {t('movements.colStorage')}
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

        <div style={{ flex: '1 1 260px', minWidth: 260 }}>
          <label
            className="fs-11 text-muted"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            {t('movements.colSupply')}
          </label>
          <SearchInput
            value={supplySearch}
            onChange={setSupplySearch}
            placeholder={t('common.search')}
          />
          <select
            className="search-box mt-4"
            value={supplyId}
            onChange={(e) => setSupplyId(e.target.value)}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')}</option>
            {selectedSupply &&
              !suppliesQ.data?.pages[0]?.items.some(
                (s) => s.id === selectedSupply.id,
              ) && (
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
        <div style={{ flex: '0 0 160px' }}>
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

        {hasActiveFilters && (
          <button
            type="button"
            className="filter-pill"
            onClick={clearAll}
            style={{ alignSelf: 'flex-end' }}
          >
            {t('common.cancel')}
          </button>
        )}
      </div>

      <Table
        columns={columns}
        rows={rows}
        getRowKey={(m) => m.id}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={t('movements.empty')}
        emptySub={t('movements.subtitle')}
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />

      <TerminalActionModal
        kind={terminalActionModal}
        onClose={() => setTerminalActionModal(null)}
      />
    </>
  );
}

interface TerminalActionModalProps {
  kind: 'transfer' | 'write-off' | null;
  onClose: () => void;
}

function TerminalActionModal({ kind, onClose }: TerminalActionModalProps) {
  const open = kind !== null;
  const isTransfer = kind === 'transfer';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isTransfer ? 'Register a transfer' : 'Register a write-off'}
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <p className="fs-13" style={{ lineHeight: 1.55 }}>
        {isTransfer ? (
          <>
            Transfers move stock between two storages — for example, restocking
            the bar from the warehouse fridge.
          </>
        ) : (
          <>
            Write-offs (mermas) record stock leaving inventory for any reason
            other than a sale: spilled milk, expired bag, damaged bottle, theft.
          </>
        )}
      </p>
      <p
        className="fs-13"
        style={{ marginTop: 10, lineHeight: 1.55, color: 'var(--text2)' }}
      >
        This flow lives in the <strong>POS terminal</strong> app — the staff
        member at the bar registers it from the same device they use to take
        orders, then it shows up here under the{' '}
        <Badge tone={isTransfer ? 'gold' : 'red'}>
          {isTransfer ? 'Transfers' : 'Mermas'}
        </Badge>{' '}
        tab. Inventory checks (full counts) are also done from the terminal and
        their adjustments land under{' '}
        <Badge tone="blue">Adjustments</Badge>.
      </p>
    </Modal>
  );
}
