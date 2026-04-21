import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { useSupply, useSupplyStocks } from '../../hooks/useSupplies';
import { useSuppliers } from '../../hooks/useSuppliers';
import { usePackagings } from '../../hooks/usePackagings';
import { useMovements } from '../../hooks/useMovements';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
} from '../../utils/format';
import type { StockMovement, StorageStock } from '../../types/inventory';
import { SupplyFormModal } from './SupplyFormModal';
import { movementTypeTone } from './movement-meta';

export function SupplyDetail() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);

  const supplyQ = useSupply(id);
  const stocksQ = useSupplyStocks(id);
  const packagingsQ = usePackagings({ supply_id: id });
  const movementsQ = useMovements({ supply_id: id });
  const suppliersQ = useSuppliers({});

  const suppliersById = useMemo(() => {
    const map = new Map<string, string>();
    suppliersQ.data?.pages.forEach((p) =>
      p.items.forEach((s) => map.set(s.id, s.name)),
    );
    return map;
  }, [suppliersQ.data]);

  if (supplyQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading supply…
      </div>
    );
  }

  if (supplyQ.error || !supplyQ.data) {
    return (
      <EmptyState
        icon="⚠"
        message="Supply not found"
        sub={(supplyQ.error as Error | null)?.message}
        action={
          <Link to="/inventory/supplies">
            <Button variant="secondary">Back to supplies</Button>
          </Link>
        }
      />
    );
  }

  const supply = supplyQ.data;
  const stocks = stocksQ.data?.items ?? [];
  const totalStock = stocks.reduce((acc, s) => acc + Number(s.quantity), 0);
  const packagings = packagingsQ.data?.items ?? [];
  const movements = movementsQ.data?.pages.flatMap((p) => p.items) ?? [];

  const contentLine =
    supply.content_per_unit && supply.content_unit
      ? `${formatNumber(supply.content_per_unit)} ${supply.content_unit.toLowerCase()} per ${supply.base_unit.toLowerCase()}`
      : '—';

  const stockColumns: TableColumn<StorageStock>[] = [
    {
      key: 'storage',
      header: 'Storage',
      width: '2fr',
      render: (s) => (
        <div className="fw-600 fs-13">{s.storage?.name ?? '—'}</div>
      ),
    },
    {
      key: 'qty',
      header: `Quantity (${supply.base_unit.toLowerCase()})`,
      width: '1fr',
      render: (s) => (
        <span className="fw-600 fs-13">{formatNumber(s.quantity)}</span>
      ),
    },
    {
      key: 'min',
      header: 'Min stock',
      width: '1fr',
      render: (s) => (
        <span className="text-muted fs-12">
          {s.min_stock ? formatNumber(s.min_stock) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (s) => {
        const qty = Number(s.quantity);
        const min = s.min_stock ? Number(s.min_stock) : null;
        if (min !== null && qty <= min) return <Badge tone="red">Below min</Badge>;
        if (min !== null && qty <= min * 1.5) return <Badge tone="gold">Low</Badge>;
        return <Badge tone="green">OK</Badge>;
      },
    },
  ];

  const movementColumns: TableColumn<StockMovement>[] = [
    {
      key: 'date',
      header: 'Date',
      width: '170px',
      render: (m) => (
        <span className="fs-12 text-muted">{formatDateTime(m.created_at)}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '130px',
      render: (m) => <Badge tone={movementTypeTone(m.type)}>{m.type}</Badge>,
    },
    {
      key: 'storage',
      header: 'Storage',
      width: '1fr',
      render: (m) => <span className="fs-13">{m.storage?.name ?? '—'}</span>,
    },
    {
      key: 'qty',
      header: 'Qty',
      width: '110px',
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
      width: '110px',
      render: (m) => (
        <span className="fs-12 text-muted">
          {formatMoney(Number(m.unit_cost))}
        </span>
      ),
    },
  ];

  return (
    <>
      {/* Header actions */}
      <div
        className="flex-between mb-16"
        style={{ flexWrap: 'wrap', gap: 8 }}
      >
        <div>
          <Link
            to="/inventory/supplies"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to supplies
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
            {supply.name}
          </h1>
          <div className="flex gap-8 mt-4">
            {supply.active ? (
              <Badge tone="green">Active</Badge>
            ) : (
              <Badge tone="red">Inactive</Badge>
            )}
            {supply.category && (
              <Badge tone="gray">{supply.category.name}</Badge>
            )}
            {supply.barcode && (
              <span className="fs-12 text-muted">{supply.barcode}</span>
            )}
          </div>
        </div>
        <Button variant="primary" onClick={() => setEditing(true)}>
          Edit supply
        </Button>
      </div>

      {/* 3-layer unit model */}
      <div className="section-grid-3 mb-16">
        <Card>
          <div className="chart-title">Purchase layer</div>
          {packagingsQ.isLoading ? (
            <div className="loading-block"><span className="spinner" />Loading packagings…</div>
          ) : packagings.length === 0 ? (
            <div className="fs-12 text-muted">
              No purchase packagings yet. When you buy this supply, you can
              register packaging options (box, case, bag) that map to base units.
            </div>
          ) : (
            <div className="detail-grid">
              {packagings.map((p) => (
                <div key={p.id} className="detail-row cols-2">
                  <div className="detail-cell">
                    <div className="dk">Package</div>
                    <div className="dv">
                      <div className="fw-600">{p.name}</div>
                      <div className="fs-11 text-muted">
                        {suppliersById.get(p.supplier_id) ?? '—'}
                      </div>
                    </div>
                  </div>
                  <div className="detail-cell">
                    <div className="dk">Units / pkg</div>
                    <div className="dv gold">
                      {formatNumber(p.units_per_package)} {supply.base_unit.toLowerCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="chart-title">Base &amp; recipe layers</div>
          <div className="detail-grid">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Base unit</div>
                <div className="dv">{supply.base_unit}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Total stock</div>
                <div className="dv gold">
                  {formatNumber(totalStock, 4)} {supply.base_unit.toLowerCase()}
                </div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Avg cost</div>
                <div className="dv">{formatMoney(Number(supply.average_cost))}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Last cost</div>
                <div className="dv">{formatMoney(Number(supply.last_cost))}</div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Recipe unit</div>
                <div className="dv">{contentLine}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Tare</div>
                <div className="dv">
                  {supply.tare_weight ? 'Configured' : '— not set —'}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Stock by storage */}
      <div className="detail-section">
        <h3>Stock by storage</h3>
        <Table
          columns={stockColumns}
          rows={stocks}
          getRowKey={(s) => s.id}
          isInitialLoad={stocksQ.isLoading}
          error={stocksQ.error as Error | null}
          emptyMessage="No stock recorded for this supply yet"
          emptySub="Stock is created when the first purchase is confirmed."
        />
      </div>

      {/* Tare section */}
      {supply.tare_weight && (
        <div className="detail-section">
          <h3>Tare weight</h3>
          <div className="detail-grid">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Empty weight</div>
                <div className="dv">
                  {formatNumber(supply.tare_weight.empty_weight_grams)} g
                </div>
              </div>
              <div className="detail-cell">
                <div className="dk">Full weight</div>
                <div className="dv">
                  {formatNumber(supply.tare_weight.full_weight_grams)} g
                </div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Net content</div>
                <div className="dv gold">
                  {formatNumber(supply.tare_weight.net_content)}{' '}
                  {supply.content_unit?.toLowerCase() ?? ''}
                </div>
              </div>
              <div className="detail-cell">
                <div className="dk">Formula</div>
                <div className="dv fs-12 text-muted">
                  remaining = (current − empty) / (full − empty) × net
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent movements */}
      <div className="detail-section">
        <div className="flex-between mb-8">
          <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
            Recent movements
          </h3>
          <Link
            to={`/inventory/movements?supply_id=${supply.id}`}
            className="fs-12 text-gold"
          >
            View all →
          </Link>
        </div>
        <Table
          columns={movementColumns}
          rows={movements.slice(0, 20)}
          getRowKey={(m) => m.id}
          isInitialLoad={movementsQ.isLoading}
          error={movementsQ.error as Error | null}
          emptyMessage="No movements yet"
        />
      </div>

      <SupplyFormModal
        open={editing}
        onClose={() => setEditing(false)}
        supply={supply}
      />
    </>
  );
}
