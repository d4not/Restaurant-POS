import { useMemo, useState } from 'react';
import { Badge, Button, Modal } from '../../components/ui';
import { useOrder, useOrderIngredients } from '../../hooks/useOrders';
import type { Order, OrderItem, Payment } from '../../types/operations';
import {
  orderTypeLabel,
  paymentMethodLabel,
} from '../../types/operations';
import { formatDateTime, formatMoney, formatNumber } from '../../utils/format';
import {
  orderStatusTone,
  orderTypeTone,
  paymentMethodTone,
} from '../staff/operations-meta';

interface Props {
  open: boolean;
  onClose: () => void;
  orderId: string | null;
}

export function OrderDetailModal({ open, onClose, orderId }: Props) {
  const q = useOrder(orderId ?? undefined);
  const order = q.data ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        order
          ? (
            <span>
              Order #{order.order_number}
              <span className="text-muted fs-12 fw-600" style={{ marginLeft: 10 }}>
                {formatDateTime(order.created_at)}
              </span>
            </span>
          )
          : 'Order detail'
      }
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {q.isLoading && (
        <div className="loading-block">
          <span className="spinner" />
          Loading order…
        </div>
      )}
      {q.error && (
        <div className="auth-alert">{(q.error as Error).message}</div>
      )}
      {order && <OrderDetailBody order={order} />}
    </Modal>
  );
}

