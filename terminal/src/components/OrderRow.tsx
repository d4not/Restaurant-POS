import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  cancelOrder,
  clearOrderAttention,
  sendOrderToKitchen,
  type ActiveOrder,
  type ActiveOrderItem,
} from '../api/orders';
import {
  formatElapsed,
  formatMoney,
  getTimeStatus,
  minutesSince,
  timeStatusColor,
} from '../utils/format';
import { ApiError } from '../api/client';
import { useUi } from '../store/ui';
import { getBridge } from '../platform';
import { PulsingDot, Spinner } from './Spinner';
import { IconClose, IconPrinter } from './Icons';
import { CancelOrderModal } from './CancelOrderModal';
import { confirmDialog } from './ConfirmDialog';
import { useTakeoutChannelLabel } from './TakeoutChannelPicker';
import { useTranslation } from '../i18n';

// Discount + cashier-only actions stay gated; cancel is open to everyone now
// — the *backend* gate kicks in only when at least one line was sent to the
// kitchen, in which case the modal collects a cashier PIN + reason.
const ROLES_THAT_DISCOUNT: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

interface Props {
  order: ActiveOrder;
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    position: 'relative',
    // Flex (not grid) so the waiter column reliably expands to fill the
    // leftover space and pushes the actions column to the row's right edge.
    // With grid + minmax(0, 1fr) the leftover stayed parked after the last
    // track on wide screens, leaving the buttons floating in the middle.
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    minHeight: 64,
    padding: '8px 22px 8px 32px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  rowExpanded: {
    background: 'rgba(201,164,92,0.05)',
  },
  stripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: '0 2px 2px 0',
  },
  timeWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    width: 96,
    flexShrink: 0,
  },
  tableCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
    width: 150,
    flexShrink: 0,
  },
  tableLabel: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  zoneSub: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 2,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  waiterCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    // Eats the leftover space so subsequent columns sit flush against the
    // row's right edge instead of floating in the middle.
    flex: 1,
  },
  waiterName: {
    fontSize: 13,
    color: 'var(--text2)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  waiterMeta: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 2,
  },
  itemsCol: {
    fontSize: 13,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
    width: 96,
    flexShrink: 0,
  },
  totalCol: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    width: 110,
    flexShrink: 0,
  },
  statusCol: {
    fontSize: 12,
    color: 'var(--text2)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    width: 140,
    flexShrink: 0,
  },
  attentionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 999,
    background: 'rgba(196,80,64,0.12)',
    color: 'var(--red)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginLeft: 8,
  },
  rightCol: {
    // Two equal tracks keep the primary action and "View Full" the exact
    // same width so the right edge of every order row lines up cleanly down
    // the list.
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    alignItems: 'center',
    gap: 8,
    width: 220,
    flexShrink: 0,
  },
  chargeBtnBase: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 38,
    width: '100%',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  viewFullBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 38,
    width: '100%',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    border: '1px solid var(--border)',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },

  // ─── Expanded detail ────────────────────────────────────────────────
  detail: {
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
    padding: '16px 22px 18px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  detailHd: {
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  detailRow: {
    display: 'grid',
    gridTemplateColumns: '24px 50px 1fr auto auto',
    columnGap: 14,
    padding: '12px 16px',
    borderBottom: '1px solid rgba(44,36,32,0.05)',
    alignItems: 'center',
  },
  detailQty: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  detailName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
  },
  detailMods: {
    fontSize: 11,
    color: 'var(--text2)',
    fontStyle: 'italic',
    marginTop: 2,
  },
  detailNote: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 2,
  },
  detailPrice: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  notes: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '12px 14px',
    fontSize: 13,
    color: 'var(--text2)',
    fontStyle: 'italic',
  },
  actions: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    border: '1px solid var(--border)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 38,
    fontFamily: 'inherit',
  },
  actionBtnDanger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 8,
    background: 'var(--red)',
    color: '#fff',
    border: '1px solid var(--red)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 38,
    fontFamily: 'inherit',
  },
  errorBanner: {
    background: 'rgba(196,80,64,0.08)',
    color: 'var(--red)',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
  },
};

const timeDotStyle = (color: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  flexShrink: 0,
});

