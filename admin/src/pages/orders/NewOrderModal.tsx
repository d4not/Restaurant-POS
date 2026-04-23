import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { SearchInput } from '../../components/forms/SearchInput';
import { useAuthStore } from '../../store/auth';
import { useCurrentUserRegister, useOpenRegister } from '../../hooks/useRegisters';
import {
  useAddOrderItem,
  useAddPayment,
  useCreateOrder,
  useOrder,
  useRemoveOrderItem,
  useUpdateOrderItem,
} from '../../hooks/useOrders';
import { useProducts } from '../../hooks/useProducts';
import { useProduct } from '../../hooks/useProducts';
import { useModifierGroup } from '../../hooks/useModifierGroups';
import { useRecipe } from '../../hooks/useRecipes';
import { useTables } from '../../hooks/useTables';
import type {
  Modifier,
  ModifierGroup,
  Product,
  ProductVariant,
} from '../../types/menu';
import type { OrderType, PaymentMethod, Table } from '../../types/operations';
import {
  ORDER_TYPES,
  orderTypeLabel,
  paymentMethodLabel,
  tableStatusLabel,
} from '../../types/operations';
import { tableStatusTone } from '../staff/operations-meta';
import { amountToCentavos, formatMoney, moneyLabel } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (orderId: string) => void;
}

type Step = 'register' | 'setup' | 'build' | 'pay' | 'done';