function OrderDetailBody({ order }: { order: Order }) {
  const items = order.items ?? [];
  const payments = order.payments ?? [];
  // Voided items are tombstones — totals already exclude them server-side.
  // Split them out so the items table renders survivors first and a separate
  // "Removed" subsection captures the audit trail.
  const activeItems = items.filter((i) => !i.voided_at);
  const voidedItems = items.filter((i) => i.voided_at);

  const subtotal = Number(order.subtotal);
  const tax = Number(order.tax_amount);
  const discount = Number(order.discount_amount);
  const total = Number(order.total);
  const paid = payments.reduce(
    (sum, p) => sum + Number(p.amount) - Number(p.change_amount),
    0,
  );
  const remaining = total - paid;

  return (
    <>
      {/* Header — status / type / user / cashier */}
      <div className="detail-grid mb-16">
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Status</div>
            <div className="dv">
              <Badge tone={orderStatusTone(order.status)}>{order.status}</Badge>
              {voidedItems.length > 0 && (
                <Badge tone="red" style={{ marginLeft: 6 }}>
                  Edited
                </Badge>
              )}
            </div>
          </div>
          <div className="detail-cell">
            <div className="dk">Type</div>
            <div className="dv">
              <Badge tone={orderTypeTone(order.order_type)}>
                {orderTypeLabel(order.order_type)}
              </Badge>
            </div>
          </div>
        </div>
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Cashier</div>
            <div className="dv">{order.user?.name ?? '—'}</div>
          </div>
          <div className="detail-cell">
            <div className="dk">Table</div>
            <div className="dv">
              {order.table ? (
                <>
                  <span className="fw-600">
                    {order.table.zone.name} · #{order.table.number}
                  </span>
                  <span className="text-muted fs-12">
                    {' '}
                    ({order.table.capacity} seats)
                  </span>
                </>
              ) : (
                <span className="text-muted fs-12">—</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cancellation banner — surfaces who/why/when at the top so a
          reviewer reading a CANCELLED order sees the audit trail before
          the items list. Only renders when the order was actually voided. */}
      {order.status === 'CANCELLED' && (
        <div
          className="detail-section"
          style={{
            background: 'var(--red-bg)',
            border: '1px solid var(--red)',
            borderRadius: 'var(--radius-sm)',
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div className="fs-13 fw-600 text-red" style={{ marginBottom: 4 }}>
            Order cancelled
            {order.cancelled_at && (
              <span className="fs-12 fw-600" style={{ marginLeft: 8, opacity: 0.85 }}>
                {formatDateTime(order.cancelled_at)}
              </span>
            )}
          </div>
          <div className="fs-12">
            <span className="text-muted">By: </span>
            <span className="fw-600">{order.cancelled_by?.name ?? '—'}</span>
          </div>
          {order.cancel_reason && (
            <div className="fs-12 mt-4">
              <span className="text-muted">Reason: </span>
              <em>{order.cancel_reason}</em>
            </div>
          )}
        </div>
      )}

      {/* Items */}
      <div className="detail-section">
        <h3>
          Items · {activeItems.length}
          {voidedItems.length > 0 && (
            <span className="text-muted fw-600 fs-12" style={{ marginLeft: 6 }}>
              ({voidedItems.length} removed)
            </span>
          )}
        </h3>
        {activeItems.length === 0 && voidedItems.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <div className="icon">·</div>
            <div className="msg">No items</div>
          </div>
        ) : (
          <div
            className="table-wrap"
            style={{ background: 'var(--surface)' }}
          >
            <div
              className="table-head"
              style={{ gridTemplateColumns: '48px 1fr 110px 110px' }}
            >
              <div>Qty</div>
              <div>Item</div>
              <div style={{ textAlign: 'right' }}>Unit</div>
              <div style={{ textAlign: 'right' }}>Total</div>
            </div>
            {activeItems.map((item, idx) => (
              <ItemRow key={item.id} item={item} idx={idx} voided={false} />
            ))}
            {voidedItems.length > 0 && (
              <>
                <div
                  className="fs-11 text-muted fw-600"
                  style={{
                    padding: '10px 16px 6px',
                    background: 'var(--bg)',
                    borderTop: '1px solid var(--border)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Removed from this order
                </div>
                {voidedItems.map((item, idx) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    idx={activeItems.length + idx}
                    voided
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Totals — tax-inclusive pricing: total is what the customer pays;
          subtotal + tax is an internal split that equals total (before any
          discount). Voided items contribute zero — they sit on the order as
          audit tombstones but never reach these numbers. */}
      <div className="detail-section">
        <h3>Totals</h3>
        <div className="detail-grid">
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Subtotal (before tax)</div>
              <div className="dv">{formatMoney(subtotal)}</div>
            </div>
            <div className="detail-cell">
              <div className="dk">Tax</div>
              <div className="dv">{formatMoney(tax)}</div>
            </div>
          </div>
          {discount > 0 && (
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Discount</div>
                <div className="dv red">−{formatMoney(discount)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Reason</div>
                <div className="dv">{order.discount_reason ?? '—'}</div>
              </div>
            </div>
          )}
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Total (customer pays)</div>
              <div className="dv gold">{formatMoney(total)}</div>
            </div>
            <div className="detail-cell">
              <div className="dk">Net paid</div>
              <div className="dv">
                {formatMoney(paid)}
                {order.status === 'OPEN' && remaining > 0 && (
                  <span className="text-muted fs-12">
                    {' '}
                    · {formatMoney(remaining)} remaining
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payments */}
      <div className="detail-section">
        <h3>Payments · {payments.length}</h3>
        {payments.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>
            <div className="icon">·</div>
            <div className="msg">No payments recorded</div>
          </div>
        ) : (
          <div className="table-wrap">
            <div
              className="table-head"
              style={{ gridTemplateColumns: '160px 110px 1fr 120px 110px' }}
            >
              <div>Time</div>
              <div>Method</div>
              <div>Reference</div>
              <div style={{ textAlign: 'right' }}>Change</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
            </div>
            {payments.map((p, idx) => (
              <div
                key={p.id}
                className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
                style={{
                  gridTemplateColumns: '160px 110px 1fr 120px 110px',
                  cursor: 'default',
                }}
              >
                <div className="fs-12 text-muted">
                  {formatDateTime(p.created_at)}
                </div>
                <div>
                  <Badge tone={paymentMethodTone(p.method)}>
                    {paymentMethodLabel(p.method)}
                  </Badge>
                </div>
                <div className="fs-12 text-muted">{p.reference ?? '—'}</div>
                <div className="fs-12 text-muted" style={{ textAlign: 'right' }}>
                  {Number(p.change_amount) > 0
                    ? formatMoney(Number(p.change_amount))
                    : '—'}
                </div>
                <div className="fw-600 fs-13" style={{ textAlign: 'right' }}>
                  {formatMoney(Number(p.amount))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ActivityTimeline order={order} />

      {order.notes && (
        <div className="detail-section">
          <h3>Notes</h3>
          <p className="fs-13">{order.notes}</p>
        </div>
      )}

      <IngredientsSection
        orderId={order.id}
        orderStatus={order.status}
        orderTotal={total}
      />
    </>
  );
}

/* ──────────────── One row in the items table ──────────────────
   Voided rows render the same layout but with strike-through styling on the
   text columns and a red void badge with the reason / actor underneath. The
   qty/price columns are kept readable (not struck) so a reviewer auditing
   "what did the customer NOT pay for" can scan the numeric column quickly. */
function ItemRow({
  item,
  idx,
  voided,
}: {
  item: OrderItem;
  idx: number;
  voided: boolean;
}) {
  const name = item.product?.name ?? 'Deleted product';
  const variant = item.variant?.name;
  const unitPrice = Number(item.unit_price);
  const modifiersPrice = Number(item.modifiers_price);
  const lineTotal = Number(item.line_total);
  const struck: React.CSSProperties = voided
    ? { textDecoration: 'line-through', textDecorationColor: 'var(--red)' }
    : {};
  const muted: React.CSSProperties = voided ? { color: 'var(--text2)' } : {};

  return (
    <div
      className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
      style={{
        gridTemplateColumns: '48px 1fr 110px 110px',
        cursor: 'default',
        opacity: voided ? 0.85 : 1,
      }}
    >
      <div className="fw-600 fs-13" style={{ ...muted }}>
        ×{item.quantity}
      </div>
      <div>
        <div className="fw-600 fs-13" style={struck}>
          {name}
          {variant && (
            <span className="text-muted fw-600"> · {variant}</span>
          )}
        </div>
        {item.modifiers && item.modifiers.length > 0 && (
          <div className="fs-11 text-muted mt-4" style={struck}>
            {item.modifiers.map((m, i) => (
              <span key={m.id}>
                + {m.name}
                {Number(m.extra_price) > 0 &&
                  ` (${formatMoney(Number(m.extra_price))})`}
                {i < item.modifiers!.length - 1 && ' · '}
              </span>
            ))}
          </div>
        )}
        {item.notes && (
          <div className="fs-11 text-muted mt-4" style={struck}>
            <em>Note: {item.notes}</em>
          </div>
        )}
        {voided && (
          <div className="fs-11 mt-4" style={{ color: 'var(--red)' }}>
            <Badge tone="red" style={{ marginRight: 6 }}>Removed</Badge>
            {item.voided_at && formatDateTime(item.voided_at)}
            {item.voided_by_user?.name && (
              <span className="text-muted">
                {' · by '}<span className="fw-600">{item.voided_by_user.name}</span>
              </span>
            )}
            {item.void_reason && (
              <div className="mt-4">
                <span className="text-muted">Reason: </span>
                <em>{item.void_reason}</em>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="fs-12 text-muted" style={{ textAlign: 'right', ...muted }}>
        {formatMoney(unitPrice)}
        {modifiersPrice > 0 && (
          <div className="fs-11">+ {formatMoney(modifiersPrice)} mods</div>
        )}
      </div>
      <div className="fw-600 fs-13" style={{ textAlign: 'right', ...muted }}>
        {voided ? <s>{formatMoney(lineTotal)}</s> : formatMoney(lineTotal)}
      </div>
    </div>
  );
}

/* ──────────────── Activity timeline ────────────────────
   Synthesized purely from existing snapshot data (item created_at / sent_at
   / voided_at, payment created_at, order cancel/created_at). No separate
   audit log table — every event is anchored to a real persisted timestamp,
   so the timeline never drifts from the underlying records.

   Events shown:
     • Order created (always)
     • Item added (one per item, deduped onto the order-creation event when
       they share the same instant — hides the noisy "added 3 items in the
       same millisecond as creating the order" case for orders built from a
       template).
     • Sent to kitchen — one event per distinct sent_at instant, grouped to
       reflect the actual comanda print batches.
     • Item voided — per-item, with reason and actor.
     • Void printed on comanda — when void_printed_at is set, surfaces the
       moment the kitchen was notified.
     • Payment received — per payment.
     • Order paid — derived from the payment that first cleared the total.
     • Order cancelled — terminal event with reason + actor.
*/
interface TimelineEvent {
  at: string;
  // Order events sort before item events at the same instant so "Order
  // created" reads naturally above "Item added" when the seed timestamps
  // collide.
  groupOrder: number;
  icon: string;
  iconColor: string;
  title: React.ReactNode;
  detail?: React.ReactNode;
}

function ActivityTimeline({ order }: { order: Order }) {
  const events = useMemo(() => buildTimeline(order), [order]);

  return (
    <div className="detail-section">
      <h3>Activity timeline · {events.length}</h3>
      {events.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <div className="icon">·</div>
          <div className="msg">No activity recorded</div>
        </div>
      ) : (
        <div className="timeline">
          {events.map((e, idx) => (
            <div key={idx} className="timeline-item">
              <div
                className="timeline-dot"
                style={{ borderColor: e.iconColor, color: e.iconColor }}
                aria-hidden
              >
                {e.icon}
              </div>
              <div className="timeline-content">
                <div className="ev">{e.title}</div>
                {e.detail && (
                  <div className="fs-11 text-muted mt-4">{e.detail}</div>
                )}
                <div className="ts">{formatDateTime(e.at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildTimeline(order: Order): TimelineEvent[] {
  const items = order.items ?? [];
  const payments = order.payments ?? [];
  const events: TimelineEvent[] = [];

  // 1. Order created
  events.push({
    at: order.created_at,
    groupOrder: 0,
    icon: '●',
    iconColor: 'var(--gold)',
    title: (
      <>
        Order created by{' '}
        <span className="fw-600">{order.user?.name ?? '—'}</span>
      </>
    ),
  });

  // 2. Items added (skip the items that share the order's exact created_at —
  // those are seed items added at order creation and would just be noise).
  for (const item of items) {
    if (item.created_at === order.created_at) continue;
    events.push({
      at: item.created_at,
      groupOrder: 1,
      icon: '+',
      iconColor: 'var(--gold)',
      title: (
        <>
          Item added: <span className="fw-600">{itemLabel(item)}</span>
          {item.quantity > 1 && (
            <span className="text-muted"> ×{item.quantity}</span>
          )}
        </>
      ),
      detail: item.added_by_user?.name ? (
        <>by <span className="fw-600">{item.added_by_user.name}</span></>
      ) : undefined,
    });
  }

  // 3. Sent to kitchen — group items by their sent_at timestamp so each
  // comanda batch is a single event. A reviewer reading the timeline sees
  // "Sent 3 items to kitchen" rather than three separate single-item events.
  const sentBatches = new Map<string, OrderItem[]>();
  for (const item of items) {
    if (!item.sent_at) continue;
    const key = item.sent_at;
    const list = sentBatches.get(key) ?? [];
    list.push(item);
    sentBatches.set(key, list);
  }
  for (const [sentAt, batch] of sentBatches) {
    const totalQty = batch.reduce((sum, i) => sum + i.quantity, 0);
    events.push({
      at: sentAt,
      groupOrder: 2,
      icon: '↗',
      iconColor: 'var(--blue)',
      title: (
        <>
          Sent to kitchen — {batch.length} line{batch.length === 1 ? '' : 's'}
          <span className="text-muted"> ({totalQty} item{totalQty === 1 ? '' : 's'})</span>
        </>
      ),
      detail: <>{batch.map((i) => itemLabel(i)).join(' · ')}</>,
    });
  }

  // 4. Items voided — per-item so each tombstone gets its own row with the
  // reason + actor. These are the events the user most cares about ("what
  // got removed and why?").
  for (const item of items) {
    if (!item.voided_at) continue;
    events.push({
      at: item.voided_at,
      groupOrder: 3,
      icon: '✕',
      iconColor: 'var(--red)',
      title: (
        <>
          Removed: <span className="fw-600">{itemLabel(item)}</span>
          {item.quantity > 1 && (
            <span className="text-muted"> ×{item.quantity}</span>
          )}
        </>
      ),
      detail: (
        <>
          {item.voided_by_user?.name && (
            <>by <span className="fw-600">{item.voided_by_user.name}</span></>
          )}
          {item.void_reason && (
            <>
              {item.voided_by_user?.name && ' · '}
              <em>{item.void_reason}</em>
            </>
          )}
        </>
      ),
    });
  }

  // 5. Voids announced to kitchen (the CORRECTION comanda that told the
  // cocina to drop the item). One event per distinct void_printed_at.
  const voidPrintBatches = new Map<string, OrderItem[]>();
  for (const item of items) {
    if (!item.void_printed_at) continue;
    const list = voidPrintBatches.get(item.void_printed_at) ?? [];
    list.push(item);
    voidPrintBatches.set(item.void_printed_at, list);
  }
  for (const [printedAt, batch] of voidPrintBatches) {
    events.push({
      at: printedAt,
      groupOrder: 4,
      icon: '⌧',
      iconColor: 'var(--text3)',
      title: (
        <>
          Kitchen notified of{' '}
          {batch.length === 1 ? 'removal' : `${batch.length} removals`}
        </>
      ),
      detail: <>{batch.map((i) => itemLabel(i)).join(' · ')}</>,
    });
  }

  // 6. Payments
  for (const p of payments) {
    events.push({
      at: p.created_at,
      groupOrder: 5,
      icon: '$',
      iconColor: 'var(--green)',
      title: (
        <>
          Payment received:{' '}
          <span className="fw-600">{formatMoney(Number(p.amount))}</span>{' '}
          <span className="text-muted">{paymentMethodLabel(p.method)}</span>
          {Number(p.change_amount) > 0 && (
            <span className="text-muted">
              {' '}
              · change {formatMoney(Number(p.change_amount))}
            </span>
          )}
        </>
      ),
      detail: p.reference ? <>Ref: {p.reference}</> : undefined,
    });
  }

  // 7. Order PAID — derived from when payments first covered the total.
  // Only emit when the order is actually PAID (avoids implying an OPEN
  // partially-paid order has settled).
  if (order.status === 'PAID') {
    const settledAt = findSettledAt(payments, Number(order.total));
    if (settledAt) {
      events.push({
        at: settledAt,
        groupOrder: 6,
        icon: '✓',
        iconColor: 'var(--green)',
        title: <span className="fw-600">Order paid</span>,
        detail: <>Total {formatMoney(Number(order.total))}</>,
      });
    }
  }

  // 8. Order cancelled — terminal event with reason + actor.
  if (order.status === 'CANCELLED' && order.cancelled_at) {
    events.push({
      at: order.cancelled_at,
      groupOrder: 7,
      icon: '✕',
      iconColor: 'var(--red)',
      title: <span className="fw-600">Order cancelled</span>,
      detail: (
        <>
          {order.cancelled_by?.name && (
            <>by <span className="fw-600">{order.cancelled_by.name}</span></>
          )}
          {order.cancel_reason && (
            <>
              {order.cancelled_by?.name && ' · '}
              <em>{order.cancel_reason}</em>
            </>
          )}
        </>
      ),
    });
  }

  events.sort((a, b) => {
    const cmp = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (cmp !== 0) return cmp;
    return a.groupOrder - b.groupOrder;
  });
  return events;
}

function itemLabel(item: OrderItem): string {
  const name = item.product?.name ?? 'Deleted product';
  const variant = item.variant?.name ? ` · ${item.variant.name}` : '';
  return `${name}${variant}`;
}

// Find the timestamp at which the running net-paid first covered the total.
// Returns the matching payment's created_at, or null when no single sequence
// of payments crossed the threshold (defensive — should not happen for a
// status=PAID order).
function findSettledAt(payments: Payment[], total: number): string | null {
  if (payments.length === 0) return null;
  let running = 0;
  // Payments come back sorted by created_at asc from the backend, but sort
  // here defensively in case the caller reorders.
  const sorted = [...payments].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  for (const p of sorted) {
    running += Number(p.amount) - Number(p.change_amount);
    if (running >= total) return p.created_at;
  }
  return sorted[sorted.length - 1].created_at;
}

/* ──────────────── Ingredients used ────────────────────── */

function IngredientsSection({
  orderId,
  orderStatus,
  orderTotal,
}: {
  orderId: string;
  orderStatus: Order['status'];
  orderTotal: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const q = useOrderIngredients(orderId, { enabled: expanded });

  // CANCELLED orders never touched inventory, so there's nothing to show.
  if (orderStatus === 'CANCELLED') return null;

  const ingredients = q.data?.ingredients ?? [];
  const totalCost = Number(q.data?.grand_total_cost ?? 0);
  const margin = orderTotal - totalCost;

  return (
    <div className="detail-section">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setExpanded((v) => !v)}
        style={{ marginBottom: 12 }}
      >
        {expanded ? '▾' : '▸'} Ingredients used
      </button>

      {!expanded ? null : q.isLoading ? (
        <div className="loading-block">
          <span className="spinner" />
          Loading…
        </div>
      ) : q.error ? (
        <div className="auth-alert">{(q.error as Error).message}</div>
      ) : orderStatus === 'OPEN' ? (
        <div className="fs-12 text-muted">
          Ingredients are deducted only when the order is paid.
        </div>
      ) : ingredients.length === 0 ? (
        <div className="fs-12 text-muted">No ingredient movements recorded.</div>
      ) : (
        <>
          <div className="table-wrap" style={{ background: 'var(--surface)' }}>
            <div
              className="table-head"
              style={{ gridTemplateColumns: '2fr 120px 120px 120px' }}
            >
              <div>Supply</div>
              <div style={{ textAlign: 'right' }}>Quantity</div>
              <div style={{ textAlign: 'right' }}>Unit cost</div>
              <div style={{ textAlign: 'right' }}>Total</div>
            </div>
            {ingredients.map((row, idx) => (
              <div
                key={row.supply_id}
                className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
                style={{
                  gridTemplateColumns: '2fr 120px 120px 120px',
                  cursor: 'default',
                }}
              >
                <div className="fw-600 fs-13">{row.supply_name}</div>
                <div className="fs-13" style={{ textAlign: 'right' }}>
                  {formatNumber(row.quantity, 4)} {row.unit.toLowerCase()}
                </div>
                <div className="fs-12 text-muted" style={{ textAlign: 'right' }}>
                  {formatMoney(row.unit_cost)}
                </div>
                <div className="fw-600 fs-13" style={{ textAlign: 'right' }}>
                  {formatMoney(row.total_cost)}
                </div>
              </div>
            ))}
          </div>

          <div className="detail-grid mt-12">
            <div
              className="detail-row"
              style={{ gridTemplateColumns: '1fr 1fr 1fr' }}
            >
              <div className="detail-cell">
                <div className="dk">Ingredient cost</div>
                <div className="dv red">−{formatMoney(totalCost)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Order total</div>
                <div className="dv">{formatMoney(orderTotal)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Gross profit</div>
                <div
                  className="dv"
                  style={{ color: margin >= 0 ? 'var(--green)' : 'var(--red)' }}
                >
                  {formatMoney(margin)}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
