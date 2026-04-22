import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useTaxes } from '../../hooks/useTaxes';
import type {
  Modifier,
  ModifierGroup,
  Product,
  ProductVariant,
} from '../../types/menu';
import type { OrderItem, OrderType, PaymentMethod } from '../../types/operations';
import {
  ORDER_TYPES,
  orderTypeLabel,
  paymentMethodLabel,
} from '../../types/operations';
import { formatMoney } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (orderId: string) => void;
}

type Step = 'register' | 'build' | 'pay' | 'done';

/** Unit/peso helpers — identical to the ones in OpenShiftModal. */
function pesosToCentavos(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function NewOrderModal({ open, onClose, onCreated }: Props) {
  const user = useAuthStore((s) => s.user);
  const currentRegisterQ = useCurrentUserRegister(user?.id);
  const register = currentRegisterQ.data ?? null;

  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('register');
  const [productPicker, setProductPicker] = useState<Product | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const createOrderM = useCreateOrder();

  // Ref guards the auto-create effect against React Strict Mode's double
  // invocation — otherwise we'd post POST /orders twice in dev and the second
  // (empty) order would stick around on the orders list.
  const createInitiatedRef = useRef(false);

  // Reset state whenever the modal is reopened.
  useEffect(() => {
    if (!open) return;
    setOrderType('DINE_IN');
    setOrderId(null);
    setStep(register ? 'build' : 'register');
    setProductPicker(null);
    setServerError(null);
    createInitiatedRef.current = false;
  }, [open, register]);

  // When we move from the register step into build, auto-create the order.
  useEffect(() => {
    if (!open || step !== 'build' || orderId || !register) return;
    if (createInitiatedRef.current) return;
    createInitiatedRef.current = true;
    (async () => {
      try {
        const order = await createOrderM.mutateAsync({
          register_id: register.id,
          order_type: orderType,
        });
        setOrderId(order.id);
      } catch (err) {
        setServerError(
          err instanceof Error ? err.message : 'Could not create order',
        );
        // Allow retry on next state change if the first attempt failed.
        createInitiatedRef.current = false;
      }
    })();
    // orderType is snapshot when entering build — changing it after doesn't
    // retroactively recreate the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, orderId, register?.id]);

  const title = (() => {
    switch (step) {
      case 'register': return 'Open a register to start an order';
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
        // Only allow overlay close on register / done steps — otherwise users
        // can lose unsaved items.
        if (step === 'register' || step === 'done') onClose();
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
              onOpened={() => setStep('build')}
              orderType={orderType}
              onOrderTypeChange={setOrderType}
            />
          )}

          {step === 'build' && !orderId && (
            <div className="loading-block">
              <span className="spinner" />
              Creating order…
            </div>
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
   Step 1 — register check / order type
   ───────────────────────────────────────────────────────────── */

interface RegisterStepProps {
  loading: boolean;
  orderType: OrderType;
  onOrderTypeChange: (t: OrderType) => void;
  onOpened: () => void;
}

function RegisterStep({
  loading,
  orderType,
  onOrderTypeChange,
  onOpened,
}: RegisterStepProps) {
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
    const centavos = pesosToCentavos(openingAmount);
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

        <div className="field">
          <label htmlFor="order-type">Order type</label>
          <select
            id="order-type"
            value={orderType}
            onChange={(e) => onOrderTypeChange(e.target.value as OrderType)}
          >
            {ORDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {orderTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="Opening amount (MXN)"
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
  const taxesQ = useTaxes({ active: true });

  // Tax rate as a decimal (e.g. 0.16 for 16%) keyed by tax_id. Missing tax_id
  // (null on the product) means tax-exempt → 0.
  const taxRateById = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of taxesQ.data ?? []) {
      m.set(t.id, Number(t.rate) / 100);
    }
    return m;
  }, [taxesQ.data]);

  const lineTax = (item: OrderItem): number => {
    const taxId = item.product?.tax_id ?? null;
    if (!taxId) return 0;
    const rate = taxRateById.get(taxId) ?? 0;
    return Math.round(Number(item.line_total) * rate);
  };

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
            const tax = lineTax(item);
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
                {tax > 0 && (
                  <div className="fs-11 text-muted mt-4">
                    + tax {formatMoney(tax)}
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
            <div className="tot-row">
              <span>Subtotal</span>
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

  const submit = async () => {
    setServerError(null);
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
          <Button variant="ghost" onClick={onClose} disabled={addItemM.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={addItemM.isPending}
            disabled={!validation.ok}
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
    const centavos = pesosToCentavos(tendered);
    if (centavos === null) return null;
    return Math.max(centavos - remaining, 0);
  }, [method, tendered, remaining]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    setServerError(null);

    let amount: number;
    if (method === 'CASH') {
      const c = pesosToCentavos(tendered);
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
            <div className="dk">Subtotal</div>
            <div className="dv">{formatMoney(Number(order.subtotal))}</div>
          </div>
          <div className="detail-cell">
            <div className="dk">Tax</div>
            <div className="dv">{formatMoney(Number(order.tax_amount))}</div>
          </div>
        </div>
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Total</div>
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
            label="Amount tendered (MXN)"
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
                    {formatMoney(pesosToCentavos(tendered) ?? 0)}
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
