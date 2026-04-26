import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  addOrderItem,
  addOrderPayment,
  cancelOrder,
  fetchOrder,
  removeOrderItem,
  restoreOrderItem,
  sendOrderToKitchen,
  updateOrder,
  updateOrderItem,
  type ActiveOrder,
  type ActiveOrderItem,
  type AddOrderItemInput,
  type CreatePaymentInput,
  type PaymentMethodType,
} from '../api/orders';
import { fetchAllCategories, type ProductCategory } from '../api/categories';
import { fetchAllProducts, type PosProduct } from '../api/products';
import { ApiError } from '../api/client';
import { ProductPicker } from '../components/ProductPicker';
import { Spinner } from '../components/Spinner';
import { confirmDialog } from '../components/ConfirmDialog';
import {
  IconCash,
  IconClose,
  IconPercent,
  IconPrinter,
} from '../components/Icons';
import { CancelOrderModal } from '../components/CancelOrderModal';
import { PinConfirmModal } from '../components/PinConfirmModal';
import { TakeoutCustomerPanel } from '../components/TakeoutCustomerPanel';
import { TAKEOUT_CHANNEL_LABEL } from '../api/settings';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import {
  formatElapsed,
  formatMoney,
  formatMoneyPlain,
  minutesSince,
} from '../utils/format';

const ALL_CATEGORIES = '__all__';

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: 'var(--bg)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    padding: '14px 24px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
    minHeight: 72,
    flexShrink: 0,
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 14px 10px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 40,
    fontFamily: 'inherit',
  },
  hTitleBlock: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.15,
    minWidth: 0,
  },
  hTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 24,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  hMeta: {
    display: 'flex',
    gap: 12,
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
    alignItems: 'center',
  },
  metaSep: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: 'var(--text3)',
    display: 'inline-block',
  },
  hSpacer: { flex: 1 },
  hStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    fontVariantNumeric: 'tabular-nums',
  },
  hStatLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  hStatVal: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    marginTop: 2,
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'grid',
    // Two-column layout: ticket sidebar (left) + menu (right). Payment moved
    // to its own modal so the workspace stays focused on building the ticket.
    gridTemplateColumns: '380px minmax(0, 1fr)',
    gap: 0,
    overflow: 'hidden',
  },

  // ─── Right column (menu — pick products to add to the ticket)
  menuCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    background: 'var(--bg)',
  },
  catRow: {
    display: 'flex',
    gap: 6,
    padding: '14px 20px',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto',
    flexShrink: 0,
    alignItems: 'center',
  },
  menuSearch: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    marginLeft: 'auto',
    minWidth: 200,
    minHeight: 40,
    flexShrink: 0,
  },
  menuSearchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: 'var(--text1)',
    flex: 1,
    fontFamily: 'inherit',
  },
  productGrid: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '18px 20px 24px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 12,
    alignContent: 'start',
  },
  productCard: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 14px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: 'var(--shadow-sm)',
    minHeight: 96,
    fontFamily: 'inherit',
    transition: 'transform 0.08s, border-color 0.12s',
  },
  productName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
    lineHeight: 1.35,
    flex: 1,
  },
  productFoot: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  productPrice: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  productAdd: {
    width: 28,
    height: 28,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 16,
    fontWeight: 700,
  },
  productHint: {
    fontSize: 10,
    color: 'var(--text3)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginTop: 4,
  },
  emptyMenu: {
    padding: 60,
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    gridColumn: '1 / -1',
  },

  // ─── Left column (ticket — primary workspace sidebar)
  ticketCol: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
    background: 'var(--bg2)',
    borderRight: '1px solid var(--border)',
  },
  ticketHead: {
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  ticketTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  },
  ticketSub: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.04em',
    marginTop: 2,
    fontVariantNumeric: 'tabular-nums',
  },
  ticketBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '4px 0 12px',
  },
  qtyControls: {
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg)',
    height: 30,
    overflow: 'hidden',
  },
  qtyBtn: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text2)',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 600,
  },
  qtyVal: {
    minWidth: 24,
    textAlign: 'center',
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    padding: '0 4px',
  },
  itemBlock: {
    minWidth: 0,
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  itemName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
    lineHeight: 1.3,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemMods: {
    fontSize: 11,
    color: 'var(--text2)',
    fontStyle: 'italic',
    marginTop: 3,
  },
  itemNote: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 3,
  },
  itemPriceCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  },
  itemPrice: {
    fontFamily: "'Playfair Display', serif",
    fontVariantNumeric: 'tabular-nums',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  removeBtn: {
    background: 'transparent',
    color: 'var(--text3)',
    fontSize: 14,
    cursor: 'pointer',
    padding: '0 4px',
  },
  emptyTicket: {
    padding: '60px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },
  ticketFoot: {
    flexShrink: 0,
    padding: '12px 20px 16px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },

  // ─── Panels (used inside the payment modal — formerly the right column)
  panel: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 16px',
  },
  panelHd: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    marginBottom: 8,
    display: 'flex',
    justifyContent: 'space-between',
  },
  totalsRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    rowGap: 6,
    columnGap: 12,
    fontSize: 13,
    color: 'var(--text2)',
  },
  totalsAmt: {
    color: 'var(--text1)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  },
  grandLabel: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--text1)',
    paddingTop: 10,
    marginTop: 4,
    borderTop: '1px solid var(--border)',
  },
  grandAmt: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    paddingTop: 10,
    marginTop: 4,
    borderTop: '1px solid var(--border)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  payMethods: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
    marginBottom: 12,
  },
  amountInput: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 8,
    border: '1.5px solid var(--border)',
    background: 'var(--bg2)',
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    outline: 'none',
  },
  quickRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 6,
    marginTop: 8,
  },
  quickBtn: {
    padding: '10px 4px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 38,
  },
  changeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    padding: '10px 12px',
    borderRadius: 8,
    background: 'var(--green-soft)',
    color: 'var(--green)',
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  shortRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    padding: '10px 12px',
    borderRadius: 8,
    background: 'var(--red-soft)',
    color: 'var(--red)',
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  refRow: {
    marginTop: 4,
  },
  refInput: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1.5px solid var(--border)',
    background: 'var(--bg2)',
    fontSize: 13,
    color: 'var(--text1)',
    outline: 'none',
    fontFamily: 'inherit',
  },
  splitList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 10,
  },
  splitRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 10,
    alignItems: 'center',
    padding: '8px 10px',
    background: 'var(--bg)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
  },
  ghostBtn: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    fontFamily: 'inherit',
    minHeight: 42,
    textAlign: 'left',
  },
  dangerBtn: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--red)',
    fontSize: 13,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    cursor: 'pointer',
    border: '1px solid rgba(196,80,64,0.25)',
    fontFamily: 'inherit',
    minHeight: 42,
  },
  errBanner: {
    background: 'rgba(196,80,64,0.08)',
    color: 'var(--red)',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
  },
  loadingState: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    color: 'var(--text2)',
  },

  // ─── Payment modal (the "new pestaña" — overlays the workspace)
  payScrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 70,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  payModal: {
    width: 560,
    maxWidth: '100%',
    maxHeight: '92vh',
    background: 'var(--bg)',
    borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  payHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
    flexShrink: 0,
  },
  payBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px 20px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
};

const itemRowStyle = (
  isNew: boolean,
  isVoided: boolean,
  isEditable: boolean,
): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: '92px 1fr auto',
  gap: 10,
  padding: '12px 20px',
  borderBottom: '1px solid rgba(44,36,32,0.05)',
  background: isVoided
    ? 'rgba(196,80,64,0.05)'
    : isNew
      ? 'rgba(201,164,92,0.08)'
      : 'transparent',
  alignItems: 'center',
  // Editable rows get a subtle hover affordance — the row itself is a tap
  // target that opens the picker pre-filled. Voided rows are read-only.
  cursor: isEditable ? 'pointer' : 'default',
  opacity: isVoided ? 0.7 : 1,
  transition: 'background 0.12s',
});

// Strike-through container for voided items. Applied to the inner block so
// the qty stepper / restore button stay visually intact and clickable.
const voidedTextStyle: React.CSSProperties = {
  textDecoration: 'line-through',
  textDecorationColor: 'var(--red)',
  color: 'var(--text2)',
};

