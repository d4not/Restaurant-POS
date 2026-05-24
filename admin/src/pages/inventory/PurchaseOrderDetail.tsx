import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, EmptyState, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import {
  useAddPurchaseItem,
  useDeletePurchase,
  usePurchase,
  useRemovePurchaseItem,
  useSendPurchase,
} from '../../hooks/usePurchases';
import { useSupplies } from '../../hooks/useSupplies';
import { listPackagings } from '../../api/packagings';
import { Select } from '../../components/forms/Select';
import { Input } from '../../components/forms/Input';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../utils/format';
import { useTranslation } from '../../i18n';
import type {
  Purchase,
  PurchaseItem,
  PurchasePackaging,
  PurchaseStatus,
} from '../../types/inventory';
import {
  KIND_ICON,
  KIND_I18N_KEY,
  STATUS_I18N_KEY,
  STATUS_PILL_CLASS,
  isTerminal,
} from '../../components/purchase-orders/status';
import { StatusTimeline } from '../../components/purchase-orders/StatusTimeline';
import { DiffTable } from '../../components/purchase-orders/DiffTable';
import { WhatsappPreview } from '../../components/purchase-orders/WhatsappPreview';
import { ReplyModal } from '../../components/purchase-orders/ReplyModal';
import { PayModal } from '../../components/purchase-orders/PayModal';
import { InTransitModal } from '../../components/purchase-orders/InTransitModal';
import { ReceiveModal } from '../../components/purchase-orders/ReceiveModal';
import { VerifyModal } from '../../components/purchase-orders/VerifyModal';
import { DispatchModal } from '../../components/purchase-orders/DispatchModal';
import { ReturnModal } from '../../components/purchase-orders/ReturnModal';
import { CancelModal } from '../../components/purchase-orders/CancelModal';
import { useAuthStore } from '../../store/auth';

type ModalKey =
  | null
  | 'reply'
  | 'pay'
  | 'inTransit'
  | 'receive'
  | 'verify'
  | 'dispatch'
  | 'return'
  | 'cancel'
  | 'reject';

// Maps the current status to the primary "next step" CTA. The dispatch CTA
// for errand DRAFT lives separately because it's the lifecycle's only
// state-changing button. Pre-VERIFIED states also expose the destructive
// cancel/reject path via the secondary panel below.
function primaryActionForState(status: PurchaseStatus, kind: Purchase['kind']) {
  if (status === 'DRAFT') {
    return kind === 'DELIVERY' ? ({ key: 'send' as const }) : ({ key: 'dispatch' as const });
  }
  if (status === 'SENT_TO_SUPPLIER') return { key: 'reply' as const };
  if (status === 'SUPPLIER_REPLIED') return { key: 'pay' as const };
  if (status === 'PAID') return { key: 'inTransit' as const };
  if (status === 'IN_TRANSIT') return { key: 'receive' as const };
  if (status === 'ARRIVED' || status === 'RETURNED') return { key: 'verify' as const };
  if (status === 'DISPATCHED') return { key: 'return' as const };
  return null;
}

const ACTION_LABEL_KEY: Record<string, string> = {
  send: 'po.action.send',
  reply: 'po.action.registerReply',
  pay: 'po.action.markPaid',
  inTransit: 'po.action.markInTransit',
  receive: 'po.action.markArrived',
  verify: 'po.action.verify',
  dispatch: 'po.action.dispatch',
  return: 'po.action.markReturned',
};

