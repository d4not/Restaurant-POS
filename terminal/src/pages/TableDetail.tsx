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
  IconMore,
  IconPercent,
  IconPrinter,
} from '../components/Icons';
import { CancelOrderModal } from '../components/CancelOrderModal';
import { PinConfirmModal } from '../components/PinConfirmModal';
import { TakeoutCustomerPanel } from '../components/TakeoutCustomerPanel';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useHaptics } from '../hooks/useHaptics';
import { getBridge } from '../platform';
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
    gap: 14,
    padding: '8px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
    minHeight: 52,
    flexShrink: 0,
  },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 12px 7px 9px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    minHeight: 36,
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
    // Industry-standard layout: products dominate (left/center), ticket lives
    // in a wider right-side sidebar. Mirrors Toast/Square/Lightspeed and lands
    // the primary CTAs (Send / Pay) under the dominant hand on a tablet held
    // in landscape. Was '380px minmax(0,1fr)' (inverted) before.
    gridTemplateColumns: 'minmax(0, 1fr) 420px',
    gap: 0,
    overflow: 'hidden',
  },

  // ─── Left column (menu — pick products to add to the ticket).
  // gridColumn pins this section to track 1 regardless of DOM order — the JSX
  // is still ticket-first because it's a 2700-line component, but visually the
  // menu lands on the left where industry POS UX expects it.
  menuCol: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    background: 'var(--bg)',
    borderRight: '1px solid var(--border)',
    gridColumn: 1,
    gridRow: 1,
  },
  catRow: {
    display: 'flex',
    gap: 5,
    padding: '8px 14px',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto',
    flexShrink: 0,
    alignItems: 'center',
  },
  menuSearch: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 7,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    marginLeft: 'auto',
    minWidth: 180,
    minHeight: 36,
    flexShrink: 0,
  },
  menuSearchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 12,
    color: 'var(--text1)',
    flex: 1,
    fontFamily: 'inherit',
  },
  productGrid: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    // Bottom padding stacks normal padding + tablet safe-area so the last row
    // of tiles never sits under a gesture bar.
    padding: '10px 12px calc(16px + var(--safe-bottom))',
    display: 'grid',
    // Tighter grid (~5-6 cols at 640px wide) so the operator can scan more
    // products at once and the menu doesn't feel like a phone-style list.
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: 8,
    alignContent: 'start',
  },
  productCard: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 0,
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: 'var(--shadow-sm)',
    fontFamily: 'inherit',
    transition: 'transform 0.08s, border-color 0.12s',
    overflow: 'hidden',
  },
  // Image area dominates the tile (square aspect). Falls back to a flat
  // stripe colour when image_url is null — same hue as the category accent
  // so the menu still feels structured without an image library.
  productImageWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    background: 'var(--bg)',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  productImageFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'rgba(255,255,255,0.85)',
    fontFamily: "'Playfair Display', serif",
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  productSizeBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    padding: '1px 6px',
    borderRadius: 999,
    background: 'rgba(44,36,32,0.78)',
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  // Floating "+" affordance over the bottom-right corner of the tile so
  // cashiers (especially first-time waiters) read the card as "tap to add"
  // even though the whole card is the tap target. Mirrors the badge in the
  // user's reference layout.
  productAddBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: 6,
    background: 'var(--gold)',
    color: '#2c2420',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1,
    boxShadow: '0 2px 6px rgba(44,36,32,0.18)',
    pointerEvents: 'none',
  },
  productLabel: {
    padding: '5px 7px 7px',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  productName: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text1)',
    lineHeight: 1.25,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  productPrice: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
  },
  emptyMenu: {
    padding: 60,
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
    gridColumn: '1 / -1',
  },

  // ─── Right column (ticket — primary workspace sidebar).
  // Explicit gridColumn keeps the ticket on the right even though it's the
  // first child in the JSX. See menuCol comment.
  ticketCol: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
    background: 'var(--bg2)',
    gridColumn: 2,
    gridRow: 1,
  },
  ticketHead: {
    padding: '7px 14px 6px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  ticketTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    fontWeight: 600,
    margin: 0,
  },
  ticketSub: {
    fontSize: 10,
    color: 'var(--text3)',
    letterSpacing: '0.04em',
    marginTop: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  ticketBody: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: 0,
    // Soft fade on the last 24px so a tablet user (whose scrollbars are
    // hidden by mobile.css) gets a visual cue that more items live below
    // the fold. Mask is no-op when content fits.
    WebkitMaskImage:
      'linear-gradient(to bottom, black calc(100% - 24px), transparent)',
    maskImage:
      'linear-gradient(to bottom, black calc(100% - 24px), transparent)',
  },
  // Tabular column header above the rows — Name | Qty | Subtotal.
  // The unit-price column is gone so the ticket reads cleaner and the qty
  // cell can host an inline stepper (− 2 +). Subtotals stay on the right so
  // the cashier can scan line totals top-to-bottom.
  ticketColHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 88px 64px 24px',
    columnGap: 6,
    padding: '5px 12px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
    fontSize: 9,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 1,
  },
  ticketColHeaderCenter: { textAlign: 'center' as const },
  ticketColHeaderRight: { textAlign: 'right' as const },
  // Per-item dense row: name (+ modifiers indented) | qty | unit price |
  // line total | tiny remove ✕. Tap the row to edit (only for editable
  // items — sent lines route through the cashier-PIN flow on remove).
  itemNameCell: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    gap: 1,
  },
  itemNameLine: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text1)',
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemModsLine: {
    fontSize: 10,
    color: 'var(--text2)',
    fontStyle: 'italic',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemNoteLine: {
    fontSize: 10,
    color: 'var(--text2)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Qty stepper inline: [−][n][+]. Replaces the old static qty cell so the
  // operator can adjust on the row instead of opening the picker for every
  // bump. Sent rows still route through the cashier-PIN flow on edit.
  qtyStepper: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--border)',
    borderRadius: 7,
    background: 'var(--bg)',
    height: 30,
    overflow: 'hidden',
  },
  qtyStepperBtn: {
    width: 26,
    height: 30,
    border: 'none',
    background: 'transparent',
    color: 'var(--text2)',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  },
  qtyStepperVal: {
    minWidth: 22,
    textAlign: 'center' as const,
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    padding: '0 2px',
  },
  // Static qty for voided rows (stepper hidden — they're tombstones).
  itemQtyCell: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
    textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums',
  },
  itemLineCell: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
  },
  // Tiny ✕ at the right edge of each row — keeps the click target small so
  // a stray tap on the row body still routes to "edit". Voided rows show a
  // restore button in the same slot instead.
  itemRemoveBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--text3)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  itemRestoreBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: 'var(--green-soft)',
    color: 'var(--green)',
    border: '1px solid var(--green)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    fontSize: 12,
    fontWeight: 700,
  },
  emptyTicket: {
    padding: '40px 18px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 12,
  },
  ticketFoot: {
    flexShrink: 0,
    // padding-bottom uses the safe-area helper so on-screen tablet nav bars
    // (gesture pill / 3-button bar) never sit on top of the primary CTAs.
    padding: '8px 12px calc(8px + var(--safe-bottom))',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  // Bottom row of small + wide buttons mirroring the Loyverse layout:
  // [⋯ More][🖨 Print][Pay Order $XX].
  ticketActionRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'stretch',
  },
  smallActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text2)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
  // Anchor for the More popover; positions it just above the kebab button.
  morePopoverScrim: {
    position: 'fixed',
    inset: 0,
    background: 'transparent',
    zIndex: 60,
  },
  morePopover: {
    position: 'absolute',
    bottom: 64,
    left: 0,
    width: 240,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-lg)',
    overflow: 'hidden',
    zIndex: 61,
    display: 'flex',
    flexDirection: 'column',
  },
  morePopoverItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    minHeight: 'var(--tap)',
    fontFamily: 'inherit',
    textAlign: 'left',
    width: '100%',
  },
  morePopoverItemDanger: {
    color: 'var(--red)',
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
    rowGap: 5,
    columnGap: 10,
    fontSize: 12,
    color: 'var(--text2)',
  },
  totalsAmt: {
    color: 'var(--text1)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  },
  // The footer used to show Subtotal / Tax / Total stacked. With Subtotal
  // and Tax removed (per UX feedback — they only matter on the receipt) the
  // grand total is the only line, so it doesn't need the divider rule above.
  grandLabel: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  grandAmt: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
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
    padding: '12px 14px',
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
    minHeight: 'var(--tap)',
    textAlign: 'left',
  },
  dangerBtn: {
    width: '100%',
    padding: '12px 14px',
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
    minHeight: 'var(--tap)',
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
  // Same column tracks as ticketColHeader: Name | Qty stepper | Subtotal |
  // (action slot for ✕ / restore). The unit-price column was dropped — it
  // duplicated the subtotal column for single-quantity lines and added
  // visual noise once the qty stepper became inline.
  gridTemplateColumns: '1fr 88px 64px 24px',
  columnGap: 6,
  padding: '6px 12px',
  borderBottom: '1px solid rgba(44,36,32,0.05)',
  background: isVoided
    ? 'rgba(196,80,64,0.05)'
    : isNew
      ? 'rgba(201,164,92,0.08)'
      : 'transparent',
  alignItems: 'center',
  // Editable rows get a subtle hover affordance — the row itself is a tap
  // target that opens the picker pre-filled (qty + modifiers + notes).
  // Voided rows are read-only; sent rows fall back to the remove flow.
  cursor: isEditable ? 'pointer' : 'default',
  opacity: isVoided ? 0.7 : 1,
  transition: 'background 0.12s',
  minHeight: 38,
});