// Compact "Add note / Edit note" pill rendered under each ticket row. We use
// a different visual treatment depending on whether the item already has a
// note so the cashier can spot at-a-glance which items have a special
// instruction attached.
const noteBtnStyle = (hasNote: boolean): React.CSSProperties => ({
  marginTop: 6,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px dashed ' + (hasNote ? 'var(--gold)' : 'var(--border)'),
  background: hasNote ? 'var(--gold-soft)' : 'transparent',
  color: hasNote ? 'var(--text1)' : 'var(--text2)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
});

const itemBadgeStyle = (variant: 'new' | 'sent' | 'voided'): React.CSSProperties => {
  const colors = {
    new: { fg: 'var(--gold)', bg: 'var(--gold-soft)' },
    sent: { fg: 'var(--green)', bg: 'rgba(74,140,92,0.14)' },
    voided: { fg: 'var(--red)', bg: 'rgba(196,80,64,0.12)' },
  } as const;
  const c = colors[variant];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '2px 6px',
    borderRadius: 4,
    color: c.fg,
    background: c.bg,
  };
};

const restoreBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid var(--green)',
  background: 'rgba(74,140,92,0.10)',
  color: 'var(--green)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const sendBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '14px 18px',
  borderRadius: 10,
  background: disabled ? 'var(--bg)' : 'var(--text1)',
  color: disabled ? 'var(--text3)' : '#fff',
  fontSize: 14,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid ' + (disabled ? 'var(--border)' : 'var(--text1)'),
  fontFamily: 'inherit',
  minHeight: 50,
});

const payMethodStyle = (active: boolean): React.CSSProperties => ({
  padding: '12px 10px',
  borderRadius: 10,
  border: '1.5px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text1)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'inherit',
  minHeight: 56,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
});

const primaryBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '14px 18px',
  borderRadius: 10,
  background: disabled ? 'var(--bg)' : 'var(--gold)',
  color: disabled ? 'var(--text3)' : '#2c2420',
  fontSize: 15,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid ' + (disabled ? 'var(--border)' : 'rgba(44,36,32,0.08)'),
  fontFamily: 'inherit',
  minHeight: 52,
});

// "Pay Order" CTA in the ticket sidebar footer. Green to mirror the OrderRow
// button colour that signals "ready to settle".
const payOrderBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '14px 18px',
  borderRadius: 10,
  background: disabled ? 'var(--bg)' : 'var(--green)',
  color: disabled ? 'var(--text3)' : '#fff',
  fontSize: 15,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid ' + (disabled ? 'var(--border)' : 'var(--green)'),
  fontFamily: 'inherit',
  minHeight: 52,
});

const catTabStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  color: active ? '#fff' : 'var(--text2)',
  background: active ? 'var(--text1)' : 'var(--bg2)',
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  cursor: 'pointer',
  minHeight: 40,
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
  flexShrink: 0,
});

interface ItemDisplay {
  raw: ActiveOrderItem;
  isNew: boolean;
  isSent: boolean;
  isVoided: boolean;
}

// Bucket the items into "already sent" + "newly added since last send" + the
// soft-deleted ("voided") tombstones. Used only for the visual badges on each
// row — the SEND TO KITCHEN button always targets unsent + newly-voided items
// regardless of grouping.
function bucketItems(items: ActiveOrderItem[]): ItemDisplay[] {
  return items.map((item) => ({
    raw: item,
    isVoided: item.voided_at != null,
    isNew: !item.sent_to_kitchen && item.voided_at == null,
    isSent: item.sent_to_kitchen && item.voided_at == null,
  }));
}

interface SplitPaymentDraft {
  id: string;
  method: PaymentMethodType;
  amount: number;
  reference: string;
}

// Pending action that needs a PIN before it fires. Captures the user-visible
// label so the modal can show what's about to happen.
type PinPromptAction =
  | { kind: 'remove'; itemId: string; itemName: string }
  | { kind: 'updateQty'; itemId: string; itemName: string; nextQty: number }
  | { kind: 'restore'; itemId: string; itemName: string };

// Item edit/remove is open to all order-writers; the backend gates *sent*
// items behind a cashier-PIN authorization, surfaced here via the PIN modal.
// Pay is cashier-only — waiters never see "Pay Order" / "Apply discount".
const ROLES_THAT_PAY: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