// Action-driven colours for the right-side button so the cashier sees at a
// glance what the order needs next. Empty = neutral dark (need to add items),
// pending kitchen = gold (act on it), all sent = green (ready to settle).
type ActionVariant = 'empty' | 'send' | 'pay';
const chargeBtnVariant = (v: ActionVariant): React.CSSProperties => {
  switch (v) {
    case 'send':
      return { background: 'var(--gold)', color: '#2c2420', border: '1px solid rgba(44,36,32,0.08)' };
    case 'pay':
      return { background: 'var(--green)', color: '#fff', border: '1px solid var(--green)' };
    case 'empty':
    default:
      return { background: 'var(--text1)', color: '#fff', border: '1px solid var(--text1)' };
  }
};

const statusBadgeStyle = (variant: 'ready' | 'pending' | 'sent'): React.CSSProperties => {
  const map = {
    ready: { fg: 'var(--green)', bg: 'rgba(74,140,92,0.12)' },
    sent: { fg: '#a8412c', bg: 'rgba(217,113,68,0.16)' },
    pending: { fg: 'var(--text2)', bg: 'rgba(168,152,136,0.18)' },
  } as const;
  const c = map[variant];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '4px 10px',
    borderRadius: 999,
    color: c.fg,
    background: c.bg,
  };
};

const detailIconStyle = (color: string): React.CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: `1.6px solid ${color}`,
  color,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
});

function itemSummary(items: ActiveOrderItem[]): { ready: number; total: number; allSent: boolean } {
  const total = items.length;
  const sent = items.filter((i) => i.sent_to_kitchen).length;
  return { ready: sent, total, allSent: total > 0 && sent === total };
}

function totalQty(items: ActiveOrderItem[]): number {
  return items.reduce((acc, i) => acc + i.quantity, 0);
}

