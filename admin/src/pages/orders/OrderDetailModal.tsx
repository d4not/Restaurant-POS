import { useState } from 'react';
import { Badge, Button, Modal } from '../../components/ui';
import { useOrder, useOrderIngredients } from '../../hooks/useOrders';
import type { Order } from '../../types/operations';
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

      {/* Items */}
      <div className="detail-section">
        <h3>Items · {items.length}</h3>
        {items.length === 0 ? (
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
            {items.map((item, idx) => {
              const name = item.product?.name ?? 'Deleted product';
              const variant = item.variant?.name;
              const unitPrice = Number(item.unit_price);
              const modifiersPrice = Number(item.modifiers_price);
              const lineTotal = Number(item.line_total);
              return (
                <div
                  key={item.id}
                  className={`table-row ${idx % 2 === 0 ? 'even' : 'odd'}`}
                  style={{
                    gridTemplateColumns: '48px 1fr 110px 110px',
                    cursor: 'default',
                  }}
                >
                  <div className="fw-600 fs-13">×{item.quantity}</div>
                  <div>
                    <div className="fw-600 fs-13">
                      {name}
                      {variant && (
                        <span className="text-muted fw-600"> · {variant}</span>
                      )}
                    </div>
                    {item.modifiers && item.modifiers.length > 0 && (
                      <div className="fs-11 text-muted mt-4">
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
                      <div className="fs-11 text-muted mt-4">
                        <em>Note: {item.notes}</em>
                      </div>
                    )}
                  </div>
                  <div className="fs-12 text-muted" style={{ textAlign: 'right' }}>
                    {formatMoney(unitPrice)}
                    {modifiersPrice > 0 && (
                      <div className="fs-11">
                        + {formatMoney(modifiersPrice)} mods
                      </div>
                    )}
                  </div>
                  <div
                    className="fw-600 fs-13"
                    style={{ textAlign: 'right' }}
                  >
                    {formatMoney(lineTotal)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Totals — tax-inclusive pricing: total is what the customer pays;
          subtotal + tax is an internal split that equals total (before any
          discount). */}
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