export function TableDetail() {
  const queryClient = useQueryClient();
  const orderId = useUi((s) => s.detailOrderId);
  const closeDetail = useUi((s) => s.closeOrderDetail);
  const setView = useUi((s) => s.setView);
  const pendingPaymentForOrderId = useUi((s) => s.pendingPaymentForOrderId);
  const consumePendingPayment = useUi((s) => s.consumePendingPayment);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  // Anyone in the room can pull items off the ticket — the *backend* asks for
  // a cashier PIN when the line was already sent to the kitchen.
  const canRemove = true;
  const canPay = ROLES_THAT_PAY.has(role);

  // ─── Order data (real-time enough for kitchen flow) ──────────────
  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => fetchOrder(orderId!),
    enabled: !!orderId,
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
  });

  // ─── Catalogue (rarely changes during a shift, fetch once) ───────
  const categoriesQuery = useQuery({
    queryKey: ['categories', 'visible'],
    queryFn: fetchAllCategories,
    staleTime: 5 * 60_000,
  });
  const productsQuery = useQuery({
    queryKey: ['products', 'pos'],
    queryFn: fetchAllProducts,
    staleTime: 5 * 60_000,
  });

  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState('');
  const [pickerProduct, setPickerProduct] = useState<PosProduct | null>(null);
  // Edit-mode target: when set, the ProductPicker opens with this item's
  // current variant + modifiers + notes pre-selected and saves via
  // updateOrderItem instead of addOrderItem. Only allowed for unsent rows.
  const [editingItem, setEditingItem] = useState<ActiveOrderItem | null>(null);

  // ─── Mutations ───────────────────────────────────────────────────
  function invalidateOrder() {
    queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
    queryClient.invalidateQueries({ queryKey: ['floors'] });
  }

  const addItemMutation = useMutation({
    mutationFn: (input: AddOrderItemInput) => addOrderItem(orderId!, input),
    onSuccess: () => {
      invalidateOrder();
      setPickerProduct(null);
    },
  });
  const updateItemMutation = useMutation({
    mutationFn: ({
      itemId,
      input,
    }: {
      itemId: string;
      input: {
        quantity?: number;
        notes?: string | null;
        variant_id?: string | null;
        modifier_ids?: string[];
        pin?: string;
      };
    }) => updateOrderItem(orderId!, itemId, input),
    onSuccess: () => {
      invalidateOrder();
      setPinPrompt(null);
    },
  });
  const removeItemMutation = useMutation({
    mutationFn: ({ itemId, pin }: { itemId: string; pin?: string }) =>
      removeOrderItem(orderId!, itemId, { pin }),
    onSuccess: () => {
      invalidateOrder();
      setPinPrompt(null);
    },
  });
  const restoreItemMutation = useMutation({
    mutationFn: ({ itemId, pin }: { itemId: string; pin?: string }) =>
      restoreOrderItem(orderId!, itemId, { pin }),
    onSuccess: () => {
      invalidateOrder();
      setPinPrompt(null);
    },
  });
  const sendKitchenMutation = useMutation({
    mutationFn: () => sendOrderToKitchen(orderId!),
    onSuccess: async (result) => {
      invalidateOrder();
      // Fire the kitchen printer in the background — the order screen has
      // already updated, so we don't await it. Failures from the IPC are
      // surfaced via a toast in a future iteration; for now we rely on the
      // backend's authoritative state ("sent_at" is set regardless of paper).
      if (window.electron?.printer && result.printed_count > 0) {
        try {
          await window.electron.printer.printKitchen({
            order_id: result.order_id,
            order_number: result.order.order_number,
            table:
              result.order.order_type === 'TAKEOUT'
                ? `Takeout #${result.order.order_number}`
                : result.order.table
                  ? `Table ${result.order.table.number}`
                  : null,
            waiter: result.order.user.name,
            printed_at: result.printed_at,
            is_correction: result.is_correction,
            items: result.items,
            voided_items: result.voided_items,
          });
        } catch {
          /* IPC bridge is stubbed in dev; ignore and let the order data drive UI */
        }
      }
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (input: { reason: string; pin: string }) =>
      cancelOrder(orderId!, input),
    onSuccess: () => {
      invalidateOrder();
      setCancelOpen(false);
      closeDetail();
    },
  });
  const discountMutation = useMutation({
    mutationFn: ({ amount, reason }: { amount: number; reason: string | null }) =>
      updateOrder(orderId!, {
        discount_amount: amount,
        discount_reason: reason,
      }),
    onSuccess: invalidateOrder,
  });
  const paymentMutation = useMutation({
    mutationFn: (input: CreatePaymentInput) => addOrderPayment(orderId!, input),
  });

  // ─── Derived state ───────────────────────────────────────────────
  const order: ActiveOrder | undefined = orderQuery.data;

  const products = productsQuery.data ?? [];
  const categories: ProductCategory[] = categoriesQuery.data ?? [];

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCat !== ALL_CATEGORIES && p.category_id !== activeCat) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      );
    });
  }, [products, activeCat, search]);

  const ticketBuckets = useMemo(() => bucketItems(order?.items ?? []), [order?.items]);
  // hasUnsent drives the Send to Kitchen button visibility. Voided lines that
  // need their REMOVE notification printed also justify a send, so they count
  // here even though they're not "new" items in the additive sense.
  const hasUnsent = ticketBuckets.some(
    (it) => it.isNew || (it.isVoided && it.raw.void_printed_at == null),
  );

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('CASH');
  const [amountInput, setAmountInput] = useState<string>('');
  const [reference, setReference] = useState('');
  const [splitPayments, setSplitPayments] = useState<SplitPaymentDraft[]>([]);
  const [splitMode, setSplitMode] = useState(false);
  // Payment is its own pestaña now — opens as a fullscreen modal so the
  // build-the-ticket workflow stays focused on the menu + sidebar. Closing the
  // modal returns to the workspace; settling fully closes the whole detail.
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  // Snapshot of the just-paid order so the payment modal can stay mounted on
  // a print failure (the live order has already flipped to PAID, which would
  // otherwise unmount the modal and lose the retry option).
  const [paidOrder, setPaidOrder] = useState<ActiveOrder | null>(null);
  // The order item currently being edited in the note dialog. Null means
  // the dialog is closed; an item snapshot keeps the original note around so
  // the textarea can pre-populate without a useEffect dance.
  const [noteEditing, setNoteEditing] = useState<ActiveOrderItem | null>(null);
  // Cancel-order modal: gated behind reason + PIN re-auth so the audit trail
  // captures who pulled the trigger and why.
  const [cancelOpen, setCancelOpen] = useState(false);
  // PIN-gate for changes to items already sent to kitchen — the action stays
  // pending in `pinPrompt` until the cashier (re-)enters their PIN, at which
  // point we replay the action with the PIN attached.
  const [pinPrompt, setPinPrompt] = useState<PinPromptAction | null>(null);

  // Reset payment fields when switching to a different order so a stale
  // amount from the previous ticket doesn't carry over.
  useEffect(() => {
    setAmountInput('');
    setReference('');
    setSplitPayments([]);
    setSplitMode(false);
    setPaymentMethod('CASH');
    setPaymentOpen(false);
    setPrintError(null);
    setPaidOrder(null);
    setNoteEditing(null);
    setEditingItem(null);
  }, [orderId]);

  // When the cashier hits "Pay Order" from the active orders list, the UI
  // store flags this order to auto-open the payment modal on arrival. Only
  // honour it once and only if there's actually something to pay (the modal
  // would otherwise render disabled).
  useEffect(() => {
    if (!orderId || pendingPaymentForOrderId !== orderId) return;
    if (!order || order.status !== 'OPEN' || !canPay || order.items.length === 0) return;
    setPaymentOpen(true);
    consumePendingPayment();
  }, [orderId, pendingPaymentForOrderId, order, canPay, consumePendingPayment]);

  // Escape returns to the order list. Skipped when the user is typing in an
  // input/textarea or when a modal (product picker, confirm dialog) is open —
  // those handle their own keyboard events.
  useEffect(() => {
    if (!orderId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (pickerProduct) return;
      // After a settled-but-unprinted payment the modal is gated by paidOrder,
      // not paymentOpen — Escape there means "give up on the receipt and
      // exit the detail" since the order is already paid on the backend.
      if (paidOrder) {
        e.preventDefault();
        setPaidOrder(null);
        closeDetail();
        return;
      }
      // Payment modal owns Escape while it's up — close it first, then a
      // second Escape exits the detail.
      if (paymentOpen) {
        e.preventDefault();
        setPaymentOpen(false);
        return;
      }
      // Avoid stealing Escape from the ConfirmDialog, which has its own
      // listener at z-index 80 — its dialog overlays this page.
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderId, pickerProduct, paymentOpen, paidOrder, closeDetail]);

  // ─── Early states ────────────────────────────────────────────────
  if (!orderId) {
    return (
      <div style={styles.shell}>
        <header style={styles.head}>
          <button type="button" style={styles.back} onClick={() => setView('orders')}>
            ‹ Back
          </button>
        </header>
        <div style={styles.loadingState}>No order selected.</div>
      </div>
    );
  }

  if (orderQuery.isLoading) {
    return (
      <div style={styles.shell}>
        <header style={styles.head}>
          <button type="button" style={styles.back} onClick={closeDetail}>
            ‹ Back
          </button>
        </header>
        <div style={styles.loadingState}>
          <Spinner size={26} />
          <div>Loading order…</div>
        </div>
      </div>
    );
  }

  if (orderQuery.error || !order) {
    const msg =
      orderQuery.error instanceof ApiError
        ? orderQuery.error.message
        : 'Order not found.';
    return (
      <div style={styles.shell}>
        <header style={styles.head}>
          <button type="button" style={styles.back} onClick={closeDetail}>
            ‹ Back
          </button>
        </header>
        <div style={styles.loadingState}>
          <div style={{ color: 'var(--red)' }}>{msg}</div>
        </div>
      </div>
    );
  }

  // ─── Header values ───────────────────────────────────────────────
  const tableLabel =
    order.order_type === 'TAKEOUT'
      ? `Takeout #${order.order_number}`
      : order.table
        ? `Table ${order.table.number}`
        : `Order #${order.order_number}`;
  const zoneLabel =
    order.order_type === 'TAKEOUT'
      ? order.takeout_channel
        ? TAKEOUT_CHANNEL_LABEL[order.takeout_channel]
        : 'Takeout'
      : order.table?.zone.name ?? '—';
  const elapsed = formatElapsed(minutesSince(order.created_at));
  // Ticket header counts only non-voided lines so the "X items" matches what
  // the customer is paying for (voided lines are tombstones, not active).
  const itemCount = order.items
    .filter((i) => i.voided_at == null)
    .reduce((acc, i) => acc + i.quantity, 0);

  // Already-recorded payments live on the order — combine them with any
  // queued split tenders the cashier hasn't submitted yet to compute the
  // running balance shown in the right column.
  const recordedPaid = order.payments.reduce(
    (acc, p) => acc + (Number(p.amount) - Number(p.change_amount)),
    0,
  );
  const stagedPaid = splitMode
    ? splitPayments.reduce((acc, p) => acc + p.amount, 0)
    : 0;
  const total = Number(order.total);
  const remaining = Math.max(0, total - recordedPaid - stagedPaid);
  const amountCentavos = parseAmountToCentavos(amountInput);
  const currentTender = splitMode ? amountCentavos : amountCentavos || remaining;
  const change =
    paymentMethod === 'CASH' && currentTender > remaining
      ? currentTender - remaining
      : 0;
  const short =
    paymentMethod === 'CASH' && currentTender > 0 && currentTender < remaining
      ? remaining - currentTender
      : 0;

  // ─── Helpers ─────────────────────────────────────────────────────
  function handleProductTap(p: PosProduct) {
    const hasVariants = p.variants.some((v) => v.active);
    const hasModifierGroups = p.modifier_groups.some((link) =>
      link.modifier_group.modifiers.some((m) => m.active),
    );
    if (hasVariants || hasModifierGroups) {
      setPickerProduct(p);
      return;
    }
    addItemMutation.mutate({ product_id: p.id, quantity: 1 });
  }

  // Tap an unsent ticket row to re-open the picker pre-filled with the line's
  // current variant + modifiers + notes. Sent items are read-only here — the
  // qty/note/remove flows already gate them behind a cashier PIN. Voided items
  // need to be Restored first; that happens via the row's Restore button.
  function handleTicketRowTap(item: ActiveOrderItem) {
    if (item.voided_at != null) return;
    if (item.sent_to_kitchen) return;
    const product = products.find((p) => p.id === item.product_id);
    if (!product) return;
    const hasVariants = product.variants.some((v) => v.active);
    const hasModifierGroups = product.modifier_groups.some((link) =>
      link.modifier_group.modifiers.some((m) => m.active),
    );
    // Plain products with no variants / modifiers have nothing to edit beyond
    // the qty stepper and the Note dialog — no picker is needed.
    if (!hasVariants && !hasModifierGroups) return;
    setEditingItem(item);
  }

  function editingProduct(): PosProduct | null {
    if (!editingItem) return null;
    return products.find((p) => p.id === editingItem.product_id) ?? null;
  }

  function handleQty(item: ActiveOrderItem, delta: number) {
    if (item.voided_at != null) return;
    const next = item.quantity + delta;
    const itemName =
      item.product.name + (item.variant ? ` · ${item.variant.name}` : '');
    if (next <= 0) {
      if (!canRemove) return;
      if (item.sent_to_kitchen) {
        setPinPrompt({ kind: 'remove', itemId: item.id, itemName });
        return;
      }
      removeItemMutation.mutate({ itemId: item.id });
      return;
    }
    if (item.sent_to_kitchen) {
      setPinPrompt({
        kind: 'updateQty',
        itemId: item.id,
        itemName,
        nextQty: next,
      });
      return;
    }
    updateItemMutation.mutate({ itemId: item.id, input: { quantity: next } });
  }

  function handleRemoveItem(item: ActiveOrderItem) {
    if (!canRemove) return;
    if (item.voided_at != null) return;
    const itemName =
      item.product.name + (item.variant ? ` · ${item.variant.name}` : '');
    if (item.sent_to_kitchen) {
      setPinPrompt({ kind: 'remove', itemId: item.id, itemName });
      return;
    }
    removeItemMutation.mutate({ itemId: item.id });
  }

  function handlePinConfirm(pin: string) {
    if (!pinPrompt) return;
    if (pinPrompt.kind === 'remove') {
      removeItemMutation.mutate({ itemId: pinPrompt.itemId, pin });
    } else if (pinPrompt.kind === 'restore') {
      restoreItemMutation.mutate({ itemId: pinPrompt.itemId, pin });
    } else {
      updateItemMutation.mutate({
        itemId: pinPrompt.itemId,
        input: { quantity: pinPrompt.nextQty, pin },
      });
    }
  }

  function handleRestoreItem(item: ActiveOrderItem) {
    const itemName =
      item.product.name + (item.variant ? ` · ${item.variant.name}` : '');
    setPinPrompt({ kind: 'restore', itemId: item.id, itemName });
  }

  // Cancel-order entry point. Three branches:
  //  1. Order has any sent_to_kitchen line → open the cashier-approval modal
  //     (reason + cashier PIN). Backend will reject without both.
  //  2. Order is empty or only has unsent lines → cheap path, simple confirm,
  //     no PIN; works for waiters too.
  async function handleCancelOrderClick() {
    if (!order || cancelMutation.isPending) return;
    const hasSent = order.items.some((i) => i.sent_to_kitchen);
    if (hasSent) {
      setCancelOpen(true);
      return;
    }
    const ok = await confirmDialog({
      title: `Cancel ${tableLabel}?`,
      message:
        order.items.length === 0
          ? 'The empty ticket will be voided and the table released.'
          : 'No items have been sent to the kitchen yet, so this can be cancelled freely. Continue?',
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
      danger: true,
    });
    if (ok) cancelMutation.mutate({ reason: '', pin: '' });
  }

  function pinPromptError(): string | null {
    const err =
      pinPrompt?.kind === 'remove'
        ? removeItemMutation.error
        : pinPrompt?.kind === 'restore'
          ? restoreItemMutation.error
          : updateItemMutation.error;
    if (err instanceof ApiError) return err.message;
    if (err) return 'Action failed';
    return null;
  }

  // Print the receipt for a given order snapshot. Used for the manual
  // "Print Ticket" courtesy reprint AND for the auto-print after payment —
  // both paths surface failures via the inline `printError` banner so the
  // cashier always sees what happened. Returns true on success so the
  // payment-success path can decide whether to close the detail.
  async function printReceiptFor(target: ActiveOrder): Promise<boolean> {
    if (!window.electron?.printer) {
      setPrintError('Printing only works inside the desktop terminal.');
      return false;
    }
    setPrintError(null);
    setPrintingReceipt(true);
    try {
      const result = await window.electron.printer.printReceipt({ order: target });
      if (!result.ok) {
        setPrintError(translatePrintError(result.error));
        return false;
      }
      return true;
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Print failed.');
      return false;
    } finally {
      setPrintingReceipt(false);
    }
  }

  function handlePrintReceipt() {
    if (!order) return;
    void printReceiptFor(order);
  }

  async function handleApplyDiscount() {
    if (!order) return;
    if (order.discount_amount && Number(order.discount_amount) > 0) {
      const ok = await confirmDialog({
        title: 'Remove discount?',
        message: `The current discount of ${formatMoney(order.discount_amount)} will be cleared.`,
        confirmLabel: 'Remove discount',
      });
      if (ok) discountMutation.mutate({ amount: 0, reason: null });
      return;
    }
    // The discount inputs stay on window.prompt for now — a richer numeric
    // pad is a candidate for a follow-up but two prompts aren't blocking.
    const raw = window.prompt('Discount amount in MXN (e.g., 25 for $25 off)', '0');
    if (raw === null) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      window.alert('Enter a positive number.');
      return;
    }
    const reason = window.prompt('Reason (optional)') ?? null;
    discountMutation.mutate({ amount: Math.round(value * 100), reason });
  }

  // Once payment is settled on the backend we always try to print the
  // receipt. If the print succeeds the detail closes (cashier moves on); if
  // it fails the modal stays open showing the error and a retry button so
  // the cashier knows the order is paid but the printer needs attention.
  async function finalizeSettled(settledOrder: ActiveOrder) {
    setPaidOrder(settledOrder);
    const printed = await printReceiptFor(settledOrder);
    if (printed) {
      setPaidOrder(null);
      closeDetail();
    }
  }

  async function submitSinglePayment() {
    if (!canPay || !order) return;
    if (order.items.length === 0) {
      window.alert('Add items before charging.');
      return;
    }
    let amount = currentTender;
    if (paymentMethod !== 'CASH' && amount !== remaining) {
      amount = remaining; // card/transfer must equal the remaining balance
    }
    if (amount <= 0) return;
    try {
      const result = await paymentMutation.mutateAsync({
        method: paymentMethod,
        amount,
        reference: paymentMethod === 'CASH' ? null : reference || null,
      });
      invalidateOrder();
      if (result.order.status === 'PAID') {
        await finalizeSettled(result.order);
      } else {
        // Partial cash tender — keep the screen open and clear the input so
        // the cashier can record the next portion of the split.
        setAmountInput('');
        setReference('');
      }
    } catch (err) {
      // Error is captured by paymentMutation.error and rendered inline.
      if (!(err instanceof ApiError)) throw err;
    }
  }

  async function submitSplitPayments() {
    if (!canPay || !orderId || splitPayments.length === 0) return;
    try {
      let lastResult: Awaited<ReturnType<typeof addOrderPayment>> | null = null;
      for (const draft of splitPayments) {
        lastResult = await addOrderPayment(orderId, {
          method: draft.method,
          amount: draft.amount,
          reference: draft.method === 'CASH' ? null : draft.reference || null,
        });
      }
      invalidateOrder();
      if (lastResult?.order.status === 'PAID') {
        await finalizeSettled(lastResult.order);
      } else {
        setSplitPayments([]);
        setSplitMode(false);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        window.alert(err.message);
      } else {
        throw err;
      }
    }
  }

  function queueSplitPayment() {
    if (currentTender <= 0) return;
    if (paymentMethod !== 'CASH' && currentTender !== remaining - stagedPaid) {
      window.alert('Card / Transfer payments in a split must equal the outstanding balance.');
      return;
    }
    setSplitPayments((prev) => [
      ...prev,
      {
        id: `${prev.length}-${Date.now()}`,
        method: paymentMethod,
        amount: currentTender,
        reference,
      },
    ]);
    setAmountInput('');
    setReference('');
  }

  function removeSplit(id: string) {
    setSplitPayments((prev) => prev.filter((p) => p.id !== id));
  }

  function handleQuickAmount(centavos: number | 'exact') {
    setAmountInput(
      centavos === 'exact'
        ? formatMoneyPlain(remaining)
        : formatMoneyPlain(centavos),
    );
  }

  const QUICK_AMOUNTS: Array<{ label: string; value: number | 'exact' }> = [
    { label: '$50', value: 5000 },
    { label: '$100', value: 10_000 },
    { label: '$200', value: 20_000 },
    { label: '$500', value: 50_000 },
    { label: 'Exact', value: 'exact' },
  ];

  const submitDisabled =
    !canPay ||
    paymentMutation.isPending ||
    order.items.length === 0 ||
    remaining <= 0 ||
    (splitMode
      ? splitPayments.length === 0
      : currentTender <= 0 ||
        (paymentMethod === 'CASH' && currentTender < remaining));

  return (
    <div style={styles.shell}>
      <header style={styles.head}>
        <button type="button" style={styles.back} onClick={closeDetail}>
          ‹ Back
        </button>
        <TableMark
          color={
            order.needs_attention
              ? 'var(--red)'
              : order.order_type === 'TAKEOUT'
                ? 'var(--text2)'
                : 'var(--gold)'
          }
          label={
            order.order_type === 'TAKEOUT'
              ? '#'
              : order.table
                ? String(order.table.number)
                : '?'
          }
        />
        <div style={styles.hTitleBlock}>
          <h1 style={styles.hTitle}>{tableLabel}</h1>
          <div style={styles.hMeta}>
            <span>{zoneLabel}</span>
            <span style={styles.metaSep} />
            <span>Order #{order.order_number}</span>
            <span style={styles.metaSep} />
            <span>Waiter: {order.user.name}</span>
            <span style={styles.metaSep} />
            <span>{order.status === 'OPEN' ? 'Open' : order.status}</span>
          </div>
        </div>
        <div style={styles.hSpacer} />
        <div style={styles.hStat}>
          <span style={styles.hStatLabel}>Elapsed</span>
          <span style={styles.hStatVal}>{elapsed}</span>
        </div>
        <div style={styles.hStat}>
          <span style={styles.hStatLabel}>Total</span>
          <span style={styles.hStatVal}>{formatMoney(order.total)}</span>
        </div>
      </header>

      <div style={styles.body}>
        {/* ───────── LEFT: ticket sidebar ───────── */}
        <section style={styles.ticketCol}>
          <div style={styles.ticketHead}>
            <h2 style={styles.ticketTitle}>Current Ticket</h2>
            <div style={styles.ticketSub}>
              {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
              {hasUnsent ? 'Some items not sent to kitchen' : 'All items sent'}
            </div>
          </div>

          {order.order_type === 'TAKEOUT' && (
            <div style={{ padding: '12px 20px 0' }}>
              <TakeoutCustomerPanel
                order={order}
                editable={order.status === 'OPEN'}
              />
            </div>
          )}

          <div style={styles.ticketBody}>
            {order.items.length === 0 ? (
              <div style={styles.emptyTicket}>
                Tap a product to start the ticket.
              </div>
            ) : (
              ticketBuckets.map((it) => {
                const product = it.isVoided
                  ? null
                  : products.find((p) => p.id === it.raw.product_id);
                const editable =
                  !it.isVoided &&
                  !it.isSent &&
                  product != null &&
                  (product.variants.some((v) => v.active) ||
                    product.modifier_groups.some((link) =>
                      link.modifier_group.modifiers.some((m) => m.active),
                    ));
                return (
                  <div
                    key={it.raw.id}
                    style={itemRowStyle(it.isNew, it.isVoided, editable)}
                    onClick={editable ? () => handleTicketRowTap(it.raw) : undefined}
                    role={editable ? 'button' : undefined}
                    aria-label={
                      editable
                        ? `Edit ${it.raw.product.name}`
                        : undefined
                    }
                  >
                    {/* Qty stepper hides for voided rows — they're frozen
                        snapshots of what was sent before the void. */}
                    {it.isVoided ? (
                      <div
                        style={{
                          ...styles.qtyVal,
                          textAlign: 'center',
                          ...voidedTextStyle,
                        }}
                      >
                        {it.raw.quantity}×
                      </div>
                    ) : (
                      <div style={styles.qtyControls} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          style={styles.qtyBtn}
                          onClick={() => handleQty(it.raw, -1)}
                          disabled={it.isSent && !canRemove}
                        >
                          –
                        </button>
                        <span style={styles.qtyVal}>{it.raw.quantity}</span>
                        <button
                          type="button"
                          style={styles.qtyBtn}
                          onClick={() => handleQty(it.raw, +1)}
                        >
                          +
                        </button>
                      </div>
                    )}
                    <div style={styles.itemBlock}>
                      <div style={styles.itemHeader}>
                        <span
                          style={{
                            ...styles.itemName,
                            ...(it.isVoided ? voidedTextStyle : {}),
                          }}
                        >
                          {it.raw.product.name}
                          {it.raw.variant && ` · ${it.raw.variant.name}`}
                        </span>
                        {it.isVoided ? (
                          <span style={itemBadgeStyle('voided')}>
                            ✕ Removed
                            {it.raw.void_printed_at ? ' · sent' : ''}
                          </span>
                        ) : it.isSent ? (
                          <span style={itemBadgeStyle('sent')}>✓ Sent</span>
                        ) : (
                          <span style={itemBadgeStyle('new')}>New</span>
                        )}
                      </div>
                      {it.raw.modifiers.length > 0 && (
                        <div
                          style={{
                            ...styles.itemMods,
                            ...(it.isVoided ? voidedTextStyle : {}),
                          }}
                        >
                          {it.raw.modifiers.map((m) => m.name).join(' · ')}
                        </div>
                      )}
                      {it.raw.notes && (
                        <div
                          style={{
                            ...styles.itemNote,
                            ...(it.isVoided ? voidedTextStyle : {}),
                          }}
                        >
                          Note: {it.raw.notes}
                        </div>
                      )}
                      {it.isVoided && it.raw.void_reason && (
                        <div style={{ ...styles.itemNote, color: 'var(--red)' }}>
                          Reason: {it.raw.void_reason}
                        </div>
                      )}
                      {!it.isVoided && (
                        <button
                          type="button"
                          style={noteBtnStyle(Boolean(it.raw.notes))}
                          onClick={(e) => {
                            e.stopPropagation();
                            setNoteEditing(it.raw);
                          }}
                          aria-label={it.raw.notes ? 'Edit note' : 'Add note'}
                        >
                          {it.raw.notes ? '✎ Edit note' : '＋ Add note'}
                        </button>
                      )}
                    </div>
                    <div style={styles.itemPriceCol} onClick={(e) => e.stopPropagation()}>
                      <span
                        style={{
                          ...styles.itemPrice,
                          ...(it.isVoided ? voidedTextStyle : {}),
                        }}
                      >
                        {formatMoney(it.raw.line_total)}
                      </span>
                      {it.isVoided ? (
                        <button
                          type="button"
                          style={restoreBtnStyle}
                          onClick={() => handleRestoreItem(it.raw)}
                          disabled={restoreItemMutation.isPending}
                          aria-label="Restore item"
                        >
                          ↺ Restore
                        </button>
                      ) : (
                        canRemove && (
                          <button
                            type="button"
                            style={styles.removeBtn}
                            onClick={async () => {
                              if (it.isSent) {
                                handleRemoveItem(it.raw);
                                return;
                              }
                              const ok = await confirmDialog({
                                title: 'Remove item?',
                                message: `${it.raw.product.name} will be removed from the ticket.`,
                                confirmLabel: 'Remove',
                                danger: true,
                              });
                              if (ok) handleRemoveItem(it.raw);
                            }}
                            aria-label="Remove item"
                          >
                            <IconClose style={{ fontSize: 14 }} />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {(addItemMutation.error ||
              updateItemMutation.error ||
              removeItemMutation.error ||
              restoreItemMutation.error) && (
              <div style={{ ...styles.errBanner, margin: '12px 20px' }}>
                {firstApiMessage(
                  addItemMutation.error,
                  updateItemMutation.error,
                  removeItemMutation.error,
                  restoreItemMutation.error,
                ) ?? 'Could not update the ticket'}
              </div>
            )}
          </div>

          {/* Footer: totals + every action the cashier needs */}
          <div style={styles.ticketFoot}>
            <div style={styles.totalsRow}>
              <span>Subtotal</span>
              <span style={styles.totalsAmt}>{formatMoney(order.subtotal)}</span>
              <span>Tax</span>
              <span style={styles.totalsAmt}>{formatMoney(order.tax_amount)}</span>
              {Number(order.discount_amount) > 0 && (
                <>
                  <span>Discount</span>
                  <span style={{ ...styles.totalsAmt, color: 'var(--red)' }}>
                    – {formatMoney(order.discount_amount)}
                  </span>
                </>
              )}
              <span style={styles.grandLabel}>Total</span>
              <span style={styles.grandAmt}>{formatMoney(order.total)}</span>
              {recordedPaid > 0 && (
                <>
                  <span>Paid</span>
                  <span style={styles.totalsAmt}>{formatMoney(String(recordedPaid))}</span>
                  <span>Remaining</span>
                  <span style={{ ...styles.totalsAmt, color: 'var(--gold)' }}>
                    {formatMoney(String(remaining))}
                  </span>
                </>
              )}
            </div>

            {canPay && order.status === 'OPEN' && (
              <button
                type="button"
                style={styles.ghostBtn}
                onClick={handleApplyDiscount}
                disabled={discountMutation.isPending}
              >
                <IconPercent style={{ fontSize: 16 }} />
                <span>
                  {Number(order.discount_amount) > 0
                    ? `Discount: ${formatMoney(order.discount_amount)} — tap to clear`
                    : 'Apply discount'}
                </span>
              </button>
            )}

            {sendKitchenMutation.error && (
              <div style={styles.errBanner}>
                {sendKitchenMutation.error instanceof ApiError
                  ? sendKitchenMutation.error.message
                  : 'Send to kitchen failed'}
              </div>
            )}

            {hasUnsent && (
              <button
                type="button"
                style={sendBtnStyle(sendKitchenMutation.isPending)}
                disabled={sendKitchenMutation.isPending}
                onClick={() => sendKitchenMutation.mutate()}
              >
                {sendKitchenMutation.isPending ? (
                  <Spinner size={14} />
                ) : (
                  <IconPrinter style={{ fontSize: 18 }} />
                )}
                Send to Kitchen
              </button>
            )}

            {order.status === 'OPEN' && canPay && order.items.length > 0 && (
              <button
                type="button"
                style={payOrderBtnStyle(false)}
                onClick={() => setPaymentOpen(true)}
              >
                <IconCash style={{ fontSize: 18 }} />
                Pay Order · {formatMoney(String(remaining))}
              </button>
            )}

            <button
              type="button"
              style={styles.ghostBtn}
              onClick={handlePrintReceipt}
              disabled={printingReceipt || order.items.length === 0}
            >
              {printingReceipt ? (
                <Spinner size={12} />
              ) : (
                <IconPrinter style={{ fontSize: 16 }} />
              )}
              <span>Print Ticket</span>
            </button>
            {printError && <div style={styles.errBanner}>{printError}</div>}

            {order.status === 'OPEN' && (
              <button
                type="button"
                style={styles.dangerBtn}
                onClick={handleCancelOrderClick}
                disabled={cancelMutation.isPending}
              >
                <IconClose style={{ fontSize: 16 }} />
                <span>Cancel order</span>
              </button>
            )}
            {cancelMutation.error && !cancelOpen && (
              <div style={styles.errBanner}>
                {cancelMutation.error instanceof ApiError
                  ? cancelMutation.error.message
                  : 'Cancel failed'}
              </div>
            )}
          </div>
        </section>

        {/* ───────── RIGHT: menu ───────── */}
        <section style={styles.menuCol}>
          <div style={styles.catRow}>
            <button
              type="button"
              style={catTabStyle(activeCat === ALL_CATEGORIES)}
              onClick={() => setActiveCat(ALL_CATEGORIES)}
            >
              All
            </button>
            {categories
              .slice()
              .sort((a, b) => a.display_order - b.display_order)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  style={catTabStyle(activeCat === c.id)}
                  onClick={() => setActiveCat(c.id)}
                >
                  {c.name}
                </button>
              ))}
            <div style={styles.menuSearch}>
              <span style={{ color: 'var(--text3)', fontSize: 13 }}>⌕</span>
              <input
                style={styles.menuSearchInput}
                placeholder="Search products"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div style={styles.productGrid}>
            {productsQuery.isLoading && (
              <div style={styles.emptyMenu}>
                <Spinner size={18} />
                <div style={{ marginTop: 10 }}>Loading menu…</div>
              </div>
            )}
            {!productsQuery.isLoading && visibleProducts.length === 0 && (
              <div style={styles.emptyMenu}>
                {products.length === 0
                  ? 'No products available. Add some in the admin panel.'
                  : 'No products match the current filter.'}
              </div>
            )}
            {visibleProducts.map((p) => {
              const variants = p.variants.filter((v) => v.active);
              const priceLabel = variants.length > 0
                ? `from ${formatMoney(variants[0].sell_price)}`
                : p.sell_price != null
                  ? formatMoney(p.sell_price)
                  : '—';
              const priceFromVariant = variants.length > 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  style={styles.productCard}
                  onClick={() => handleProductTap(p)}
                >
                  <span style={styles.productName}>{p.name}</span>
                  {priceFromVariant && (
                    <span style={styles.productHint}>
                      {variants.length} size{variants.length === 1 ? '' : 's'}
                    </span>
                  )}
                  <div style={styles.productFoot}>
                    <span style={styles.productPrice}>{priceLabel}</span>
                    <span style={styles.productAdd}>+</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

      </div>

      {pickerProduct && (
        <ProductPicker
          product={pickerProduct}
          busy={addItemMutation.isPending}
          onClose={() => setPickerProduct(null)}
          onSubmit={({ variantId, modifierIds, notes }) =>
            addItemMutation.mutate({
              product_id: pickerProduct.id,
              variant_id: variantId,
              modifier_ids: modifierIds,
              quantity: 1,
              notes: notes ?? undefined,
            })
          }
        />
      )}

      {/* Tap-to-edit on an unsent ticket row reuses the ProductPicker but
          pre-fills the line's current variant + modifiers + notes. Saving
          calls updateOrderItem which re-prices and replaces the modifier set
          server-side. Sent rows can't reach this modal — the click handler
          short-circuits before opening it. */}
      {editingItem && editingProduct() && (
        <ProductPicker
          product={editingProduct()!}
          mode="edit"
          initial={{
            variantId: editingItem.variant_id,
            modifierIds: editingItem.modifiers.map((m) => m.modifier_id),
            notes: editingItem.notes,
          }}
          busy={updateItemMutation.isPending}
          onClose={() => setEditingItem(null)}
          onSubmit={({ variantId, modifierIds, notes }) =>
            updateItemMutation.mutate(
              {
                itemId: editingItem.id,
                input: {
                  variant_id: variantId,
                  modifier_ids: modifierIds,
                  notes: notes,
                },
              },
              { onSuccess: () => setEditingItem(null) },
            )
          }
        />
      )}

      {noteEditing && (
        <NoteDialog
          item={noteEditing}
          busy={updateItemMutation.isPending}
          onCancel={() => setNoteEditing(null)}
          onSave={(nextNote) => {
            updateItemMutation.mutate(
              { itemId: noteEditing.id, input: { notes: nextNote } },
              { onSuccess: () => setNoteEditing(null) },
            );
          }}
        />
      )}

      {/* Payment is its own pestaña now — fullscreen modal that overlays the
          workspace. Closing it returns to the ticket; settling fully closes
          the whole detail (the parent's submit handlers already do that).
          When `paidOrder` is set the order is already settled but the
          receipt didn't print — the modal stays mounted in a post-payment
          state offering retry / close. */}
      {((paymentOpen && order.status === 'OPEN') || paidOrder) && canPay && (
        <div
          style={styles.payScrim}
          onClick={() => {
            // When the order is paid the only way to leave is to acknowledge
            // and exit the detail; clicking the scrim shouldn't silently
            // dismiss the retry view.
            if (paidOrder) return;
            setPaymentOpen(false);
          }}
        >
          <div style={styles.payModal} onClick={(e) => e.stopPropagation()} role="dialog">
            <header style={styles.payHead}>
              <button
                type="button"
                style={styles.back}
                onClick={() => {
                  if (paidOrder) {
                    setPaidOrder(null);
                    closeDetail();
                  } else {
                    setPaymentOpen(false);
                  }
                }}
              >
                ‹ Back
              </button>
              <div style={styles.hTitleBlock}>
                <h2 style={styles.hTitle}>{paidOrder ? 'Order paid' : 'Payment'}</h2>
                <div style={styles.hMeta}>
                  <span>{tableLabel}</span>
                  <span style={styles.metaSep} />
                  <span>Order #{order.order_number}</span>
                </div>
              </div>
              <div style={styles.hSpacer} />
              <div style={styles.hStat}>
                <span style={styles.hStatLabel}>{paidOrder ? 'Paid' : 'To pay'}</span>
                <span style={styles.hStatVal}>
                  {formatMoney(paidOrder ? paidOrder.total : String(remaining))}
                </span>
              </div>
            </header>

            {paidOrder ? (
              <PostPaymentBody
                order={paidOrder}
                printError={printError}
                printing={printingReceipt}
                onRetry={async () => {
                  const ok = await printReceiptFor(paidOrder);
                  if (ok) {
                    setPaidOrder(null);
                    closeDetail();
                  }
                }}
                onSkip={() => {
                  setPaidOrder(null);
                  closeDetail();
                }}
              />
            ) : (
            <div style={styles.payBody}>
              <div style={styles.panel}>
                <div style={styles.panelHd}>
                  <span>Summary</span>
                </div>
                <div style={styles.totalsRow}>
                  <span>Subtotal</span>
                  <span style={styles.totalsAmt}>{formatMoney(order.subtotal)}</span>
                  <span>Tax</span>
                  <span style={styles.totalsAmt}>{formatMoney(order.tax_amount)}</span>
                  {Number(order.discount_amount) > 0 && (
                    <>
                      <span>Discount</span>
                      <span style={{ ...styles.totalsAmt, color: 'var(--red)' }}>
                        – {formatMoney(order.discount_amount)}
                      </span>
                    </>
                  )}
                  <span style={styles.grandLabel}>Total</span>
                  <span style={styles.grandAmt}>{formatMoney(order.total)}</span>
                  {recordedPaid > 0 && (
                    <>
                      <span>Paid</span>
                      <span style={styles.totalsAmt}>{formatMoney(String(recordedPaid))}</span>
                      <span>Remaining</span>
                      <span style={{ ...styles.totalsAmt, color: 'var(--gold)' }}>
                        {formatMoney(String(remaining))}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div style={styles.panel}>
                <div style={styles.panelHd}>
                  <span>Payment method</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSplitMode((v) => !v);
                      setAmountInput('');
                      setReference('');
                      if (splitMode) setSplitPayments([]);
                    }}
                    style={{
                      fontSize: 11,
                      color: splitMode ? 'var(--gold)' : 'var(--text3)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {splitMode ? '× Single' : '⇄ Split'}
                  </button>
                </div>

                <div style={styles.payMethods}>
                  {(['CASH', 'CARD', 'TRANSFER'] as PaymentMethodType[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      style={payMethodStyle(paymentMethod === m)}
                      onClick={() => {
                        setPaymentMethod(m);
                        setAmountInput('');
                      }}
                    >
                      <span>
                        {m === 'CASH' ? '💵' : m === 'CARD' ? '💳' : '⇆'}
                      </span>
                      <span>{m === 'CASH' ? 'Cash' : m === 'CARD' ? 'Card' : 'Transfer'}</span>
                    </button>
                  ))}
                </div>

                {splitMode && splitPayments.length > 0 && (
                  <div style={styles.splitList}>
                    {splitPayments.map((p) => (
                      <div key={p.id} style={styles.splitRow}>
                        <span>
                          {p.method === 'CASH'
                            ? 'Cash'
                            : p.method === 'CARD'
                              ? 'Card'
                              : 'Transfer'}
                        </span>
                        <span>{formatMoney(String(p.amount))}</span>
                        <button
                          type="button"
                          style={{
                            color: 'var(--red)',
                            fontSize: 16,
                            padding: '0 6px',
                            cursor: 'pointer',
                          }}
                          onClick={() => removeSplit(p.id)}
                          aria-label="Remove split"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {paymentMethod === 'CASH' ? (
                  <>
                    <input
                      inputMode="decimal"
                      style={styles.amountInput}
                      placeholder={
                        splitMode
                          ? 'Cash portion'
                          : `Amount tendered · min ${formatMoney(String(remaining))}`
                      }
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                    />
                    <div style={styles.quickRow}>
                      {QUICK_AMOUNTS.map((q) => (
                        <button
                          key={q.label}
                          type="button"
                          style={styles.quickBtn}
                          onClick={() => handleQuickAmount(q.value)}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                    {change > 0 && (
                      <div style={styles.changeRow}>
                        <span>Change</span>
                        <span>{formatMoney(String(change))}</span>
                      </div>
                    )}
                    {short > 0 && !splitMode && (
                      <div style={styles.shortRow}>
                        <span>Short</span>
                        <span>{formatMoney(String(short))}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      inputMode="decimal"
                      style={styles.amountInput}
                      placeholder={`Amount · ${formatMoney(String(remaining - stagedPaid))}`}
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      disabled={!splitMode}
                    />
                    <div style={styles.refRow}>
                      <input
                        style={styles.refInput}
                        placeholder="Reference (optional)"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                      />
                    </div>
                  </>
                )}

                {paymentMutation.error && (
                  <div style={{ ...styles.errBanner, marginTop: 12 }}>
                    {paymentMutation.error instanceof ApiError
                      ? paymentMutation.error.message
                      : 'Payment failed'}
                  </div>
                )}

                {splitMode ? (
                  <>
                    <button
                      type="button"
                      style={{ ...styles.ghostBtn, marginTop: 12 }}
                      onClick={queueSplitPayment}
                      disabled={currentTender <= 0}
                    >
                      + Add payment
                    </button>
                    <button
                      type="button"
                      style={{ ...primaryBtnStyle(splitPayments.length === 0), marginTop: 8 }}
                      onClick={submitSplitPayments}
                      disabled={splitPayments.length === 0 || paymentMutation.isPending}
                    >
                      Complete Payment ·{' '}
                      {formatMoney(String(splitPayments.reduce((a, p) => a + p.amount, 0)))}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    style={{ ...primaryBtnStyle(submitDisabled), marginTop: 12 }}
                    onClick={submitSinglePayment}
                    disabled={submitDisabled}
                  >
                    {paymentMutation.isPending ? (
                      <Spinner size={14} />
                    ) : (
                      `Complete Payment · ${formatMoney(String(remaining))}`
                    )}
                  </button>
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {cancelOpen && order && (
        <CancelOrderModal
          tableLabel={tableLabel}
          busy={cancelMutation.isPending}
          error={
            cancelMutation.error instanceof ApiError
              ? cancelMutation.error.message
              : cancelMutation.error
                ? 'Cancel failed'
                : null
          }
          onClose={() => {
            setCancelOpen(false);
            cancelMutation.reset();
          }}
          onConfirm={(reason, pin) => cancelMutation.mutate({ reason, pin })}
        />
      )}

      {pinPrompt && (
        <PinConfirmModal
          title={
            pinPrompt.kind === 'remove'
              ? 'Remove sent item?'
              : pinPrompt.kind === 'restore'
                ? 'Restore voided item?'
                : 'Change quantity?'
          }
          message={
            pinPrompt.kind === 'remove'
              ? `${pinPrompt.itemName} was already sent to the kitchen. Enter your PIN to remove it — the kitchen will be notified on the next ticket.`
              : pinPrompt.kind === 'restore'
                ? `Restore ${pinPrompt.itemName} to the order? Enter your PIN to confirm; if the kitchen was already told it was removed, you'll need to Send to Kitchen again.`
                : `${pinPrompt.itemName} was already sent to the kitchen. Enter your PIN to set quantity to ${pinPrompt.nextQty}.`
          }
          confirmLabel={
            pinPrompt.kind === 'remove'
              ? 'Remove item'
              : pinPrompt.kind === 'restore'
                ? 'Restore item'
                : 'Update quantity'
          }
          busy={
            pinPrompt.kind === 'remove'
              ? removeItemMutation.isPending
              : pinPrompt.kind === 'restore'
                ? restoreItemMutation.isPending
                : updateItemMutation.isPending
          }
          error={pinPromptError()}
          onClose={() => {
            setPinPrompt(null);
            removeItemMutation.reset();
            updateItemMutation.reset();
            restoreItemMutation.reset();
          }}
          onConfirm={handlePinConfirm}
        />
      )}
    </div>
  );
}

// Lightweight dialog for editing the note on an existing order item. Mounted
// above the ticket sidebar — the cashier taps the per-item note pill, enters
// or edits free-text instructions, and saves. Submitting an empty note clears
// it (we send `null` so the backend strips the field).
interface NoteDialogProps {
  item: ActiveOrderItem;
  busy: boolean;
  onCancel: () => void;
  onSave: (note: string | null) => void;
}

function NoteDialog({ item, busy, onCancel, onSave }: NoteDialogProps) {
  const [draft, setDraft] = useState(item.notes ?? '');

  // Esc cancels, Cmd/Ctrl+Enter saves — keyboard handling kept local so the
  // dialog can be reused without polluting the parent's listeners.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const trimmed = draft.trim();
        onSave(trimmed ? trimmed : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, onCancel, onSave]);

  const labelTitle = item.product.name + (item.variant ? ` · ${item.variant.name}` : '');
  const trimmed = draft.trim();
  const dirty = trimmed !== (item.notes ?? '').trim();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(44,36,32,0.42)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onCancel}
      role="dialog"
    >
      <div
        style={{
          width: 460,
          maxWidth: '100%',
          background: 'var(--bg2)',
          borderRadius: 16,
          border: '1px solid var(--border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid var(--border)' }}>
          <h2
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 20,
              fontWeight: 600,
              margin: 0,
              color: 'var(--text1)',
            }}
          >
            Note for {labelTitle}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
            Prints on the kitchen ticket and the customer receipt.
          </div>
        </div>
        <div style={{ padding: '16px 24px 20px' }}>
          <textarea
            autoFocus
            style={{
              width: '100%',
              minHeight: 96,
              padding: '12px 14px',
              border: '1.5px solid var(--border)',
              borderRadius: 10,
              background: 'var(--bg)',
              color: 'var(--text1)',
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical',
            }}
            placeholder="e.g., extra hot, no foam, no tomato, allergy info…"
            value={draft}
            maxLength={240}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 11,
              color: 'var(--text3)',
              marginTop: 6,
            }}
          >
            <span>Esc to cancel · Ctrl+Enter to save</span>
            <span>{draft.length}/240</span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 10,
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg)',
          }}
        >
          {item.notes && (
            <button
              type="button"
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: 'transparent',
                color: 'var(--red)',
                border: '1px solid rgba(196,80,64,0.25)',
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                minHeight: 44,
              }}
              disabled={busy}
              onClick={() => onSave(null)}
            >
              Remove note
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            style={{
              padding: '12px 16px',
              borderRadius: 10,
              background: 'var(--bg2)',
              color: 'var(--text1)',
              border: '1px solid var(--border)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              minHeight: 44,
            }}
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              padding: '12px 18px',
              borderRadius: 10,
              background: !dirty || busy ? 'var(--text3)' : 'var(--text1)',
              color: '#fff',
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: !dirty || busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              minHeight: 44,
              opacity: !dirty || busy ? 0.7 : 1,
            }}
            onClick={() => onSave(trimmed ? trimmed : null)}
            disabled={!dirty || busy}
          >
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Render the payment-modal body once the order has settled but the receipt
// hasn't printed. The order is already PAID on the backend, so the only
// actions left are: try the printer again, or accept that no slip will come
// out and exit. The summary mirrors the "before" layout so the cashier can
// double-check what was charged before walking away.
interface PostPaymentBodyProps {
  order: ActiveOrder;
  printError: string | null;
  printing: boolean;
  onRetry: () => void;
  onSkip: () => void;
}

function PostPaymentBody({
  order,
  printError,
  printing,
  onRetry,
  onSkip,
}: PostPaymentBodyProps) {
  const cashTotal = order.payments
    .filter((p) => p.method === 'CASH')
    .reduce((acc, p) => acc + Number(p.amount), 0);
  const changeTotal = order.payments.reduce(
    (acc, p) => acc + Number(p.change_amount),
    0,
  );
  return (
    <div style={styles.payBody}>
      <div style={styles.panel}>
        <div style={styles.panelHd}>
          <span>Payment recorded</span>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>✓ PAID</span>
        </div>
        <div style={styles.totalsRow}>
          <span>Total charged</span>
          <span style={styles.totalsAmt}>{formatMoney(order.total)}</span>
          {order.payments.map((p) => {
            const label = p.method === 'CASH' ? 'Cash' : p.method === 'CARD' ? 'Card' : 'Transfer';
            return (
              <Fragment key={p.id}>
                <span>{label}</span>
                <span style={styles.totalsAmt}>{formatMoney(p.amount)}</span>
              </Fragment>
            );
          })}
          {cashTotal > 0 && changeTotal > 0 && (
            <>
              <span>Change given</span>
              <span style={styles.totalsAmt}>{formatMoney(String(changeTotal))}</span>
            </>
          )}
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelHd}>
          <span>Receipt</span>
        </div>
        {printError ? (
          <div style={{ ...styles.errBanner, marginBottom: 12 }}>
            Receipt didn't print: {printError}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
            Print the customer receipt to close out this order.
          </div>
        )}
        <button
          type="button"
          style={{ ...primaryBtnStyle(printing), marginBottom: 8 }}
          onClick={onRetry}
          disabled={printing}
        >
          {printing ? <Spinner size={14} /> : '🖨'}
          {printing ? 'Printing receipt…' : printError ? 'Retry print receipt' : 'Print receipt'}
        </button>
        <button
          type="button"
          style={styles.ghostBtn}
          onClick={onSkip}
          disabled={printing}
        >
          <span>✓</span>
          <span>Done — close without printing</span>
        </button>
      </div>
    </div>
  );
}

// node-thermal-printer's failure messages are sometimes terse internal codes
// (e.g. the disabled-flag short-circuit returns 'receipt_printer_disabled').
// Translate the well-known ones into language the cashier can act on.
function translatePrintError(raw: string | undefined): string {
  if (!raw) return 'Receipt printer is offline.';
  if (raw === 'receipt_printer_disabled') {
    return 'Receipt printing is disabled — enable it in Settings · Printers.';
  }
  if (raw === 'kitchen_printer_disabled') {
    return 'Kitchen printing is disabled — enable it in Settings · Printers.';
  }
  return raw;
}

// Convert "$25.00" / "25" / "25.5" / etc. into integer centavos. Returns 0
// when the input is unparseable so the caller can rely on the sign comparison.
function parseAmountToCentavos(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const parts = cleaned.split('.');
  if (parts.length > 2) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

function firstApiMessage(...errs: unknown[]): string | null {
  for (const e of errs) {
    if (e instanceof ApiError) return e.message;
  }
  return null;
}

function TableMark({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        width: 52,
        height: 52,
        borderRadius: 12,
        background: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Playfair Display', serif",
        fontSize: 24,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}