export function OrderRow({ order }: Props) {
  const { t } = useTranslation();
  const channelLabel = useTakeoutChannelLabel();
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const openOrderDetail = useUi((s) => s.openOrderDetail);
  const openOrderPayment = useUi((s) => s.openOrderPayment);
  // Cancel is open to all roles in the UI; the backend asks for a cashier PIN
  // only if any line was sent. ROLES_THAT_DISCOUNT will gate future cashier-
  // only buttons (apply discount, etc.) so we keep the constant around.
  void ROLES_THAT_DISCOUNT;
  const canCancel = true;

  const minutes = minutesSince(order.created_at);
  const timeStatus = getTimeStatus(minutes);
  const stripeColor = timeStatusColor(timeStatus);
  const summary = itemSummary(order.items);

  const tableLabel = order.order_type === 'TAKEOUT'
    ? `${t('orders.takeoutHash')} #${order.order_number}`
    : order.table
      ? `${t('orders.tablePrefix')} ${order.table.number}`
      : `${t('detail.orderNumber')}${order.order_number}`;

  // Subtitle below "Takeout #N" — show the channel name (and customer when
  // we have one) so the cashier can pick the right ticket without expanding.
  const zoneLabel = (() => {
    if (order.order_type !== 'TAKEOUT') return order.table?.zone.name ?? '—';
    const label = order.takeout_channel
      ? channelLabel(order.takeout_channel)
      : t('detail.takeoutLabel');
    if (order.customer_name) return `${label} · ${order.customer_name}`;
    if (order.delivery_app_order_id) return `${label} · ${order.delivery_app_order_id}`;
    return label;
  })();

  const sendKitchenMutation = useMutation({
    mutationFn: () => sendOrderToKitchen(order.id),
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
      // Mirror TableDetail's behaviour: hand the printed payload to the
      // Electron IPC bridge (desktop) or the backend's /print/kitchen endpoint
      // (mobile/web) so the comanda actually prints. Failures are swallowed —
      // the backend's `sent_at` is the source of truth and the renderer has
      // already updated; a missing printer shouldn't block the cashier.
      if (result.printed_count > 0) {
        try {
          if (window.electron?.printer) {
            await window.electron.printer.printKitchen({
              order_id: result.order_id,
              order_number: result.order.order_number,
              table:
                result.order.order_type === 'TAKEOUT'
                  ? `${t('orders.takeoutHash')} #${result.order.order_number}`
                  : result.order.table
                    ? `${t('orders.tablePrefix')} ${result.order.table.number}`
                    : null,
              waiter: result.order.user.name,
              printed_at: result.printed_at,
              is_correction: result.is_correction,
              items: result.items,
              voided_items: result.voided_items,
            });
          } else {
            await getBridge().print.kitchen(result.order_id);
          }
        } catch {
          /* bridge stubbed or printer unreachable; backend state is authoritative */
        }
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (input: { reason?: string; pin?: string }) =>
      cancelOrder(order.id, input),
    onSuccess: () => {
      setCancelOpen(false);
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
    },
  });
  const [cancelOpen, setCancelOpen] = useState(false);

  const clearAttentionMutation = useMutation({
    mutationFn: () => clearOrderAttention(order.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders', 'active'] }),
  });

  const reprintBusy = sendKitchenMutation.isPending;
  const cancelBusy = cancelMutation.isPending;

  const totalItems = totalQty(order.items);

  let statusEl: React.ReactNode;
  if (summary.total === 0) {
    statusEl = <span style={statusBadgeStyle('pending')}>{t('orders.empty.short')}</span>;
  } else if (summary.allSent) {
    statusEl = <span style={statusBadgeStyle('sent')}>{t('orders.statusSent')} · {summary.total}/{summary.total}</span>;
  } else if (summary.ready === 0) {
    statusEl = <span style={statusBadgeStyle('pending')}>{t('orders.waiting')}</span>;
  } else {
    statusEl = <span style={statusBadgeStyle('sent')}>{summary.ready}/{summary.total} {t('orders.sentCount')}</span>;
  }

  async function handleCancel() {
    if (cancelBusy) return;
    const hasSent = order.items.some((i) => i.sent_to_kitchen);
    if (hasSent) {
      setCancelOpen(true);
      return;
    }
    const ok = await confirmDialog({
      title: `${t('orders.cancelTitle')} ${tableLabel}`,
      message:
        order.items.length === 0
          ? t('orders.cancelEmptyMsg')
          : t('orders.cancelUnsentMsg'),
      confirmLabel: t('cancel.confirmButton'),
      cancelLabel: t('cancel.keepOrder'),
      danger: true,
    });
    if (ok) cancelMutation.mutate({});
  }

  return (
    <>
      <div
        style={{ ...styles.row, ...(expanded ? styles.rowExpanded : null) }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div style={{ ...styles.stripe, background: stripeColor }} />

        <div style={styles.timeWrap}>
          <span style={timeDotStyle(stripeColor)} />
          {formatElapsed(minutes)}
        </div>

        <div style={styles.tableCol}>
          <span style={styles.tableLabel}>{tableLabel}</span>
          <span style={styles.zoneSub}>{zoneLabel}</span>
        </div>

        <div style={styles.waiterCol}>
          <span style={styles.waiterName}>{order.user.name}</span>
          <span style={styles.waiterMeta}>#{order.order_number}</span>
        </div>

        <div style={styles.itemsCol}>
          {totalItems} {totalItems === 1 ? t('orders.itemCount') : t('orders.itemsCount')}
        </div>

        <div style={styles.totalCol}>{formatMoney(order.total)}</div>

        <div style={styles.statusCol}>
          {statusEl}
          {order.needs_attention && (
            <span
              style={styles.attentionBadge}
              onClick={(e) => {
                e.stopPropagation();
                clearAttentionMutation.mutate();
              }}
              title={order.attention_reason ?? t('orders.helpRequested')}
            >
              <PulsingDot color="var(--red)" size={8} />
              {t('orders.helpShort')}
            </span>
          )}
        </div>

        <div style={styles.rightCol} onClick={(e) => e.stopPropagation()}>
          {(() => {
            const variant: ActionVariant =
              summary.total === 0 ? 'empty' : summary.allSent ? 'pay' : 'send';
            const label =
              variant === 'empty'
                ? t('orders.openOrder')
                : variant === 'pay'
                  ? t('orders.payOrder')
                  : sendKitchenMutation.isPending
                    ? t('orders.sending')
                    : t('orders.sendOrder');
            // Send Order fires the kitchen mutation in place — no need to
            // detour through the order detail. Pay Order pops the payment
            // modal directly. Empty orders still need the workspace to add
            // items, so they go to the detail view.
            const onClick = () => {
              if (variant === 'send') {
                if (!sendKitchenMutation.isPending) sendKitchenMutation.mutate();
              } else if (variant === 'pay') {
                openOrderPayment(order.id);
              } else {
                openOrderDetail(order.id);
              }
            };
            return (
              <>
                <button
                  type="button"
                  style={{ ...styles.chargeBtnBase, ...chargeBtnVariant(variant) }}
                  onClick={onClick}
                  disabled={variant === 'send' && sendKitchenMutation.isPending}
                >
                  {variant === 'send' && sendKitchenMutation.isPending ? (
                    <Spinner size={14} />
                  ) : null}
                  {label}
                </button>
                <button
                  type="button"
                  style={styles.viewFullBtn}
                  onClick={() => openOrderDetail(order.id)}
                >
                  {t('orders.viewFull')}
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {expanded && (
        <div style={styles.detail} onClick={(e) => e.stopPropagation()}>
          <div style={styles.detailHd}>{t('orders.itemsLabel')} ({order.items.length})</div>
          {order.items.length === 0 ? (
            <div style={{ ...styles.notes, fontStyle: 'normal' }}>{t('orders.noItemsAdded')}</div>
          ) : (
            <div style={styles.itemList}>
              {order.items.map((item) => {
                const sent = item.sent_to_kitchen;
                return (
                  <div key={item.id} style={styles.detailRow}>
                    <span style={detailIconStyle(sent ? 'var(--green)' : 'var(--text3)')}>
                      {sent ? '✓' : '◷'}
                    </span>
                    <span style={styles.detailQty}>{item.quantity}×</span>
                    <div>
                      <div style={styles.detailName}>
                        {item.product.name}
                        {item.variant && ` · ${item.variant.name}`}
                      </div>
                      {item.modifiers.length > 0 && (
                        <div style={styles.detailMods}>
                          {item.modifiers.map((m) => m.name).join(' · ')}
                        </div>
                      )}
                      {item.notes && <div style={styles.detailNote}>{t('orders.note')}: {item.notes}</div>}
                    </div>
                    <span style={styles.detailPrice}>{formatMoney(item.line_total)}</span>
                    <span />
                  </div>
                );
              })}
            </div>
          )}

          {order.notes && (
            <div style={styles.notes}>{order.notes}</div>
          )}

          {(sendKitchenMutation.error || cancelMutation.error) && (
            <div style={styles.errorBanner}>
              {(sendKitchenMutation.error instanceof ApiError
                ? sendKitchenMutation.error.message
                : null) ??
                (cancelMutation.error instanceof ApiError
                  ? cancelMutation.error.message
                  : t('orders.actionFailed'))}
            </div>
          )}

          <div style={styles.actions}>
            <button
              type="button"
              style={styles.actionBtn}
              disabled={reprintBusy}
              onClick={() => sendKitchenMutation.mutate()}
            >
              {reprintBusy ? <Spinner size={14} /> : <IconPrinter style={{ fontSize: 16 }} />}
              {t('orders.sendReprint')}
            </button>
            <button
              type="button"
              style={styles.actionBtn}
              onClick={() => openOrderDetail(order.id)}
            >
              {t('orders.viewFull')}
            </button>
            {canCancel && (
              <button
                type="button"
                style={styles.actionBtnDanger}
                disabled={cancelBusy}
                onClick={handleCancel}
              >
                {cancelBusy ? <Spinner size={14} /> : <IconClose style={{ fontSize: 14 }} />}
                {t('orders.cancelOrder')}
              </button>
            )}
          </div>
        </div>
      )}

      {cancelOpen && (
        <CancelOrderModal
          tableLabel={tableLabel}
          busy={cancelMutation.isPending}
          error={
            cancelMutation.error instanceof ApiError
              ? cancelMutation.error.message
              : cancelMutation.error
                ? t('orders.cancelFailed')
                : null
          }
          onClose={() => {
            setCancelOpen(false);
            cancelMutation.reset();
          }}
          onConfirm={(reason, pin) => cancelMutation.mutate({ reason, pin })}
        />
      )}
    </>
  );
}
