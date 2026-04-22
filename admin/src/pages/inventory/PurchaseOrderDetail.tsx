import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import {
  useCancelPurchase,
  useConfirmPurchase,
  useDeletePurchase,
  usePurchase,
  useAddPurchaseItem,
  useRemovePurchaseItem,
} from '../../hooks/usePurchases';
import { useSupplies } from '../../hooks/useSupplies';
import { listPackagings } from '../../api/packagings';
import { Select } from '../../components/forms/Select';
import { Input } from '../../components/forms/Input';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../utils/format';
import type {
  PurchaseItem,
  PurchasePackaging,
  PurchaseStatus,
} from '../../types/inventory';

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

export function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const purchaseQ = usePurchase(id);
  const confirmM = useConfirmPurchase();
  const cancelM = useCancelPurchase();
  const deleteM = useDeletePurchase();
  const addItemM = useAddPurchaseItem();
  const removeItemM = useRemovePurchaseItem();

  const [serverError, setServerError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLine, setNewLine] = useState({
    supply_id: '',
    packaging_id: '' as string,
    package_quantity: '1',
    price_per_package: '',
  });
  const [availablePackagings, setAvailablePackagings] = useState<PurchasePackaging[]>([]);
  const [loadingPkgs, setLoadingPkgs] = useState(false);

  const suppliesQ = useSupplies({ active: true });
  const supplies = useMemo(
    () => suppliesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliesQ.data],
  );

  if (purchaseQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading purchase order…
      </div>
    );
  }

  if (purchaseQ.error || !purchaseQ.data) {
    return (
      <EmptyState
        icon="⚠"
        message="Purchase order not found"
        sub={(purchaseQ.error as Error | null)?.message}
        action={
          <Link to="/inventory/purchases">
            <Button variant="secondary">Back to purchase orders</Button>
          </Link>
        }
      />
    );
  }

  const purchase = purchaseQ.data;
  const isDraft = purchase.status === 'DRAFT';
  const items = purchase.items ?? [];

  const onPickSupply = async (supplyId: string) => {
    setNewLine((l) => ({ ...l, supply_id: supplyId, packaging_id: '', price_per_package: '' }));
    setAvailablePackagings([]);
    if (!supplyId) return;
    setLoadingPkgs(true);
    try {
      const page = await listPackagings({
        supply_id: supplyId,
        supplier_id: purchase.supplier_id,
        active: true,
        limit: 100,
      });
      const primary = page.items.find((p) => p.is_primary) ?? page.items[0];
      setAvailablePackagings(page.items);
      if (primary) {
        setNewLine((l) => ({
          ...l,
          packaging_id: primary.id,
          price_per_package:
            primary.price_per_package != null
              ? (Number(primary.price_per_package) / 100).toString()
              : '',
        }));
      }
    } finally {
      setLoadingPkgs(false);
    }
  };

  const onPickPackaging = (packagingId: string) => {
    const pkg = availablePackagings.find((p) => p.id === packagingId);
    setNewLine((l) => ({
      ...l,
      packaging_id: packagingId,
      price_per_package:
        pkg?.price_per_package != null
          ? (Number(pkg.price_per_package) / 100).toString()
          : l.price_per_package,
    }));
  };

  const submitAdd = async () => {
    if (!newLine.supply_id) return;
    setServerError(null);
    try {
      await addItemM.mutateAsync({
        purchaseId: purchase.id,
        input: {
          supply_id: newLine.supply_id,
          packaging_id: newLine.packaging_id || null,
          package_quantity: Number(newLine.package_quantity),
          price_per_package: Math.round(Number(newLine.price_per_package) * 100),
        },
      });
      setNewLine({
        supply_id: '',
        packaging_id: '',
        package_quantity: '1',
        price_per_package: '',
      });
      setAvailablePackagings([]);
      setAdding(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to add line');
    }
  };

  const removeItem = async (item: PurchaseItem) => {
    if (!window.confirm('Remove this line from the draft?')) return;
    setServerError(null);
    try {
      await removeItemM.mutateAsync({ purchaseId: purchase.id, itemId: item.id });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to remove line');
    }
  };

  const confirmPurchase = async () => {
    const ok = window.confirm(
      'Confirm this purchase order?\n\nThis will update stock, recalculate weighted average cost, and cannot be undone.',
    );
    if (!ok) return;
    setServerError(null);
    try {
      await confirmM.mutateAsync(purchase.id);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to confirm purchase');
    }
  };

  const cancelPurchase = async () => {
    if (!window.confirm('Cancel this draft purchase order?')) return;
    setServerError(null);
    try {
      await cancelM.mutateAsync(purchase.id);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to cancel purchase');
    }
  };

  const deleteDraft = async () => {
    if (!window.confirm('Permanently delete this draft? This cannot be undone.')) return;
    setServerError(null);
    try {
      await deleteM.mutateAsync(purchase.id);
      navigate('/inventory/purchases');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to delete draft');
    }
  };

  const itemColumns: TableColumn<PurchaseItem>[] = [
    {
      key: 'supply',
      header: 'Supply',
      width: '1.7fr',
      render: (it) => (
        <div>
          <div className="fw-600 fs-13">{it.supply?.name ?? '—'}</div>
          {it.packaging?.name && (
            <div className="fs-11 text-muted">{it.packaging.name}</div>
          )}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Packages',
      width: '110px',
      render: (it) => (
        <span className="fs-13">{formatNumber(it.package_quantity, 4)}</span>
      ),
    },
    {
      key: 'base',
      header: 'Base units',
      width: '130px',
      render: (it) => (
        <span className="fs-13">
          {formatNumber(it.base_unit_quantity, 4)}{' '}
          <span className="fs-11 text-muted">
            {it.supply?.base_unit?.toLowerCase()}
          </span>
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price / pkg',
      width: '120px',
      render: (it) => (
        <span className="fs-13">{formatMoney(Number(it.price_per_package))}</span>
      ),
    },
    {
      key: 'unit_cost',
      header: 'Unit cost',
      width: '120px',
      render: (it) => (
        <span className="fs-13 text-gold fw-600">
          {formatMoney(Number(it.unit_cost))}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Line total',
      width: '120px',
      render: (it) => (
        <span className="fs-13 fw-600">
          {formatMoney(
            Number(it.package_quantity) * Number(it.price_per_package),
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '100px',
      render: (it) =>
        isDraft && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeItem(it)}
            disabled={removeItemM.isPending}
          >
            Remove
          </Button>
        ),
    },
  ];

  return (
    <>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Link
            to="/inventory/purchases"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to purchase orders
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
            Purchase order · {purchase.supplier?.name ?? '—'}
          </h1>
          <div className="flex gap-8 mt-4">
            <span className={`po-status-pill ${statusClass(purchase.status)}`}>
              {purchase.status}
            </span>
            <span className="fs-12 text-muted">{formatDate(purchase.date)}</span>
            <span className="fs-12 text-muted">
              Created {formatDateTime(purchase.created_at)}
            </span>
          </div>
        </div>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          {isDraft && (
            <>
              <Button
                variant="ghost"
                onClick={deleteDraft}
                disabled={deleteM.isPending}
              >
                Delete draft
              </Button>
              <Button
                variant="secondary"
                onClick={cancelPurchase}
                loading={cancelM.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={confirmPurchase}
                loading={confirmM.isPending}
                disabled={items.length === 0}
              >
                Confirm purchase
              </Button>
            </>
          )}
        </div>
      </div>

      {serverError && <div className="auth-alert mb-16">{serverError}</div>}

      {/* Header summary */}
      <div className="section-grid-3 mb-16">
        <Card>
          <div className="chart-title">Details</div>
          <div className="detail-grid">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Supplier</div>
                <div className="dv fw-600">{purchase.supplier?.name ?? '—'}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Storage</div>
                <div className="dv">{purchase.storage?.name ?? '—'}</div>
              </div>
            </div>
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Date</div>
                <div className="dv">{formatDate(purchase.date)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Payment</div>
                <div className="dv">{purchase.payment_method ?? '—'}</div>
              </div>
            </div>
            {purchase.notes && (
              <div className="detail-row">
                <div className="detail-cell" style={{ gridColumn: '1 / -1' }}>
                  <div className="dk">Notes</div>
                  <div className="dv fs-12">{purchase.notes}</div>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="chart-title">Summary</div>
          <div className="detail-grid">
            <div className="detail-row">
              <div className="detail-cell">
                <div className="dk">Items</div>
                <div className="dv">{items.length}</div>
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-cell">
                <div className="dk">Total</div>
                <div className="dv gold" style={{ fontSize: 18 }}>
                  {formatMoney(Number(purchase.total))}
                </div>
              </div>
            </div>
            {purchase.user && (
              <div className="detail-row">
                <div className="detail-cell">
                  <div className="dk">Created by</div>
                  <div className="dv fs-12">{purchase.user.name}</div>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Items section */}
      <div className="detail-section">
        <div className="flex-between mb-8">
          <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
            Lines
          </h3>
          {isDraft && !adding && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAdding(true)}
            >
              + Add line
            </Button>
          )}
        </div>

        {adding && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 14,
              marginBottom: 12,
              background: 'var(--bg)',
            }}
          >
            <div className="section-grid-2">
              <Select
                label="Supply"
                name="add_supply"
                value={newLine.supply_id}
                onValueChange={onPickSupply}
                placeholder="Select supply…"
                options={supplies.map((s) => ({ value: s.id, label: s.name }))}
              />
              <Select
                label="Packaging"
                name="add_packaging"
                value={newLine.packaging_id}
                onValueChange={onPickPackaging}
                placeholder={
                  loadingPkgs
                    ? 'Loading…'
                    : availablePackagings.length === 0
                      ? 'No packaging — bought in base units'
                      : 'Select packaging…'
                }
                options={availablePackagings.map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.is_primary ? ' ★' : ''} (${Number(p.units_per_package)} per pkg)`,
                }))}
                disabled={loadingPkgs || !newLine.supply_id}
              />
            </div>
            <div className="section-grid-2">
              <Input
                label="Packages"
                name="add_qty"
                type="number"
                step="any"
                min="0"
                value={newLine.package_quantity}
                onChange={(e) =>
                  setNewLine((l) => ({ ...l, package_quantity: e.target.value }))
                }
              />
              <Input
                label="Price per package"
                name="add_price"
                type="number"
                step="0.01"
                min="0"
                value={newLine.price_per_package}
                onChange={(e) =>
                  setNewLine((l) => ({ ...l, price_per_package: e.target.value }))
                }
              />
            </div>
            <div className="flex gap-8" style={{ justifyContent: 'flex-end' }}>
              <Button
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setAvailablePackagings([]);
                  setNewLine({
                    supply_id: '',
                    packaging_id: '',
                    package_quantity: '1',
                    price_per_package: '',
                  });
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={submitAdd}
                loading={addItemM.isPending}
                disabled={
                  !newLine.supply_id ||
                  !newLine.package_quantity ||
                  !newLine.price_per_package
                }
              >
                Add line
              </Button>
            </div>
          </div>
        )}

        <Table
          columns={itemColumns}
          rows={items}
          getRowKey={(it) => it.id}
          emptyMessage="No lines on this purchase order"
          emptySub={
            isDraft
              ? 'Add lines before confirming the purchase.'
              : 'This purchase was saved without any lines.'
          }
        />
      </div>

      {/* Status badge meta */}
      {purchase.status !== 'DRAFT' && (
        <div className="detail-section">
          <h3>Status</h3>
          <div className="detail-grid">
            <div className="detail-row">
              <div className="detail-cell">
                <div className="dk">Current status</div>
                <div className="dv">
                  <Badge
                    tone={
                      purchase.status === 'CONFIRMED'
                        ? 'green'
                        : 'gray'
                    }
                  >
                    {purchase.status}
                  </Badge>
                </div>
              </div>
            </div>
            {purchase.status === 'CONFIRMED' && (
              <div className="detail-row">
                <div className="detail-cell">
                  <div className="dk">Side effects</div>
                  <div className="dv fs-12 text-muted">
                    Storage stock increased, WAC recalculated, and stock
                    movements of type PURCHASE were appended for each line.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