// Strike-through container for voided items. Applied to the inner block so
// the qty stepper / restore button stay visually intact and clickable.
const voidedTextStyle: React.CSSProperties = {
  textDecoration: 'line-through',
  textDecorationColor: 'var(--red)',
  color: 'var(--text2)',
};

// Per-row helpers (noteBtnStyle / itemBadgeStyle / restoreBtnStyle) were
// removed when the ticket switched to a tabular layout. Status now reads
// from the row background tint (gold = new, red = voided) and the inline
// "REMOVED" tag on voided rows; an in-row ↺/✕ button handles restore /
// remove. Note editing is delegated to the ProductPicker's notes textarea.

const sendBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  background: disabled ? 'var(--bg)' : 'var(--text1)',
  color: disabled ? 'var(--text3)' : '#fff',
  fontSize: 13,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid ' + (disabled ? 'var(--border)' : 'var(--text1)'),
  fontFamily: 'inherit',
  minHeight: 44,
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
  minHeight: 'var(--tap-lg)',
});

// "Pay Order" CTA in the ticket sidebar footer. Green to mirror the OrderRow
// button colour that signals "ready to settle".
const payOrderBtnStyle = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  background: disabled ? 'var(--bg)' : 'var(--green)',
  color: disabled ? 'var(--text3)' : '#fff',
  fontSize: 13,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  cursor: disabled ? 'not-allowed' : 'pointer',
  border: '1px solid ' + (disabled ? 'var(--border)' : 'var(--green)'),
  fontFamily: 'inherit',
  minHeight: 44,
});

