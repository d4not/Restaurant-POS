import { Badge, Button, Modal } from '../../components/ui';
import { useOrder } from '../../hooks/useOrders';
import type { Order } from '../../types/operations';
import {
  orderTypeLabel,
  paymentMethodLabel,
} from '../../types/operations';
import { formatDateTime, formatMoney } from '../../utils/format';
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
            <div className="dk">Register</div>
            <div className="dv fs-12 text-muted">{order.register_id.slice(0, 8)}…</div>
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

      {/* Totals */}
      <div className="detail-section">
        <h3>Totals</h3>
        <div className="detail-grid">
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Subtotal</div>
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
              <div className="dk">Total</div>
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
    </>
  );
}
