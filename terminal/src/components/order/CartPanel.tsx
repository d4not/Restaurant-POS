import type { ActiveOrder, ActiveOrderItem, UserRole } from '../../types/api';
import {
  ROLE_CAN_DELETE_ITEMS,
  ROLE_CAN_PAY,
  ROLE_CAN_WRITE_ORDER,
  ROLE_IS_READ_ONLY,
} from '../../store/session';
import { formatMoney } from '../../utils/format';

interface Props {
  order: ActiveOrder;
  role: UserRole;
  onIncrement: (item: ActiveOrderItem) => void;
  onDecrement: (item: ActiveOrderItem) => void;
  onRemove: (item: ActiveOrderItem) => void;
  onSendToKitchen: () => void;
  onPay: () => void;
  onHold: () => void;
  onRequestEdit: () => void;
  onClearAttention: () => void;
  mutatingItemId: string | null;
  sendingToKitchen: boolean;
  requestEditBusy: boolean;
  clearAttentionBusy: boolean;
}

export function CartPanel({
  order,
  role,
  onIncrement,
  onDecrement,
  onRemove,
  onSendToKitchen,
  onPay,
  onHold,
  onRequestEdit,
  onClearAttention,
  mutatingItemId,
  sendingToKitchen,
  requestEditBusy,
  clearAttentionBusy,
}: Props) {
  const canDelete = ROLE_CAN_DELETE_ITEMS.includes(role);
  const canPay = ROLE_CAN_PAY.includes(role);
  const canWrite = ROLE_CAN_WRITE_ORDER.includes(role);
  const readOnly = ROLE_IS_READ_ONLY.includes(role);

  // "Pending" items = added since the last kitchen send. Kitchen button is
  // only meaningful when there's something to send.
  const pendingCount = order.items.filter((it) => !it.sent_to_kitchen).length;

  const discount = Number(order.discount_amount || 0);

  return (
    <>
      <header className="cart-header">
        <div className="order-line">
          <div className="order-num">#{order.order_number}</div>
          <div className={`order-type ${order.order_type === 'TAKEOUT' ? 'takeout' : ''}`}>
            {order.order_type === 'DINE_IN' ? 'Dine In' : 'Takeout'}
          </div>
          {order.needs_attention && (
            <span className="attention-badge" title="Waiter requested an edit">
              ⚑ Needs cashier
            </span>
          )}
        </div>
        <div className="meta">
          {order.table
            ? `${order.table.zone.name} · Table ${order.table.number}`
            : 'Takeout'}
          {' · '}
          {order.user.name}
        </div>
      </header>

      {order.needs_attention && (
        <div className="attention-banner">
          <div className="attention-body">
            <div className="attention-title">
              A waiter has flagged this order for the cashier.
            </div>
            {order.attention_reason && (
              <div className="attention-reason">“{order.attention_reason}”</div>
            )}
          </div>
          {canPay && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClearAttention}
              disabled={clearAttentionBusy}
            >
              {clearAttentionBusy ? 'Clearing…' : 'Mark resolved'}
            </button>
          )}
        </div>
      )}

      {order.items.length === 0 ? (
        <div className="cart-empty">
          <div className="icon">🧾</div>
          <div className="title">Empty ticket</div>
          <div>Tap a product on the left to add it.</div>
        </div>
      ) : (
        <div className="cart-list">
          {order.items.map((it) => (
            <CartItemRow
              key={it.id}
              item={it}
              canDelete={canDelete}
              disabled={mutatingItemId === it.id || readOnly}
              readOnly={readOnly}
              onIncrement={() => onIncrement(it)}
              onDecrement={() => onDecrement(it)}
              onRemove={() => onRemove(it)}
            />
          ))}
        </div>
      )}

      <div className="cart-totals">
        <div className="row">
          <span>Subtotal</span>
          <span>{formatMoney(order.subtotal)}</span>
        </div>
        <div className="row">
          <span>Tax</span>
          <span>{formatMoney(order.tax_amount)}</span>
        </div>
        {discount > 0 && (
          <div className="row">
            <span>Discount</span>
            <span>-{formatMoney(discount)}</span>
          </div>
        )}
        <div className="row total">
          <span>Total</span>
          <span>{formatMoney(order.total)}</span>
        </div>
      </div>

      <div className="cart-actions">
        {canWrite && (
          <button
            type="button"
            className="btn btn-success btn-lg btn-full"
            onClick={onSendToKitchen}
            disabled={pendingCount === 0 || sendingToKitchen}
          >
            {sendingToKitchen
              ? 'Sending…'
              : pendingCount > 0
                ? `Send ${pendingCount} to Kitchen`
                : 'All sent to kitchen'}
          </button>
        )}
        {canPay ? (
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={onPay}
            disabled={order.items.length === 0}
          >
            Pay
          </button>
        ) : canWrite ? (
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={onRequestEdit}
            disabled={requestEditBusy || order.items.length === 0 || order.needs_attention}
            title={
              order.needs_attention
                ? 'Cashier has already been notified'
                : 'Ask the cashier to edit or delete items for you'
            }
          >
            {requestEditBusy
              ? 'Flagging…'
              : order.needs_attention
                ? 'Cashier notified ✓'
                : 'Request Edit'}
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-lg" onClick={onHold}>
          {readOnly ? 'Back' : 'Hold'}
        </button>
      </div>
    </>
  );
}

interface ItemRowProps {
  item: ActiveOrderItem;
  canDelete: boolean;
  disabled: boolean;
  readOnly: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}

function CartItemRow({
  item,
  canDelete,
  disabled,
  readOnly,
  onIncrement,
  onDecrement,
  onRemove,
}: ItemRowProps) {
  return (
    <div className={`cart-item ${item.sent_to_kitchen ? 'sent' : ''}`}>
      <div className="top">
        <div className="name">
          {item.product.name}
          {item.variant && <span className="variant">· {item.variant.name}</span>}
        </div>
        {item.sent_to_kitchen && (
          <span className="sent-badge" title="Sent to kitchen">
            ✓ Sent
          </span>
        )}
      </div>

      {item.modifiers.length > 0 && (
        <div className="modifiers">
          {item.modifiers.map((m) => (
            <div className="modifier-line" key={m.id}>
              <span>· {m.name}</span>
              {Number(m.extra_price) > 0 && (
                <span>+{formatMoney(m.extra_price)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {item.notes && <div className="notes">“{item.notes}”</div>}

      <div className="bottom">
        {!readOnly ? (
          <div className="qty-stepper">
            <button
              type="button"
              onClick={onDecrement}
              disabled={disabled || item.quantity <= 1}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="value">{item.quantity}</span>
            <button
              type="button"
              onClick={onIncrement}
              disabled={disabled}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        ) : (
          <span className="qty-readonly">× {item.quantity}</span>
        )}
        <span className="line-total">{formatMoney(item.line_total)}</span>
        {canDelete && !readOnly && (
          <button
            type="button"
            className="icon-btn danger"
            onClick={onRemove}
            disabled={disabled}
            aria-label="Remove item"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