export function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const purchaseQ = usePurchase(id);
  const sendM = useSendPurchase();
  const deleteM = useDeletePurchase();
  const addItemM = useAddPurchaseItem();
  const removeItemM = useRemovePurchaseItem();

  const role = useAuthStore((s) => s.user?.role);
  // Verify is the only manager+ button. Everything else is cashier-or-up,
  // and the backend enforces it anyway — we just hide the CTA to avoid
  // surfacing a 403 the operator can't recover from.
  const canVerify = role === 'ADMIN' || role === 'MANAGER';

  const [modal, setModal] = useState<ModalKey>(null);
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
  const isDelivery = purchase.kind === 'DELIVERY';
  const items = purchase.items ?? [];
  const primary = primaryActionForState(purchase.status, purchase.kind);
  const terminal = isTerminal(purchase.status);
  // Only delivery rows after /reply but before /pay can be REJECTED (supplier
  // said no). Everything else uses /cancel.
  const canReject =
    isDelivery &&
    (purchase.status === 'SENT_TO_SUPPLIER' || purchase.status === 'SUPPLIER_REPLIED');

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
      const primaryPkg = page.items.find((p) => p.is_primary) ?? page.items[0];
      setAvailablePackagings(page.items);
      if (primaryPkg) {
        setNewLine((l) => ({
          ...l,
          packaging_id: primaryPkg.id,
          price_per_package:
            primaryPkg.price_per_package != null
              ? (Number(primaryPkg.price_per_package) / 100).toString()
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
      setNewLine({ supply_id: '', packaging_id: '', package_quantity: '1', price_per_package: '' });
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

  const handlePrimaryAction = async () => {
    if (!primary) return;
    setServerError(null);
    try {
      if (primary.key === 'send') await sendM.mutateAsync(purchase.id);
      else setModal(primary.key as ModalKey);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Action failed');
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
      width: '100px',
      render: (it) => <span className="fs-13">{formatNumber(it.package_quantity, 4)}</span>,
    },
    {
      key: 'base',
      header: 'Base units',
      width: '120px',
      render: (it) => (
        <span className="fs-13">
          {formatNumber(it.base_unit_quantity, 4)}{' '}
          <span className="fs-11 text-muted">{it.supply?.base_unit?.toLowerCase()}</span>
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price / pkg',
      width: '110px',
      render: (it) => <span className="fs-13">{formatMoney(Number(it.price_per_package))}</span>,
    },
    {
      key: 'total',
      header: 'Line total',
      width: '110px',
      render: (it) => (
        <span className="fs-13 fw-600">
          {formatMoney(Number(it.package_quantity) * Number(it.price_per_package))}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '90px',
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
      {/* Header bar */}
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Link
            to="/inventory/purchases"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← {t('common.back')}
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
            <span aria-hidden style={{ marginRight: 8 }}>{KIND_ICON[purchase.kind]}</span>
            {purchase.supplier?.name ?? '—'}
          </h1>
          <div className="flex gap-8 mt-4" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={STATUS_PILL_CLASS[purchase.status]}>
              {t(STATUS_I18N_KEY[purchase.status])}
            </span>
            <span className="po-kind-pill">{t(KIND_I18N_KEY[purchase.kind])}</span>
            <span className="fs-12 text-muted">{formatDate(purchase.date)}</span>
            <span className="fs-12 text-muted">
              {t('common.created')} {formatDateTime(purchase.created_at)}
            </span>
          </div>
        </div>
        <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
          {isDraft && (
            <Button variant="ghost" onClick={deleteDraft} disabled={deleteM.isPending}>
              {t('common.delete')}
            </Button>
          )}
        </div>
      </div>

      {serverError && <div className="auth-alert mb-16">{serverError}</div>}

      {/* Body grid: main column (timeline + items + diff) + side column (actions + WhatsApp) */}
      <div className="po-detail-grid">
        <div className="po-detail-main">
          {/* WhatsApp preview only useful while the message hasn't gone out
              and only for digital. */}
          {isDelivery && (purchase.status === 'DRAFT' || purchase.status === 'SENT_TO_SUPPLIER') && (
            <Card>
              <h3 style={{ marginBottom: 12 }}>{t('po.whatsapp.preview')}</h3>
              <WhatsappPreview purchaseId={purchase.id} />
            </Card>
          )}

          {/* DRAFT — inline line editor + items table. Items can only mutate
              while DRAFT (backend enforces). After DRAFT we render the diff
              table that compares ordered vs received. */}
          {isDraft ? (
            <Card>
              <div className="flex-between mb-8">
                <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
                  {t('purchases.addItem')}
                </h3>
                {!adding && (
                  <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                    + {t('purchases.addItem')}
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
                      onChange={(e) => setNewLine((l) => ({ ...l, package_quantity: e.target.value }))}
                    />
                    <Input
                      label="Price per package"
                      name="add_price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={newLine.price_per_package}
                      onChange={(e) => setNewLine((l) => ({ ...l, price_per_package: e.target.value }))}
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
                      {t('common.cancel')}
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
                      {t('purchases.addItem')}
                    </Button>
                  </div>
                </div>
              )}
              <Table
                columns={itemColumns}
                rows={items}
                getRowKey={(it) => it.id}
                emptyMessage="No lines on this purchase order"
                emptySub="Add lines before sending or dispatching."
              />
            </Card>
          ) : (
            <Card>
              <h3 style={{ marginBottom: 12 }}>{t('po.diff.tableLabel')}</h3>
              <DiffTable purchase={purchase} />
              <div
                className="flex-between mt-16"
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <span className="fs-13 text-muted">{t('purchases.totalLabel')}</span>
                <span
                  className="fw-700"
                  style={{ fontFamily: "'Playfair Display', serif", fontSize: 20 }}
                >
                  {formatMoney(Number(purchase.total))}
                </span>
              </div>
            </Card>
          )}
        </div>

        {/* Right side: action panel + lifecycle timeline */}
        <div className="po-detail-side">
          <Card>
            <h3 style={{ marginBottom: 12 }}>{t('po.timeline.label')}</h3>
            <StatusTimeline purchase={purchase} />
          </Card>

          <Card>
            <h3 style={{ marginBottom: 12 }}>{t('common.actions')}</h3>
            <div className="po-action-panel">
              {primary && (
                <Button
                  variant="primary"
                  loading={primary.key === 'send' ? sendM.isPending : false}
                  onClick={handlePrimaryAction}
                  disabled={
                    (primary.key === 'send' && items.length === 0) ||
                    (primary.key === 'dispatch' && items.length === 0) ||
                    (primary.key === 'verify' && !canVerify)
                  }
                >
                  {t(ACTION_LABEL_KEY[primary.key])}
                </Button>
              )}
              {primary?.key === 'verify' && !canVerify && (
                <small className="text-muted">
                  {t('common.managerOnly')}
                </small>
              )}
              {!terminal && (
                <>
                  {canReject && (
                    <Button variant="ghost" onClick={() => setModal('reject')}>
                      {t('po.action.reject')}
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => setModal('cancel')}>
                    {t('po.action.cancel')}
                  </Button>
                </>
              )}
            </div>
          </Card>

          {purchase.cash_movements && purchase.cash_movements.length > 0 && (
            <Card>
              <h3 style={{ marginBottom: 12 }}>{t('common.cashMovements')}</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {purchase.cash_movements.map((m) => (
                  <li
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 12,
                    }}
                  >
                    <span className="text-muted">
                      {m.type === 'CASH_OUT' ? '↘' : '↗'} {m.reason}
                    </span>
                    <span className={m.type === 'CASH_OUT' ? 'text-red' : 'text-green'}>
                      {m.type === 'CASH_OUT' ? '-' : '+'}
                      {formatMoney(Number(m.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* All transition modals — gated by `modal` state. They each handle
          their own mutation + cache invalidation via the hooks. */}
      {modal === 'reply' && (
        <ReplyModal open onClose={() => setModal(null)} purchase={purchase} />
      )}
      {modal === 'pay' && <PayModal open onClose={() => setModal(null)} purchase={purchase} />}
      {modal === 'inTransit' && (
        <InTransitModal open onClose={() => setModal(null)} purchase={purchase} />
      )}
      {modal === 'receive' && (
        <ReceiveModal open onClose={() => setModal(null)} purchase={purchase} />
      )}
      {modal === 'verify' && (
        <VerifyModal open onClose={() => setModal(null)} purchase={purchase} />
      )}
      {modal === 'dispatch' && (
        <DispatchModal open onClose={() => setModal(null)} purchase={purchase} />
      )}
      {modal === 'return' && (
        <ReturnModal open onClose={() => setModal(null)} purchase={purchase} />
      )}
      {modal === 'cancel' && (
        <CancelModal
          open
          onClose={() => setModal(null)}
          purchase={purchase}
          variant="cancel"
        />
      )}
      {modal === 'reject' && (
        <CancelModal
          open
          onClose={() => setModal(null)}
          purchase={purchase}
          variant="reject"
        />
      )}
    </>
  );
}
