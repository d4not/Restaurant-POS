import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCategories, getProducts } from '../api/products';
import {
  addOrderItem,
  cancelOrder,
  clearOrderAttention,
  flagOrderAttention,
  getOrder,
  removeOrderItem,
  sendOrderToKitchen,
  updateOrderItem,
} from '../api/orders';
import {
  ROLE_CAN_CANCEL,
  ROLE_CAN_WRITE_ORDER,
  defaultPathForRole,
  useSessionStore,
} from '../store/session';
import { useToastStore } from '../store/toast';
import { ApiError } from '../api/client';
import { ProductGrid } from '../components/order/ProductGrid';
import { CartPanel } from '../components/order/CartPanel';
import { VariantPicker } from '../components/order/VariantPicker';
import { ModifierPicker } from '../components/order/ModifierPicker';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { RequestEditDialog } from '../components/order/RequestEditDialog';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import type {
  ActiveOrder,
  Product,
  ProductVariant,
  SendToKitchenResult,
} from '../types/api';

type PickerState =
  | { kind: 'none' }
  | { kind: 'variant'; product: Product }
  | { kind: 'modifier'; product: Product; variant: ProductVariant | null };

export function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const pushToast = useToastStore((s) => s.push);

  const [picker, setPicker] = useState<PickerState>({ kind: 'none' });
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);
  const [requestEditOpen, setRequestEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Escape on the order screen → back to the role's default list, BUT only
  // when no dialog/picker is open (those swallow Escape first to close
  // themselves). Hook is unconditional so it doesn't fall foul of React's
  // rules; handler is null when a picker is open.
  const anyPickerOpen =
    picker.kind !== 'none' || requestEditOpen || cancelOpen;
  useKeyboardShortcut(
    'Escape',
    anyPickerOpen
      ? null
      : () => {
          if (user) navigate(defaultPathForRole(user.role));
        },
  );

  const orderQuery = useQuery({
    queryKey: ['orders', id],
    queryFn: () => getOrder(id!),
    enabled: Boolean(id),
    // Refetch every 10s so a second terminal's edits (cashier adds/removes
    // an item on the same order) show up without manual refresh.
    refetchInterval: 10_000,
  });

  const productsQuery = useQuery({
    queryKey: ['products', 'pos'],
    queryFn: getProducts,
    staleTime: 60_000,
  });
  const categoriesQuery = useQuery({
    queryKey: ['product-categories', 'pos'],
    queryFn: getCategories,
    staleTime: 60_000,
  });

  // Invalidate the order cache AND any list views so the floor plan / orders
  // list pick up the change without a manual reload. Accepts a function that
  // performs the API call so the mutation shape is uniform across add /
  // increment / decrement / remove.
  function invalidateAllViews() {
    queryClient.invalidateQueries({ queryKey: ['floors'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  }

  const addItemMutation = useMutation({
    mutationFn: (payload: {
      product_id: string;
      variant_id: string | null;
      modifier_ids: string[];
    }) => addOrderItem(id!, payload),
    onSuccess: (order) => {
      queryClient.setQueryData(['orders', id], order);
      invalidateAllViews();
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not add item';
      pushToast(message, 'error');
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: (payload: { itemId: string; quantity: number }) =>
      updateOrderItem(id!, payload.itemId, { quantity: payload.quantity }),
    onMutate: (payload) => setMutatingItemId(payload.itemId),
    onSettled: () => setMutatingItemId(null),
    onSuccess: (order) => {
      queryClient.setQueryData(['orders', id], order);
      invalidateAllViews();
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not update item';
      pushToast(message, 'error');
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeOrderItem(id!, itemId),
    onMutate: (itemId) => setMutatingItemId(itemId),
    onSettled: () => setMutatingItemId(null),
    onSuccess: (order) => {
      queryClient.setQueryData(['orders', id], order);
      invalidateAllViews();
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not remove item';
      pushToast(message, 'error');
    },
  });

  const sendToKitchenMutation = useMutation({
    mutationFn: () => sendOrderToKitchen(id!),
    onSuccess: async (result: SendToKitchenResult) => {
      queryClient.setQueryData(['orders', id], result.order);
      invalidateAllViews();

      if (result.items.length === 0) {
        pushToast('No new items to send', 'info');
        return;
      }

      // Hand off to the Electron printer bridge. If we're running outside
      // Electron (e.g. in a browser for UI testing) skip the print call and
      // just surface success — the items are marked sent either way.
      const printed = await printKitchenTicket(result);
      if (printed.ok) {
        pushToast(`Sent ${result.items.length} item(s) to kitchen`, 'success');
      } else {
        pushToast(`Marked sent but print failed: ${printed.message ?? 'unknown error'}`, 'error');
      }
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Could not send to kitchen';
      pushToast(message, 'error');
    },
  });

  const flagAttentionMutation = useMutation({
    mutationFn: (reason: string | null) => flagOrderAttention(id!, reason),
    onSuccess: (order) => {
      queryClient.setQueryData(['orders', id], order);
      invalidateAllViews();
      pushToast('Cashier has been notified', 'success');
      setRequestEditOpen(false);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Could not notify cashier';
      pushToast(msg, 'error');
    },
  });

  const clearAttentionMutation = useMutation({
    mutationFn: () => clearOrderAttention(id!),
    onSuccess: (order) => {
      queryClient.setQueryData(['orders', id], order);
      invalidateAllViews();
      pushToast('Request marked resolved', 'success');
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Could not clear request';
      pushToast(msg, 'error');
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: () => cancelOrder(id!),
    onSuccess: () => {
      invalidateAllViews();
      pushToast('Order cancelled', 'info');
      setCancelOpen(false);
      if (user) navigate(defaultPathForRole(user.role));
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Could not cancel order';
      pushToast(msg, 'error');
    },
  });

  // ── Product → variant → modifier flow ────────────────────────────────
  function onPickProduct(product: Product) {
    const activeVariants = product.variants.filter((v) => v.active);
    if (activeVariants.length > 0) {
      // If the product has variants, always force a variant pick first even
      // for a single size — the single-size case is rare and explicit picks
      // keep the UX consistent.
      setPicker({ kind: 'variant', product });
      return;
    }
    // No variants. Skip straight to modifiers if any, otherwise add immediately.
    if (product.modifier_groups.length > 0) {
      setPicker({ kind: 'modifier', product, variant: null });
      return;
    }
    addItemMutation.mutate({
      product_id: product.id,
      variant_id: null,
      modifier_ids: [],
    });
  }

  function onPickVariant(variant: ProductVariant) {
    if (picker.kind !== 'variant') return;
    const product = picker.product;
    if (product.modifier_groups.length > 0) {
      setPicker({ kind: 'modifier', product, variant });
    } else {
      addItemMutation.mutate({
        product_id: product.id,
        variant_id: variant.id,
        modifier_ids: [],
      });
      setPicker({ kind: 'none' });
    }
  }

  function onModifiersChosen(modifierIds: string[]) {
    if (picker.kind !== 'modifier') return;
    const { product, variant } = picker;
    addItemMutation.mutate({
      product_id: product.id,
      variant_id: variant?.id ?? null,
      modifier_ids: modifierIds,
    });
    setPicker({ kind: 'none' });
  }

  // ── Loading / error states ───────────────────────────────────────────
  if (!user) return null;
  if (orderQuery.isLoading) {
    return (
      <div className="empty">
        <div className="title">Loading order…</div>
      </div>
    );
  }
  if (orderQuery.error || !orderQuery.data) {
    return (
      <div className="empty">
        <div className="icon">!</div>
        <div className="title">Could not load order</div>
        <div>{(orderQuery.error as Error | undefined)?.message ?? 'Order not found'}</div>
        <button
          type="button"
          className="btn btn-ghost btn-lg"
          onClick={() => navigate(defaultPathForRole(user.role))}
        >
          Back
        </button>
      </div>
    );
  }

  const order: ActiveOrder = orderQuery.data;
  const canWrite = ROLE_CAN_WRITE_ORDER.includes(user.role);
  const canCancel = ROLE_CAN_CANCEL.includes(user.role);

  return (
    <div className="order-page">
      <section className="order-main">
        {canWrite ? (
          <ProductGrid
            products={productsQuery.data ?? []}
            categories={categoriesQuery.data ?? []}
            onPickProduct={onPickProduct}
          />
        ) : (
          <div className="empty">
            <div className="icon">👁</div>
            <div className="title">Read-only view</div>
            <div>Your role can view this order but not modify it.</div>
          </div>
        )}
      </section>

      <aside className="order-side">
        <CartPanel
          order={order}
          role={user.role}
          mutatingItemId={mutatingItemId}
          sendingToKitchen={sendToKitchenMutation.isPending}
          requestEditBusy={flagAttentionMutation.isPending}
          clearAttentionBusy={clearAttentionMutation.isPending}
          onIncrement={(it) =>
            updateItemMutation.mutate({ itemId: it.id, quantity: it.quantity + 1 })
          }
          onDecrement={(it) =>
            updateItemMutation.mutate({ itemId: it.id, quantity: Math.max(1, it.quantity - 1) })
          }
          onRemove={(it) => removeItemMutation.mutate(it.id)}
          onSendToKitchen={() => sendToKitchenMutation.mutate()}
          onPay={() => navigate(`/orders/${order.id}/pay`)}
          onHold={() => navigate(defaultPathForRole(user.role))}
          onRequestEdit={() => setRequestEditOpen(true)}
          onClearAttention={() => clearAttentionMutation.mutate()}
        />
        {canCancel && order.items.length > 0 && (
          <div className="cart-footer-extras">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setCancelOpen(true)}
            >
              Cancel order
            </button>
          </div>
        )}
      </aside>

      {picker.kind === 'variant' && (
        <VariantPicker
          product={picker.product}
          onPick={onPickVariant}
          onCancel={() => setPicker({ kind: 'none' })}
        />
      )}
      {picker.kind === 'modifier' && (
        <ModifierPicker
          product={picker.product}
          variant={picker.variant}
          onAdd={onModifiersChosen}
          onCancel={() => setPicker({ kind: 'none' })}
        />
      )}

      <RequestEditDialog
        open={requestEditOpen}
        busy={flagAttentionMutation.isPending}
        onSubmit={(reason) => flagAttentionMutation.mutate(reason)}
        onCancel={() => setRequestEditOpen(false)}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this order?"
        message={
          `Order #${order.order_number} will be cancelled. Items already sent to the ` +
          `kitchen will NOT be reversed automatically — make sure to tell the kitchen.`
        }
        confirmLabel="Yes, cancel"
        cancelLabel="Keep order"
        tone="danger"
        busy={cancelOrderMutation.isPending}
        onConfirm={() => cancelOrderMutation.mutate()}
        onCancel={() => setCancelOpen(false)}
      />
    </div>
  );
}

// Hand a comanda to the Electron main process for printing. Returns a uniform
// { ok, message? } shape whether Electron is present, missing, or the
// printer itself errors, so the mutation's onSuccess handler can always
// produce a user-visible toast.
async function printKitchenTicket(
  result: SendToKitchenResult,
): Promise<{ ok: boolean; message?: string }> {
  if (!window.electron) {
    return { ok: false, message: 'Running outside Electron — nothing printed' };
  }
  const order = result.order;
  // `result.items` is exactly the lines marked sent by this call. If the order
  // contains MORE sent items than we just marked, earlier sends already went
  // to the kitchen — stamp the ticket as additive so the line knows to add to
  // an existing ticket rather than restart the dish.
  const totalSent = order.items.filter((it) => it.sent_to_kitchen).length;
  const isAddition = totalSent > result.items.length;
  try {
    const payload = {
      order_number: order.order_number,
      printed_at: result.printed_at,
      waiter: order.user?.name ?? '—',
      table: order.table
        ? { zone: order.table.zone.name, number: order.table.number }
        : null,
      order_type: order.order_type,
      items: result.items.map((i) => ({
        quantity: i.quantity,
        product: i.product.name,
        variant: i.variant?.name ?? null,
        notes: i.notes,
        modifiers: i.modifiers.map((m) => m.name),
      })),
      is_addition: isAddition,
    };
    return await window.electron.printKitchen(payload);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Print bridge error' };
  }
}