export function NewOrderModal({ open, onClose, onCreated }: Props) {
  const user = useAuthStore((s) => s.user);
  const currentRegisterQ = useCurrentUserRegister(user?.id);
  const register = currentRegisterQ.data ?? null;

  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [tableId, setTableId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('register');
  const [productPicker, setProductPicker] = useState<Product | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const createOrderM = useCreateOrder();

  // Reset state whenever the modal is reopened. Skip 'register' if a shift is
  // already open — the user goes straight to setup (order type + table) before
  // we POST /orders.
  useEffect(() => {
    if (!open) return;
    setOrderType('DINE_IN');
    setTableId(null);
    setOrderId(null);
    setStep(register ? 'setup' : 'register');
    setProductPicker(null);
    setServerError(null);
  }, [open, register]);

  const startOrder = async (
    chosenType: OrderType,
    chosenTableId: string | null,
  ): Promise<void> => {
    if (!register) return;
    setServerError(null);
    try {
      const order = await createOrderM.mutateAsync({
        register_id: register.id,
        order_type: chosenType,
        table_id: chosenType === 'DINE_IN' ? chosenTableId : null,
      });
      setOrderId(order.id);
      setOrderType(chosenType);
      setTableId(chosenTableId);
      setStep('build');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not create order');
    }
  };

  const title = (() => {
    switch (step) {
      case 'register': return 'Open a register to start an order';
      case 'setup':    return 'New order · order type';
      case 'build':    return 'New order · add items';
      case 'pay':      return 'New order · payment';
      case 'done':     return 'Order complete';
    }
  })();

  if (!open) return null;

  return (
    <div
      className="modal-overlay open"
      onClick={() => {
        // Only allow overlay close on safe steps — otherwise users can lose
        // unsaved items.
        if (step === 'register' || step === 'setup' || step === 'done') onClose();
      }}
    >
      <div
        className="modal new-order-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body new-order-body">
          {serverError && (
            <div className="auth-alert" style={{ marginBottom: 12 }}>
              {serverError}
            </div>
          )}

          {step === 'register' && (
            <RegisterStep
              loading={currentRegisterQ.isLoading}
              onOpened={() => setStep('setup')}
            />
          )}

          {step === 'setup' && register && (
            <SetupStep
              defaultOrderType={orderType}
              defaultTableId={tableId}
              creating={createOrderM.isPending}
              onSubmit={startOrder}
            />
          )}

          {step === 'build' && orderId && (
            <BuildStep
              orderId={orderId}
              onProceed={() => setStep('pay')}
              onPickProduct={setProductPicker}
            />
          )}

          {step === 'pay' && orderId && (
            <PayStep
              orderId={orderId}
              onBack={() => setStep('build')}
              onComplete={() => {
                setStep('done');
                if (onCreated) onCreated(orderId);
              }}
            />
          )}

          {step === 'done' && orderId && (
            <DoneStep orderId={orderId} onClose={onClose} />
          )}
        </div>

        {productPicker && orderId && (
          <ProductPicker
            open={!!productPicker}
            orderId={orderId}
            product={productPicker}
            onClose={() => setProductPicker(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 1 — register check (only when no shift is open)
   ───────────────────────────────────────────────────────────── */

interface RegisterStepProps {
  loading: boolean;
  onOpened: () => void;
}

function RegisterStep({ loading, onOpened }: RegisterStepProps) {
  const [openingAmount, setOpeningAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const openM = useOpenRegister();

  if (loading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Checking register…
      </div>
    );
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    setOpenError(null);
    const centavos = amountToCentavos(openingAmount);
    if (centavos === null) {
      setFormError('Enter a non-negative amount (e.g. 500.00)');
      return;
    }
    try {
      await openM.mutateAsync({ opening_amount: centavos });
      onOpened();
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Could not open shift');
    }
  };

  return (
    <>
      <EmptyState
        icon="◈"
        message="You don't have an open cash register"
        sub="Open a shift with the starting drawer amount — orders can only be recorded while a register is open."
      />

      <form onSubmit={submit} style={{ maxWidth: 420, margin: '0 auto' }}>
        {openError && (
          <div className="auth-alert" style={{ marginBottom: 12 }}>
            {openError}
          </div>
        )}

        <Input
          label={moneyLabel('Opening amount')}
          name="opening_amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          autoFocus
          value={openingAmount}
          onChange={(e) => setOpeningAmount(e.target.value)}
          error={formError ?? undefined}
          placeholder="500.00"
        />

        <Button
          type="submit"
          variant="primary"
          block
          loading={openM.isPending}
        >
          Open shift & continue
        </Button>
      </form>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 2 — order setup: type + table picker (DINE_IN only)
   ───────────────────────────────────────────────────────────── */

interface SetupStepProps {
  defaultOrderType: OrderType;
  defaultTableId: string | null;
  creating: boolean;
  onSubmit: (orderType: OrderType, tableId: string | null) => void;
}

function SetupStep({
  defaultOrderType,
  defaultTableId,
  creating,
  onSubmit,
}: SetupStepProps) {
  const [orderType, setOrderType] = useState<OrderType>(defaultOrderType);
  const [tableId, setTableId] = useState<string | null>(defaultTableId);

  // Drop the table assignment if the user flips to TAKEOUT — backend rejects
  // the combination, and we don't want a stale tile lighting up if they flip
  // back without re-picking.
  const onTypeChange = (t: OrderType) => {
    setOrderType(t);
    if (t !== 'DINE_IN') setTableId(null);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="picker-section">
        <div className="picker-section-title">Order type</div>
        <div className="picker-options">
          {ORDER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={`picker-option${orderType === t ? ' is-selected' : ''}`}
              onClick={() => onTypeChange(t)}
            >
              <span className="picker-option-name">{orderTypeLabel(t)}</span>
            </button>
          ))}
        </div>
      </div>

      {orderType === 'DINE_IN' && (
        <TablePicker selectedId={tableId} onSelect={setTableId} />
      )}

      <div style={{ marginTop: 20 }}>
        <Button
          variant="primary"
          block
          size="lg"
          loading={creating}
          onClick={() => onSubmit(orderType, tableId)}
        >
          {orderType === 'DINE_IN' && tableId
            ? 'Start order at this table'
            : orderType === 'DINE_IN'
              ? 'Start order without a table'
              : 'Start takeout order'}
        </Button>
      </div>
    </div>
  );
}

/* Visual table picker grouped by zone. Available tables are the primary
 * action; OCCUPIED tables remain clickable (group ordering is allowed and
 * common — second ticket for the same table) but show their badge so the
 * cashier knows what they're joining. */
interface TablePickerProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function TablePicker({ selectedId, onSelect }: TablePickerProps) {
  const tablesQ = useTables({ active: true });
  const tables = useMemo<Table[]>(
    () => tablesQ.data?.items ?? [],
    [tablesQ.data],
  );

  // Group by zone. Backend already orders by zone display_order then number,
  // so iteration preserves that.
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; order: number; items: Table[] }>();
    for (const t of tables) {
      const key = t.zone?.id ?? t.zone_id;
      const name = t.zone?.name ?? 'Unknown zone';
      const order = t.zone?.display_order ?? 0;
      const bucket = map.get(key);
      if (bucket) bucket.items.push(t);
      else map.set(key, { name, order, items: [t] });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.name.localeCompare(b.name);
    });
  }, [tables]);

  if (tablesQ.isLoading) {
    return (
      <div className="picker-section">
        <div className="loading-block">
          <span className="spinner" />
          Loading tables…
        </div>
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="picker-section">
        <EmptyState
          message="No tables configured"
          sub="Add zones and tables in System → Tables & Zones, or skip table assignment."
        />
      </div>
    );
  }

  return (
    <div className="picker-section">
      <div className="picker-section-title">
        Pick a table{' '}
        <span className="text-muted fs-11 fw-600">
          Optional — you can leave it blank and seat the order later
        </span>
      </div>

      {groups.map((g) => (
        <div key={g.name} className="product-group">
          <div className="product-group-header">{g.name}</div>
          <div className="table-tile-grid">
            {g.items.map((t) => (
              <TableTile
                key={t.id}
                table={t}
                selected={selectedId === t.id}
                onClick={() =>
                  onSelect(selectedId === t.id ? null : t.id)
                }
              />
            ))}
          </div>
        </div>
      ))}

      <div className="fs-11 text-muted mt-8">
        {selectedId
          ? 'Click the highlighted tile again to clear the selection.'
          : 'Tip: occupied tables can still receive a second ticket for group orders.'}
      </div>
    </div>
  );
}

function TableTile({
  table,
  selected,
  onClick,
}: {
  table: Table;
  selected: boolean;
  onClick: () => void;
}) {
  const showBadge = table.status !== 'AVAILABLE';
  return (
    <button
      type="button"
      className={`table-tile${selected ? ' is-selected' : ''} table-tile-${table.status.toLowerCase()}`}
      onClick={onClick}
    >
      <span className="table-tile-number">#{table.number}</span>
      <span className="table-tile-meta">
        {table.capacity} seat{table.capacity === 1 ? '' : 's'}
      </span>
      {showBadge && (
        <Badge tone={tableStatusTone(table.status)} className="table-tile-badge">
          {tableStatusLabel(table.status)}
        </Badge>
      )}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 2 — build: product picker + cart side-by-side
   ───────────────────────────────────────────────────────────── */

interface BuildStepProps {
  orderId: string;
  onPickProduct: (p: Product | null) => void;
  onProceed: () => void;
}

function BuildStep({ orderId, onPickProduct, onProceed }: BuildStepProps) {
  const orderQ = useOrder(orderId);
  const order = orderQ.data;

  const [search, setSearch] = useState('');
  const productsQ = useProducts({
    active: true,
    search: search || undefined,
  });
  const products = useMemo<Product[]>(
    () => productsQ.data?.pages.flatMap((p) => p.items) ?? [],
    [productsQ.data],
  );

  // Preparations can't be sold — filter them out on the client so the picker
  // doesn't mislead the cashier.
  const sellable = useMemo(
    () => products.filter((p) => p.type !== 'PREPARATION'),
    [products],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; items: Product[] }>();
    for (const p of sellable) {
      const key = p.category?.id ?? 'uncategorized';
      const name = p.category?.name ?? 'Uncategorized';
      const bucket = map.get(key);
      if (bucket) bucket.items.push(p);
      else map.set(key, { name, items: [p] });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sellable]);

  const removeItemM = useRemoveOrderItem();
  const updateItemM = useUpdateOrderItem();

  const canProceed = (order?.items?.length ?? 0) > 0;

  return (
    <div className="new-order-grid">
      {/* LEFT — product picker */}
      <div className="new-order-picker">
        <div className="mb-12">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search products by name…"
          />
        </div>

        {productsQ.isLoading && (
          <div className="loading-block">
            <span className="spinner" />
            Loading products…
          </div>
        )}

        {!productsQ.isLoading && sellable.length === 0 && (
          <EmptyState
            message="No products match"
            sub={search ? 'Try a different search term.' : 'No active products in the menu.'}
          />
        )}

        {grouped.map((group) => (
          <div key={group.name} className="product-group">
            <div className="product-group-header">{group.name}</div>
            <div className="product-grid">
              {group.items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="product-tile"
                  onClick={() => onPickProduct(p)}
                >
                  <span className="product-tile-name">{p.name}</span>
                  <span className="product-tile-meta">
                    <ProductPrice product={p} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* RIGHT — cart */}
      <div className="new-order-cart">
        <div className="new-order-cart-header">
          <div>
            <h3 style={{ marginBottom: 2 }}>Order cart</h3>
            {order && (
              <div className="fs-11 text-muted">
                {order.items?.length ?? 0} items · <Badge tone="gold">OPEN</Badge>
              </div>
            )}
            {order?.table && (
              <div className="fs-12 mt-4">
                <span className="text-muted">Seated at </span>
                <span className="fw-600">
                  {order.table.zone.name} · Table {order.table.number}
                </span>
                <span className="text-muted"> ({order.table.capacity} seats)</span>
              </div>
            )}
          </div>
        </div>

        <div className="new-order-cart-items">
          {!order?.items?.length && (
            <div className="empty-state" style={{ padding: '32px 10px' }}>
              <div className="icon">·</div>
              <div className="msg">No items yet</div>
              <div className="sub">Tap a product on the left to add it.</div>
            </div>
          )}

          {order?.items?.map((item) => {
            // Under tax-inclusive pricing, line_total IS what the customer
            // pays — the line doesn't need to call out "+ tax" since tax is
            // already in the number. The breakdown lives in the totals row.
            const taxRate = Number(item.tax_rate ?? 0);
            return (
            <div key={item.id} className="cart-line">
              <div className="cart-line-main">
                <div className="fw-600 fs-13">
                  {item.product?.name ?? 'Deleted product'}
                  {item.variant?.name && (
                    <span className="text-muted fw-600"> · {item.variant.name}</span>
                  )}
                </div>
                {item.modifiers && item.modifiers.length > 0 && (
                  <div className="fs-11 text-muted mt-4">
                    {item.modifiers.map((m) => m.name).join(' · ')}
                  </div>
                )}
                {taxRate > 0 && (
                  <div className="fs-11 text-muted mt-4">
                    incl. tax {taxRate}%
                  </div>
                )}
              </div>

              <div className="cart-line-actions">
                <div className="qty-stepper">
                  <button
                    type="button"
                    className="qty-btn"
                    aria-label="Decrease quantity"
                    disabled={item.quantity <= 1 || updateItemM.isPending}
                    onClick={() =>
                      updateItemM.mutate({
                        orderId,
                        itemId: item.id,
                        input: { quantity: item.quantity - 1 },
                      })
                    }
                  >
                    −
                  </button>
                  <span className="qty-val">{item.quantity}</span>
                  <button
                    type="button"
                    className="qty-btn"
                    aria-label="Increase quantity"
                    disabled={updateItemM.isPending}
                    onClick={() =>
                      updateItemM.mutate({
                        orderId,
                        itemId: item.id,
                        input: { quantity: item.quantity + 1 },
                      })
                    }
                  >
                    +
                  </button>
                </div>
                <div className="fw-600 fs-13" style={{ minWidth: 72, textAlign: 'right' }}>
                  {formatMoney(Number(item.line_total))}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  aria-label="Remove line"
                  title="Remove line"
                  disabled={removeItemM.isPending}
                  onClick={() =>
                    removeItemM.mutate({ orderId, itemId: item.id })
                  }
                >
                  ✕
                </button>
              </div>
            </div>
            );
          })}
        </div>

        {order && (
          <div className="new-order-cart-totals">
            {/* Prices include tax — subtotal is revenue before tax, tax is the
                portion extracted from total. Subtotal + Tax = Total. */}
            <div className="tot-row">
              <span>Subtotal (before tax)</span>
              <span>{formatMoney(Number(order.subtotal))}</span>
            </div>
            <div className="tot-row">
              <span>Tax</span>
              <span>{formatMoney(Number(order.tax_amount))}</span>
            </div>
            <div className="tot-row tot-row-total">
              <span>Total</span>
              <span className="text-gold">{formatMoney(Number(order.total))}</span>
            </div>

            <Button
              block
              variant="primary"
              size="lg"
              disabled={!canProceed}
              onClick={onProceed}
            >
              Proceed to payment
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductPrice({ product }: { product: Product }) {
  if (product.variants && product.variants.length > 0) {
    const prices = product.variants.map((v) => Number(v.sell_price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return <>{formatMoney(min)}</>;
    return <>{formatMoney(min)} – {formatMoney(max)}</>;
  }
  return <>{product.sell_price ? formatMoney(Number(product.sell_price)) : '—'}</>;
}

/* ─────────────────────────────────────────────────────────────
   Product picker — inline nested modal, drives variant + modifier
   selection, then calls addOrderItem.
   ───────────────────────────────────────────────────────────── */

interface ProductPickerProps {
  open: boolean;
  orderId: string;
  product: Product;
  onClose: () => void;
}

function ProductPicker({ open, orderId, product, onClose }: ProductPickerProps) {
  // We fetch the full product fresh to get variants + attached modifier_groups.
  const fullQ = useProduct(product.id);
  const full = fullQ.data ?? product;

  const [variantId, setVariantId] = useState<string | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [serverError, setServerError] = useState<string | null>(null);

  const addItemM = useAddOrderItem();

  // DISH lines deduct inventory from a recipe at payment time — an item
  // without a recipe would crash the close-flow with "Variant X has no recipe".
  // Preflight the recipe here so the cashier gets an actionable message
  // instead of the raw backend error. PRODUCT lines skip this check entirely.
  const recipeOwner =
    full.type === 'DISH'
      ? variantId
        ? ({ kind: 'variant', id: variantId } as const)
        : (full.variants ?? []).length === 0
          ? ({ kind: 'product', id: full.id } as const)
          : undefined
      : undefined;
  const recipeQ = useRecipe(recipeOwner);
  const recipeLoading = !!recipeOwner && recipeQ.isLoading;
  const recipeMissing =
    !!recipeOwner && !recipeQ.isLoading && recipeQ.data == null;

  const variantLabel = variantId
    ? (full.variants ?? []).find((v) => v.id === variantId)?.name ?? null
    : null;

  useEffect(() => {
    if (!open) return;
    setVariantId(null);
    setSelectedModifiers({});
    setQty(1);
    setServerError(null);
  }, [open, product.id]);

  // Auto-pick the first variant once the full product loads — the user can
  // still change it, but the default matches what most cafés do at the POS.
  useEffect(() => {
    if (!open) return;
    if (!full.variants || full.variants.length === 0) {
      setVariantId(null);
      return;
    }
    const firstActive = full.variants.find((v) => v.active);
    if (firstActive && !variantId) setVariantId(firstActive.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, full.variants]);

  const activeVariants = useMemo(
    () => (full.variants ?? []).filter((v) => v.active),
    [full.variants],
  );

  const displayPrice = useMemo(() => {
    if (variantId) {
      const v = activeVariants.find((x) => x.id === variantId);
      return v ? Number(v.sell_price) : 0;
    }
    return full.sell_price ? Number(full.sell_price) : 0;
  }, [variantId, activeVariants, full.sell_price]);

  const modifierGroupIds = useMemo(
    () => (full.modifier_groups ?? []).map((g) => g.modifier_group_id),
    [full.modifier_groups],
  );

  const onToggleModifier = (groupId: string, modifierId: string, group: ModifierGroup) => {
    setSelectedModifiers((prev) => {
      const cur = prev[groupId] ?? [];
      const has = cur.includes(modifierId);
      if (has) {
        return { ...prev, [groupId]: cur.filter((id) => id !== modifierId) };
      }
      // Enforce max_selection: when picking-one (max=1) replace; otherwise push.
      if (group.max_selection <= 1) {
        return { ...prev, [groupId]: [modifierId] };
      }
      if (cur.length >= group.max_selection) {
        return prev;
      }
      return { ...prev, [groupId]: [...cur, modifierId] };
    });
  };

  const allModifiers = Object.values(selectedModifiers).flat();

  const missingRecipeMessage = recipeMissing
    ? variantLabel
      ? `Cannot add ${full.name} — ${variantLabel}: no recipe configured. Please add a recipe in Menu > Products.`
      : `Cannot add ${full.name}: no recipe configured. Please add a recipe in Menu > Products.`
    : null;

  const submit = async () => {
    setServerError(null);
    // Defense in depth — the button is disabled when the recipe is missing,
    // but a quick double-click shouldn't bypass the check.
    if (missingRecipeMessage) {
      setServerError(missingRecipeMessage);
      return;
    }
    try {
      await addItemM.mutateAsync({
        orderId,
        input: {
          product_id: product.id,
          variant_id: variantId ?? undefined,
          quantity: qty,
          modifier_ids: allModifiers,
        },
      });
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not add item');
    }
  };

  // Validate required groups before enabling the submit button.
  const validation = useMemo(() => {
    if ((full.variants ?? []).length > 0 && !variantId) {
      return { ok: false, reason: 'Pick a size first' };
    }
    for (const link of full.modifier_groups ?? []) {
      const group = link.modifier_group;
      const picked = selectedModifiers[group.id] ?? [];
      if (group.required && picked.length < Math.max(group.min_selection, 1)) {
        return { ok: false, reason: `Pick ${group.name}` };
      }
      if (picked.length < group.min_selection) {
        return { ok: false, reason: `Pick at least ${group.min_selection} ${group.name}` };
      }
    }
    return { ok: true, reason: '' };
  }, [full.variants, full.modifier_groups, variantId, selectedModifiers]);

  return (
    <div
      className="modal-overlay open"
      style={{ zIndex: 500 }}
      onClick={onClose}
    >
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>
            {full.name}
            <span className="text-muted fs-12 fw-600" style={{ marginLeft: 8 }}>
              {formatMoney(displayPrice)}
            </span>
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          {fullQ.isLoading && !full && (
            <div className="loading-block">
              <span className="spinner" />
              Loading…
            </div>
          )}

          {serverError && (
            <div className="auth-alert" style={{ marginBottom: 12 }}>
              {serverError}
            </div>
          )}

          {missingRecipeMessage && !serverError && (
            <div className="auth-alert" style={{ marginBottom: 12 }}>
              {missingRecipeMessage}
            </div>
          )}

          {activeVariants.length > 0 && (
            <div className="picker-section">
              <div className="picker-section-title">Size</div>
              <div className="picker-options">
                {activeVariants.map((v) => (
                  <VariantOption
                    key={v.id}
                    variant={v}
                    selected={variantId === v.id}
                    onClick={() => setVariantId(v.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {modifierGroupIds.map((gid) => (
            <ModifierGroupSection
              key={gid}
              groupId={gid}
              selected={selectedModifiers[gid] ?? []}
              onToggle={(mid, grp) => onToggleModifier(gid, mid, grp)}
            />
          ))}

          <div className="picker-section">
            <div className="picker-section-title">Quantity</div>
            <div className="qty-stepper" style={{ width: 140 }}>
              <button
                type="button"
                className="qty-btn"
                aria-label="Decrease"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
              >
                −
              </button>
              <span className="qty-val">{qty}</span>
              <button
                type="button"
                className="qty-btn"
                aria-label="Increase"
                onClick={() => setQty((q) => q + 1)}
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          {!validation.ok && (
            <span className="text-muted fs-12" style={{ marginRight: 'auto' }}>
              {validation.reason}
            </span>
          )}
          {validation.ok && recipeLoading && (
            <span className="text-muted fs-12" style={{ marginRight: 'auto' }}>
              Checking recipe…
            </span>
          )}
          <Button variant="ghost" onClick={onClose} disabled={addItemM.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={addItemM.isPending}
            disabled={!validation.ok || recipeLoading || recipeMissing}
            onClick={submit}
          >
            Add to order
          </Button>
        </div>
      </div>
    </div>
  );
}

function VariantOption({
  variant,
  selected,
  onClick,
}: {
  variant: ProductVariant;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`picker-option${selected ? ' is-selected' : ''}`}
      onClick={onClick}
    >
      <span className="picker-option-name">{variant.name}</span>
      <span className="picker-option-price">
        {formatMoney(Number(variant.sell_price))}
      </span>
    </button>
  );
}

function ModifierGroupSection({
  groupId,
  selected,
  onToggle,
}: {
  groupId: string;
  selected: string[];
  onToggle: (modifierId: string, group: ModifierGroup) => void;
}) {
  const q = useModifierGroup(groupId);
  const group = q.data;

  if (q.isLoading || !group) {
    return (
      <div className="picker-section">
        <div className="loading-block" style={{ padding: 12 }}>
          <span className="spinner" />
          Loading options…
        </div>
      </div>
    );
  }

  const active = (group.modifiers ?? []).filter((m) => m.active);
  if (active.length === 0) return null;

  const pickHint = (() => {
    if (group.required) return `Pick ${group.min_selection > 1 ? group.min_selection : 'one'}`;
    if (group.max_selection === 1) return 'Pick one (optional)';
    if (group.max_selection > 1) return `Pick up to ${group.max_selection}`;
    return 'Optional';
  })();

  return (
    <div className="picker-section">
      <div className="picker-section-title">
        {group.name}{' '}
        <span className="text-muted fs-11 fw-600">{pickHint}</span>
      </div>
      <div className="picker-options">
        {active.map((m) => (
          <ModifierOption
            key={m.id}
            modifier={m}
            selected={selected.includes(m.id)}
            onClick={() => onToggle(m.id, group)}
          />
        ))}
      </div>
    </div>
  );
}

function ModifierOption({
  modifier,
  selected,
  onClick,
}: {
  modifier: Modifier;
  selected: boolean;
  onClick: () => void;
}) {
  const extra = Number(modifier.extra_price);
  return (
    <button
      type="button"
      className={`picker-option${selected ? ' is-selected' : ''}`}
      onClick={onClick}
    >
      <span className="picker-option-name">{modifier.name}</span>
      <span className="picker-option-price">
        {extra > 0 ? `+${formatMoney(extra)}` : '—'}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 3 — pay
   ───────────────────────────────────────────────────────────── */

interface PayStepProps {
  orderId: string;
  onBack: () => void;
  onComplete: () => void;
}

function PayStep({ orderId, onBack, onComplete }: PayStepProps) {
  const orderQ = useOrder(orderId);
  const order = orderQ.data;

  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const addPayM = useAddPayment();

  const total = Number(order?.total ?? 0);
  const paid = (order?.payments ?? []).reduce(
    (sum, p) => sum + Number(p.amount) - Number(p.change_amount),
    0,
  );
  const remaining = Math.max(total - paid, 0);

  // Cash-only: auto-calculate change as the user types.
  const changePreview = useMemo(() => {
    if (method !== 'CASH') return null;
    const centavos = amountToCentavos(tendered);
    if (centavos === null) return null;
    return Math.max(centavos - remaining, 0);
  }, [method, tendered, remaining]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    setServerError(null);

    let amount: number;
    if (method === 'CASH') {
      const c = amountToCentavos(tendered);
      if (c === null) {
        setFormError('Enter the cash amount the customer handed you');
        return;
      }
      if (c < remaining) {
        setFormError(`Cash must cover the remaining ${formatMoney(remaining)}`);
        return;
      }
      amount = c;
    } else {
      amount = remaining;
    }

    try {
      await addPayM.mutateAsync({
        orderId,
        input: {
          method,
          amount,
          reference: reference.trim() || undefined,
        },
      });
      onComplete();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not record payment');
    }
  };

  if (orderQ.isLoading || !order) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading order…
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 520, margin: '0 auto' }}>
      {serverError && (
        <div className="auth-alert" style={{ marginBottom: 12 }}>
          {serverError}
        </div>
      )}

      <div className="detail-grid mb-16">
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Subtotal (before tax)</div>
            <div className="dv">{formatMoney(Number(order.subtotal))}</div>
          </div>
          <div className="detail-cell">
            <div className="dk">Tax</div>
            <div className="dv">{formatMoney(Number(order.tax_amount))}</div>
          </div>
        </div>
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Total (customer pays)</div>
            <div className="dv gold">{formatMoney(total)}</div>
          </div>
          <div className="detail-cell">
            <div className="dk">Remaining</div>
            <div className="dv gold">{formatMoney(remaining)}</div>
          </div>
        </div>
      </div>

      <div className="picker-section">
        <div className="picker-section-title">Payment method</div>
        <div className="picker-options">
          {(['CASH', 'CARD', 'TRANSFER'] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`picker-option${method === m ? ' is-selected' : ''}`}
              onClick={() => {
                setMethod(m);
                setFormError(null);
                if (m !== 'CASH') setTendered('');
              }}
            >
              <span className="picker-option-name">{paymentMethodLabel(m)}</span>
            </button>
          ))}
        </div>
      </div>

      {method === 'CASH' ? (
        <>
          <Input
            label={moneyLabel('Amount tendered')}
            name="tendered"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={tendered}
            onChange={(e) => setTendered(e.target.value)}
            autoFocus
            placeholder={(remaining / 100).toFixed(2)}
            error={formError ?? undefined}
          />
          {changePreview !== null && (
            <div className="detail-grid mb-16">
              <div className="detail-row cols-2">
                <div className="detail-cell">
                  <div className="dk">Tendered</div>
                  <div className="dv">
                    {formatMoney(amountToCentavos(tendered) ?? 0)}
                  </div>
                </div>
                <div className="detail-cell">
                  <div className="dk">Change</div>
                  <div className="dv green">{formatMoney(changePreview)}</div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="fs-12 text-muted mb-12">
            {paymentMethodLabel(method)} payments must equal the remaining
            balance exactly. The full {formatMoney(remaining)} will be charged.
          </p>
          <Input
            label="Reference (optional)"
            name="reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Transaction ID / authorization code"
          />
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={addPayM.isPending}
        >
          Back
        </Button>
        <Button
          type="submit"
          variant="primary"
          block
          loading={addPayM.isPending}
        >
          Complete order
        </Button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 4 — success
   ───────────────────────────────────────────────────────────── */

function DoneStep({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const orderQ = useOrder(orderId);
  const order = orderQ.data;

  if (orderQ.isLoading || !order) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading order…
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '24px 16px' }}>
      <div style={{ fontSize: 42, color: 'var(--green)', marginBottom: 12 }}>
        ✓
      </div>
      <h3 style={{ fontSize: 18, marginBottom: 6 }}>
        Order #{order.order_number} completed
      </h3>
      <p className="fs-12 text-muted mb-16">
        Total charged: {formatMoney(Number(order.total))}
      </p>
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