const catTabStyle = (active: boolean, accent?: string | null): React.CSSProperties => ({
  padding: '7px 12px',
  borderRadius: 7,
  fontSize: 12,
  fontWeight: 600,
  color: active ? '#fff' : 'var(--text2)',
  background: active ? 'var(--text1)' : 'var(--bg2)',
  // When the category has its own colour (seeded as ProductCategory.color),
  // accent the inactive pill's left border so the user's eye can find a
  // category by its hue instead of just reading the label.
  borderLeft: !active && accent ? `3px solid ${accent}` : '1px solid var(--border)',
  borderTop: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  borderRight: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  borderBottom: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  cursor: 'pointer',
  minHeight: 36,
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
  const haptics = useHaptics();
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
    onError: () => haptics.error(),
    onSuccess: async (result) => {
      haptics.success();
      invalidateOrder();
      // Fire the kitchen printer in the background — the order screen has
      // already updated, so we don't await it. Failures from the IPC / HTTP
      // are surfaced via a toast in a future iteration; for now we rely on
      // the backend's authoritative state ("sent_at" is set regardless of
      // paper). Desktop prints locally over IPC; mobile/web delegate to the
      // backend's /print/kitchen endpoint (which is a no-op for already-sent
      // items, so the redundant marker is harmless).
      if (result.printed_count > 0) {
        try {
          if (window.electron?.printer) {
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
          } else {
            await getBridge().print.kitchen(result.order_id);
          }
        } catch {
          /* bridge stubbed or printer unreachable; backend state is the source of truth */
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
  // Cashier PIN entered when a waiter/barista is settling. Sent on every
  // payment in the modal session (split payments reuse the same PIN). Cleared
  // when the modal is dismissed or the order changes.
  const [cashierPin, setCashierPin] = useState('');
  const needsCashierPin = !canPay;
  // Payment is its own pestaña now — opens as a fullscreen modal so the
  // build-the-ticket workflow stays focused on the menu + sidebar. Closing the
  // modal returns to the workspace; settling fully closes the whole detail.
  const [paymentOpen, setPaymentOpen] = useState(false);
  // Footer "More" popover (Apply discount + Cancel order). Kept off the main
  // footer grid so the ticket body keeps its scroll room — see ticketActionRow
  // in the JSX below.
  const [moreOpen, setMoreOpen] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  // Snapshot of the just-paid order so the payment modal can stay mounted on
  // a print failure (the live order has already flipped to PAID, which would
  // otherwise unmount the modal and lose the retry option).
  const [paidOrder, setPaidOrder] = useState<ActiveOrder | null>(null);
  // The order item currently being edited in the note dialog. Null means
  // the dialog is closed; an item snapshot keeps the original note around so
  // the textarea can pre-populate without a useEffect dance.
  // Note editing now lives inside ProductPicker (its `notes` textarea), so
  // we don't keep a parallel NoteDialog state here. Tapping an editable row
  // opens the picker pre-filled with the existing note. Sent items can't
  // edit notes at all — once the kitchen has seen the line, the note is
  // immutable from the floor.
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
    setEditingItem(null);
    setCashierPin('');
  }, [orderId]);

  // When the cashier hits "Pay Order" from the active orders list, the UI
  // store flags this order to auto-open the payment modal on arrival. Only
  // honour it once and only if there's actually something to pay (the modal
  // would otherwise render disabled).
  useEffect(() => {
    if (!orderId || pendingPaymentForOrderId !== orderId) return;
    if (!order || order.status !== 'OPEN' || order.items.length === 0) return;
    setPaymentOpen(true);
    consumePendingPayment();
  }, [orderId, pendingPaymentForOrderId, order, consumePendingPayment]);

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
  // tableLabel still feeds the cancel confirmation copy, the payment modal
  // header, and child components. zoneLabel was only used in the removed
  // secondary header — order identity now lives in the global TopBar.
  const tableLabel =
    order.order_type === 'TAKEOUT'
      ? `Takeout #${order.order_number}`
      : order.table
        ? `Table ${order.table.number}`
        : `Order #${order.order_number}`;
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
    // Only force the picker when the product has *required* mods (min>0) or
    // an explicit required flag. Optional mod groups (e.g. "Add a flavour")
    // are skippable — the cashier can tap once for the default and customize
    // later by tapping the row to re-open the picker. This brings the simple
    // case down to 1 tap, matching Toast/Square.
    const hasRequiredMods = p.modifier_groups.some(
      (link) => link.modifier_group.required || link.modifier_group.min_selection > 0,
    );
    if (hasVariants || hasRequiredMods) {
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

  // Inline qty stepper handler. Voided rows ignore taps (they're tombstones);
  // sent rows route through the cashier-PIN flow via setPinPrompt; everything
  // else dispatches updateItemMutation directly. Decrementing past 1 routes
  // to the remove flow so the operator never has to leave the row to delete a
  // line. Quantity is integer-valued at the storage level, so we clamp to 1+.
  function handleStepQty(item: ActiveOrderItem, delta: 1 | -1) {
    if (item.voided_at != null) return;
    const next = item.quantity + delta;
    if (next <= 0) {
      handleRemoveItem(item);
      return;
    }
    const itemName =
      item.product.name + (item.variant ? ` · ${item.variant.name}` : '');
    if (item.sent_to_kitchen) {
      setPinPrompt({ kind: 'updateQty', itemId: item.id, itemName, nextQty: next });
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
    setPrintError(null);
    setPrintingReceipt(true);
    try {
      // Desktop sends the full order payload over IPC and the main process
      // formats locally. Mobile / web bundles delegate to the backend, which
      // reads the order itself and pushes ESC/POS to the configured printer.
      if (window.electron?.printer) {
        const result = await window.electron.printer.printReceipt({ order: target });
        if (!result.ok) {
          setPrintError(translatePrintError(result.error));
          return false;
        }
        return true;
      }
      const result = await getBridge().print.receipt(target.id);
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
    if (!order) return;
    if (order.items.length === 0) {
      window.alert('Add items before charging.');
      return;
    }
    if (needsCashierPin && !/^\d{4,6}$/.test(cashierPin)) {
      window.alert('Cashier PIN required to settle this order.');
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
        ...(needsCashierPin ? { pin: cashierPin } : {}),
      });
      invalidateOrder();
      if (result.order.status === 'PAID') {
        haptics.success();
        await finalizeSettled(result.order);
      } else {
        // Partial cash tender — keep the screen open and clear the input so
        // the cashier can record the next portion of the split.
        setAmountInput('');
        setReference('');
      }
    } catch (err) {
      // Error is captured by paymentMutation.error and rendered inline.
      haptics.error();
      if (!(err instanceof ApiError)) throw err;
    }
  }

  async function submitSplitPayments() {
    if (!orderId || splitPayments.length === 0) return;
    if (needsCashierPin && !/^\d{4,6}$/.test(cashierPin)) {
      window.alert('Cashier PIN required to settle this order.');
      return;
    }
    try {
      let lastResult: Awaited<ReturnType<typeof addOrderPayment>> | null = null;
      for (const draft of splitPayments) {
        lastResult = await addOrderPayment(orderId, {
          method: draft.method,
          amount: draft.amount,
          reference: draft.method === 'CASH' ? null : draft.reference || null,
          ...(needsCashierPin ? { pin: cashierPin } : {}),
        });
      }
      invalidateOrder();
      if (lastResult?.order.status === 'PAID') {
        haptics.success();
        await finalizeSettled(lastResult.order);
      } else {
        setSplitPayments([]);
        setSplitMode(false);
      }
    } catch (err) {
      haptics.error();
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
    paymentMutation.isPending ||
    order.items.length === 0 ||
    remaining <= 0 ||
    (needsCashierPin && !/^\d{4,6}$/.test(cashierPin)) ||
    (splitMode
      ? splitPayments.length === 0
      : currentTender <= 0 ||
        (paymentMethod === 'CASH' && currentTender < remaining));

  return (
    <div style={styles.shell}>
      {/* Secondary header was removed: order identity (Order #X / Table·Zone)
          + Back button now live in the global TopBar when view==='detail'.
          Elapsed and totals are shown inside the ticket sidebar. */}
      <div style={styles.body}>
        {/* Layout intentionally renders the MENU first (left-dominant) and the
            ticket second (right sidebar). CSS grid order matches DOM order, so
            don't reorder these two sections without flipping the gridTemplateColumns. */}
        {/* ───────── RIGHT: ticket sidebar ───────── */}
        <section style={styles.ticketCol}>
          <div style={styles.ticketHead}>
            <h2 style={styles.ticketTitle}>Current Ticket</h2>
            <div style={styles.ticketSub}>
              {itemCount === 0
                ? `Empty · ${elapsed} elapsed`
                : `${itemCount} item${itemCount === 1 ? '' : 's'} · ${elapsed} elapsed · ${
                    hasUnsent ? 'unsent items' : 'all sent'
                  }`}
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

          {order.items.length > 0 && (
            <div style={styles.ticketColHeader}>
              <span>Item</span>
              <span style={styles.ticketColHeaderCenter}>Qty</span>
              <span style={styles.ticketColHeaderRight}>Total</span>
              <span />
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
                const voidedText = it.isVoided ? voidedTextStyle : null;
                // The stepper is shown for any non-voided line (sent rows
                // still get the controls — taps route through the PIN flow).
                const showStepper = !it.isVoided;
                return (
                  <div
                    key={it.raw.id}
                    style={itemRowStyle(it.isNew, it.isVoided, editable)}
                    onClick={editable ? () => handleTicketRowTap(it.raw) : undefined}
                    role={editable ? 'button' : undefined}
                    aria-label={
                      editable ? `Edit ${it.raw.product.name}` : undefined
                    }
                  >
                    {/* Name + (variant) on line 1; modifiers indented on a
                        smaller second line; notes / void reason on a third. */}
                    <div style={styles.itemNameCell}>
                      <span style={{ ...styles.itemNameLine, ...voidedText }}>
                        {it.raw.product.name}
                        {it.raw.variant && ` · ${it.raw.variant.name}`}
                        {it.isVoided && (
                          <span style={{ marginLeft: 6, color: 'var(--red)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
                            REMOVED
                          </span>
                        )}
                      </span>
                      {it.raw.modifiers.length > 0 && (
                        <span style={{ ...styles.itemModsLine, ...voidedText }}>
                          {it.raw.modifiers.map((m) => m.name).join(' · ')}
                        </span>
                      )}
                      {it.raw.notes && (
                        <span style={{ ...styles.itemNoteLine, ...voidedText }}>
                          Note: {it.raw.notes}
                        </span>
                      )}
                      {it.isVoided && it.raw.void_reason && (
                        <span style={{ ...styles.itemNoteLine, color: 'var(--red)' }}>
                          Reason: {it.raw.void_reason}
                        </span>
                      )}
                    </div>
                    {showStepper ? (
                      <div
                        style={styles.qtyStepper}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          style={styles.qtyStepperBtn}
                          onClick={() => handleStepQty(it.raw, -1)}
                          disabled={updateItemMutation.isPending}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span style={styles.qtyStepperVal}>{it.raw.quantity}</span>
                        <button
                          type="button"
                          style={styles.qtyStepperBtn}
                          onClick={() => handleStepQty(it.raw, 1)}
                          disabled={updateItemMutation.isPending}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <span style={{ ...styles.itemQtyCell, ...voidedText }}>
                        {it.raw.quantity}
                      </span>
                    )}
                    <span style={{ ...styles.itemLineCell, ...voidedText }}>
                      {formatMoney(it.raw.line_total)}
                    </span>
                    {/* Action slot: voided rows expose ↺ restore; otherwise
                        a small ✕ removes the line (cashier PIN if sent). */}
                    {it.isVoided ? (
                      <button
                        type="button"
                        style={styles.itemRestoreBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestoreItem(it.raw);
                        }}
                        disabled={restoreItemMutation.isPending}
                        aria-label="Restore item"
                        title="Restore"
                      >
                        ↺
                      </button>
                    ) : canRemove ? (
                      <button
                        type="button"
                        style={styles.itemRemoveBtn}
                        onClick={async (e) => {
                          e.stopPropagation();
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
                        <IconClose style={{ fontSize: 13 }} />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })
            )}

            {(addItemMutation.error ||
              updateItemMutation.error ||
              removeItemMutation.error ||
              restoreItemMutation.error) && (
              <div style={{ ...styles.errBanner, margin: '12px 16px' }}>
                {firstApiMessage(
                  addItemMutation.error,
                  updateItemMutation.error,
                  removeItemMutation.error,
                  restoreItemMutation.error,
                ) ?? 'Could not update the ticket'}
              </div>
            )}
          </div>

          {/* Footer: just the grand Total (Subtotal & Tax moved to the receipt
              and the payment modal — they don't help the cashier finalize a
              ticket) + 2 persistent CTAs (Send / Pay) + a compact action row
              [⋯ More][🖨][Pay]. Apply discount / Cancel order live behind the
              "More" kebab so the ticket body keeps its vertical room. */}
          <div style={styles.ticketFoot}>
            <div style={styles.totalsRow}>
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

            {sendKitchenMutation.error && (
              <div style={styles.errBanner}>
                {sendKitchenMutation.error instanceof ApiError
                  ? sendKitchenMutation.error.message
                  : 'Send to kitchen failed'}
              </div>
            )}

            {/* Send to Kitchen — full-width primary CTA. Disabled when there
                are no unsent lines so the screen still tells the user what
                button this is, even on an all-sent ticket. */}
            {order.status === 'OPEN' && (
              <button
                type="button"
                style={sendBtnStyle(!hasUnsent || sendKitchenMutation.isPending)}
                disabled={!hasUnsent || sendKitchenMutation.isPending}
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

            {/* Compact action row: [⋯ More][🖨 Print][Pay Order $XX].
                The kebab opens a popover with Apply discount + Cancel order
                so they don't take up dedicated vertical chrome. */}
            <div style={{ ...styles.ticketActionRow, position: 'relative' }}>
              {order.status === 'OPEN' && (
                <button
                  type="button"
                  style={styles.smallActionBtn}
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-label="More actions"
                  aria-expanded={moreOpen}
                >
                  <IconMore style={{ fontSize: 20 }} />
                </button>
              )}
              <button
                type="button"
                style={styles.smallActionBtn}
                onClick={handlePrintReceipt}
                disabled={printingReceipt || order.items.length === 0}
                aria-label="Print ticket"
                title="Print ticket"
              >
                {printingReceipt ? (
                  <Spinner size={14} />
                ) : (
                  <IconPrinter style={{ fontSize: 18 }} />
                )}
              </button>
              {order.status === 'OPEN' && (
                <button
                  type="button"
                  style={{ ...payOrderBtnStyle(order.items.length === 0), flex: 1, width: 'auto' }}
                  disabled={order.items.length === 0}
                  onClick={() => setPaymentOpen(true)}
                >
                  <IconCash style={{ fontSize: 18 }} />
                  Pay · {formatMoney(String(remaining))}
                </button>
              )}

              {moreOpen && order.status === 'OPEN' && (
                <>
                  <div
                    style={styles.morePopoverScrim}
                    onClick={() => setMoreOpen(false)}
                  />
                  <div style={styles.morePopover} role="menu">
                    {canPay && (
                      <button
                        type="button"
                        style={styles.morePopoverItem}
                        onClick={() => {
                          setMoreOpen(false);
                          handleApplyDiscount();
                        }}
                        disabled={discountMutation.isPending}
                      >
                        <IconPercent style={{ fontSize: 16 }} />
                        <span>
                          {Number(order.discount_amount) > 0
                            ? 'Clear discount'
                            : 'Apply discount'}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      style={{
                        ...styles.morePopoverItem,
                        ...styles.morePopoverItemDanger,
                        borderBottom: 'none',
                      }}
                      onClick={() => {
                        setMoreOpen(false);
                        handleCancelOrderClick();
                      }}
                      disabled={cancelMutation.isPending}
                    >
                      <IconClose style={{ fontSize: 16 }} />
                      <span>Cancel order</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {printError && <div style={styles.errBanner}>{printError}</div>}
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
                  style={catTabStyle(activeCat === c.id, c.color)}
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

          <div className="product-grid" style={styles.productGrid}>
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
              const variants = p.variants
                .filter((v) => v.active)
                .slice()
                .sort((a, b) => a.display_order - b.display_order);
              // Show the *default* variant's price (the lowest display_order)
              // instead of "from $X" — matches Square/Toast where the tile
              // commits to a price for the most-likely tap. The size badge
              // overlay tells the cashier additional sizes exist.
              const priceLabel = variants.length > 0
                ? formatMoney(variants[0].sell_price)
                : p.sell_price != null
                  ? formatMoney(p.sell_price)
                  : '—';
              const cat = p.category_id
                ? categories.find((c) => c.id === p.category_id)
                : null;
              // Fallback colour for the image area when image_url is null —
              // resolves through: product override → category tag → gold.
              const fallbackColor = p.icon_color ?? cat?.color ?? 'var(--gold)';
              const initial = p.name.trim().charAt(0).toUpperCase() || '·';
              return (
                <button
                  key={p.id}
                  type="button"
                  className="product-card"
                  style={styles.productCard}
                  onClick={() => handleProductTap(p)}
                >
                  <div style={styles.productImageWrap}>
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt=""
                        style={styles.productImage}
                        loading="lazy"
                        draggable={false}
                      />
                    ) : (
                      <div
                        style={{
                          ...styles.productImageFallback,
                          background: fallbackColor,
                        }}
                      >
                        {initial}
                      </div>
                    )}
                    {variants.length > 1 && (
                      <span style={styles.productSizeBadge}>
                        {variants.length} sizes
                      </span>
                    )}
                    <span style={styles.productAddBadge} aria-hidden>＋</span>
                  </div>
                  <div style={styles.productLabel}>
                    <span className="product-card-name" style={styles.productName}>
                      {p.name}
                    </span>
                    <span className="product-card-price" style={styles.productPrice}>
                      {priceLabel}
                    </span>
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

      {/* Payment is its own pestaña now — fullscreen modal that overlays the
          workspace. Closing it returns to the ticket; settling fully closes
          the whole detail (the parent's submit handlers already do that).
          When `paidOrder` is set the order is already settled but the
          receipt didn't print — the modal stays mounted in a post-payment
          state offering retry / close. */}
      {((paymentOpen && order.status === 'OPEN') || paidOrder) && (
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
          <div className="pay-modal" style={styles.payModal} onClick={(e) => e.stopPropagation()} role="dialog">
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

              {needsCashierPin && (
                <div style={styles.panel}>
                  <div style={styles.panelHd}>
                    <span>Cashier authorization</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                    Your role can't settle without an active cashier or
                    manager's PIN. Hand the tablet over so they can authorize.
                  </div>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={cashierPin}
                    onChange={(e) => setCashierPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Cashier PIN"
                    style={{
                      width: '100%',
                      minHeight: 'var(--tap-lg)',
                      padding: '12px 16px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      fontSize: 18,
                      letterSpacing: '0.4em',
                      textAlign: 'center',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              )}

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
                          className="pay-quick-btn"
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

// NoteDialog was removed when the ticket switched to the tabular layout —
// notes are now editable through ProductPicker's textarea (the same modal
// that picks variants and modifiers). Sent items can't edit notes from the
// floor; that's acceptable since the kitchen has already seen the line.

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

