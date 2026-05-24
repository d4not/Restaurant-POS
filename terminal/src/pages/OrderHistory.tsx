import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  approveOrderSuggestion,
  createOrderSuggestion,
  fetchOrderHistory,
  rejectOrderSuggestion,
  reopenOrder,
  softDeleteOrder,
  updatePaymentMethod,
  type ActiveOrder,
  type ActiveOrderItem,
  type ActiveOrderPayment,
  type OrderStatus,
  type PaymentMethodType,
  type PendingOrderSuggestion,
} from '../api/orders';
import {
  fetchCurrentRegister,
  fetchShiftsForRange,
  type CashRegisterRow,
} from '../api/registers';
import { fetchAllProducts, type PosProduct } from '../api/products';
import { ApiError } from '../api/client';
import { Spinner } from '../components/Spinner';
import { PinConfirmModal } from '../components/PinConfirmModal';
import {
  IconPlus,
  IconClose,
  IconChevronDown,
  IconSearch,
  IconReopen,
  IconCash,
} from '../components/Icons';

// Closes a modal on Esc and on scrim click (unless busy). Used by the two
// inline modals; the imported PinConfirmModal handles its own keyboard story.
function useModalDismiss(onClose: () => void, busy: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
}
import { formatMoney } from '../utils/format';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n/en';
import { useSession } from '../store/session';

// SETTLED is the combined "paid + voided" view. OPEN orders never appear in
// this screen — they belong to Active Orders. The segmented control resurfaces
// PAID or CANCELLED individually; there is no path to OPEN from here.
type SettledStatus = 'PAID' | 'CANCELLED';
type StatusFilter = 'SETTLED' | SettledStatus;
type PaymentFilter = 'ALL' | PaymentMethodType;

const STATUS_FILTERS: { value: StatusFilter; labelKey: TranslationKey }[] = [
  { value: 'SETTLED', labelKey: 'history.filterSettled' },
  { value: 'PAID', labelKey: 'history.filterPaid' },
  { value: 'CANCELLED', labelKey: 'history.filterCancelled' },
];

const PAYMENT_FILTERS: { value: PaymentFilter; labelKey: TranslationKey }[] = [
  { value: 'ALL', labelKey: 'history.filterAll' },
  { value: 'CASH', labelKey: 'payment.cash' },
  { value: 'CARD', labelKey: 'payment.card' },
  { value: 'TRANSFER', labelKey: 'payment.transfer' },
];

// History is today-only by design — operators can settle / void today's
// tickets but historical days belong to the admin web.
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// One continuous ledger; shift dividers in place of card chrome. Playfair
// kept only for the page H1 (a body display moment), DM Sans everywhere
// else. Restrained color: tinted neutrals + gold reserved for live values.
// ────────────────────────────────────────────────────────────────────────────

// Columns: # · time · table · qty · waiter (elastic) · payment · total · status · caret.
// # is 52px (room for "#999" tabular at 13/600 plus padding); the dot was removed
// in the quieter pass, so this column carries the number alone.
const TABLE_GRID = '52px 76px 92px 50px minmax(0,1fr) 96px 110px 96px 24px';

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    background: 'var(--bg)',
  },

  // ─── Header: title + today chip on the left, stat strip on the right
  head: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'baseline',
    columnGap: 28,
    rowGap: 10,
    padding: '22px 32px 16px',
    borderBottom: '1px solid var(--border)',
  },
  titleBlock: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 14,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 28,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
    letterSpacing: '-0.015em',
  },
  // Numbers are the hero. Each stat is a vertical pair: Playfair value on top,
  // uppercase eyebrow below. Value baselines align with the H1 to the left.
  statStrip: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifySelf: 'end',
    columnGap: 32,
    rowGap: 14,
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 5,
    minWidth: 0,
  },
  statValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
    lineHeight: 1,
  },
  statValueAccent: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--gold)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
    lineHeight: 1,
  },
  statValueDanger: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--red)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },

  // ─── Filter bar: one row, hierarchical rhythm.
  //   search (primary)  ·  status (high-frequency)  ·  +Filters popover
  //   ·  applied-filter chips  ·  clear (escape hatch, right-aligned)
  // Wrap rowGap = 10 so a wrapped second row breathes without doubling padding.
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 32px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
    flexWrap: 'wrap',
    rowGap: 10,
  },
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    width: 280,
    height: 40,
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    flex: 1,
    fontSize: 13,
    fontFamily: 'inherit',
    color: 'var(--text1)',
    height: 40,
  },
  segGroup: {
    display: 'inline-flex',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
    height: 40,
  },

  // ─── +Filters anchor + button
  filtersAnchor: {
    position: 'relative',
    display: 'inline-flex',
  },
  // Button takes a darker active state when the popover is open so the
  // anchor reads as "this is what's currently expanded below."
  filtersBtnBase: {
    height: 40,
    padding: '0 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'inherit',
    transition: 'background 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out',
    whiteSpace: 'nowrap',
  },
  // Count pill — gold dot replaced by a numbered chip so users can see at a
  // glance "3 filters applied" without opening the popover.
  filtersBtnCount: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    borderRadius: 999,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 11,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: 0,
  },

  // ─── Popover
  // Anchored under the +Filters button; 320px wide so dropdowns inside have
  // proper breathing room. Shadow does the elevation work, no scrim.
  popover: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    left: 0,
    zIndex: 30,
    width: 320,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: '0 16px 40px rgba(44,36,32,0.18), 0 2px 4px rgba(44,36,32,0.04)',
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  popoverGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  popoverLabel: {
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontWeight: 700,
    color: 'var(--text3)',
  },
  popoverSeg: {
    display: 'inline-flex',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    overflow: 'hidden',
    height: 36,
  },
  popoverSelect: {
    height: 36,
    width: '100%',
    padding: '0 34px 0 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13,
    fontFamily: 'inherit',
    fontWeight: 500,
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    // Custom chevron — bypasses native tablet/iOS dropdown chrome that would
    // otherwise leak through on Capacitor.
    backgroundImage:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b5e54' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    backgroundSize: '16px',
  },

  // ─── Applied-filter chips
  chipRow: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 32,
    padding: '0 4px 0 10px',
    borderRadius: 999,
    background: 'rgba(44,36,32,0.04)',
    border: '1px solid var(--border)',
    fontSize: 12,
    color: 'var(--text1)',
    fontFamily: 'inherit',
  },
  chipLabel: {
    color: 'var(--text3)',
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  chipValue: {
    color: 'var(--text1)',
    fontWeight: 500,
    fontSize: 12,
    maxWidth: 140,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chipRemove: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: 'var(--text2)',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontSize: 11,
    transition: 'background 120ms ease-out, color 120ms ease-out',
    fontFamily: 'inherit',
  },

  clearFilters: {
    padding: '0 12px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text2)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    height: 40,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    textDecorationColor: 'var(--text3)',
    marginLeft: 'auto',
  },

  // ─── Body: continuous ledger
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '0 32px 32px',
  },
  ledger: {
    // No card wrapping. Just structural rhythm.
  },
  thSticky: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: 'var(--bg)',
  },
  th: {
    display: 'grid',
    gridTemplateColumns: TABLE_GRID,
    columnGap: 16,
    padding: '14px 4px 10px 28px',
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--text3)',
    borderBottom: '1px solid var(--border)',
  },

  // ─── Shift cards
  // Each shift is its own card: hairline border, lifted surface, soft shadow,
  // breathing room between siblings. The card frame replaces the hairline
  // chapter rule the continuous-ledger version used.
  shiftCard: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    marginTop: 16,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  },

  // ─── Shift divider (header of each card)
  // Two-line block: title row + meta row, plus a right-side aggregate.
  shiftDivider: {
    display: 'grid',
    gridTemplateColumns: '14px minmax(0, 1fr) auto',
    columnGap: 16,
    padding: '18px 4px 14px',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background 120ms ease-out',
  },
  shiftDividerCompact: {
    // 0-order shifts render quieter — card collapses to just the header.
    paddingTop: 16,
    paddingBottom: 16,
    cursor: 'default',
  },
  shiftCaret: {
    color: 'var(--text3)',
    fontSize: 12,
    transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
    width: 12,
    height: 12,
    marginTop: 6,
    lineHeight: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftHeading: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  shiftTitleRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  shiftTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--text1)',
    letterSpacing: '-0.005em',
  },
  shiftTitleCompact: {
    // muted weight for empty closed shifts so they don't shout
    fontWeight: 600,
    color: 'var(--text2)',
  },
  shiftMeta: {
    fontSize: 12,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.4,
  },
  shiftOngoingTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--green)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    padding: '2px 8px 2px 6px',
    borderRadius: 999,
    background: 'rgba(74,140,92,0.10)',
  },
  shiftOngoingDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--green)',
    boxShadow: '0 0 0 3px rgba(74,140,92,0.16)',
  },
  // Per-shift aggregate. The chapter's headline number; sits at the right edge
  // of the divider so a manager can scan revenue down the page in one column.
  shiftAggregate: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 5,
    textAlign: 'right',
    alignSelf: 'flex-start',
    paddingTop: 1,
  },
  shiftAggregateValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.005em',
    lineHeight: 1,
  },
  shiftAggregateLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },

  // ─── Orders table
  trBase: {
    display: 'grid',
    gridTemplateColumns: TABLE_GRID,
    columnGap: 16,
    padding: '12px 4px 12px 28px',
    fontSize: 13,
    color: 'var(--text1)',
    borderBottom: '1px solid rgba(226,220,212,0.55)',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'background 140ms cubic-bezier(0.22, 1, 0.36, 1)',
    fontFamily: 'inherit',
    background: 'transparent',
  },
  cellMuted: { color: 'var(--text2)' },
  cellNum: {
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  cellOrderNum: {
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.01em',
  },
  expandIcon: {
    color: 'var(--text3)',
    fontSize: 14,
    transition: 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 0,
  },

  // ─── Expanded inline detail (no nested cards)
  expandedBody: {
    background: 'rgba(168,152,136,0.05)',
    borderBottom: '1px solid var(--border)',
    padding: '20px 28px 22px',
  },
  expandedGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)',
    columnGap: 36,
    rowGap: 0,
  },
  expandedSection: {
    minWidth: 0,
  },
  expandedHd: {
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--text3)',
    padding: '0 0 8px',
    borderBottom: '1px solid var(--border)',
    marginBottom: 6,
  },
  itemRow: {
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) auto',
    gap: 10,
    padding: '8px 0',
    borderBottom: '1px solid rgba(226,220,212,0.45)',
    alignItems: 'flex-start',
  },
  itemQty: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.4,
  },
  itemName: {
    fontSize: 13,
    color: 'var(--text1)',
    lineHeight: 1.35,
  },
  itemMods: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 2,
  },
  itemNote: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 2,
    fontStyle: 'italic',
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text1)',
  },
  paymentRow: {
    display: 'grid',
    gridTemplateColumns: '64px minmax(0, 1fr) auto',
    gap: 12,
    padding: '8px 0',
    borderBottom: '1px solid rgba(226,220,212,0.45)',
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    alignItems: 'center',
  },
  totalsBlock: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    rowGap: 7,
    columnGap: 12,
    fontSize: 13,
    color: 'var(--text2)',
    padding: '12px 0 0',
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
    paddingTop: 12,
    marginTop: 6,
    borderTop: '1px solid var(--border)',
    letterSpacing: '-0.005em',
    lineHeight: 1.2,
  },
  grandAmt: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    paddingTop: 12,
    marginTop: 6,
    borderTop: '1px solid var(--border)',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.015em',
    lineHeight: 1,
  },
  noteBlock: {
    fontSize: 12,
    color: 'var(--text2)',
    padding: '10px 0 0',
    marginTop: 10,
    borderTop: '1px solid var(--border)',
    fontStyle: 'italic',
  },
  actionBar: {
    gridColumn: '1 / -1',
    marginTop: 18,
    paddingTop: 14,
    borderTop: '1px solid var(--border)',
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  actionBtn: {
    padding: '8px 14px',
    borderRadius: 8,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  actionBtnDanger: {
    color: 'var(--red)',
    borderColor: 'rgba(196,80,64,0.30)',
    background: 'transparent',
  },

  empty: {
    padding: '64px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },
  // Collapsed footer line for closed shifts with zero orders. One row of
  // muted text instead of N empty cards.
  emptyShiftsFooter: {
    padding: '14px 4px 4px',
    marginTop: 14,
    fontSize: 12,
    color: 'var(--text3)',
    lineHeight: 1.5,
  },
  errorState: {
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.25)',
    color: 'var(--red)',
    borderRadius: 10,
    padding: '20px 24px',
    fontSize: 13,
    textAlign: 'center',
    margin: '20px 0',
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
    gap: 14,
    color: 'var(--text2)',
  },
  loadMoreWrap: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 24,
  },
  loadMore: {
    padding: '10px 24px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  // Inline modal shared by soft-delete and change-method actions.
  modalScrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: 460,
    maxWidth: '100%',
    background: 'var(--bg2)',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  modalHead: {
    padding: '18px 22px 14px',
    borderBottom: '1px solid var(--border)',
  },
  modalHeadRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  modalHeadText: {
    flex: 1,
    minWidth: 0,
  },
  modalCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    color: 'var(--text2)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 14,
    flexShrink: 0,
    padding: 0,
    fontFamily: 'inherit',
  },
  modalTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 19,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  modalSub: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
  },
  modalBody: {
    padding: '16px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  modalLabel: {
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    marginBottom: 4,
  },
  textarea: {
    width: '100%',
    minHeight: 80,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
  },
  methodGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
  },
  modalErr: {
    background: 'rgba(196,80,64,0.08)',
    color: 'var(--red)',
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 12,
  },
  modalFoot: {
    padding: '14px 22px 18px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
  },
  modalCancel: {
    padding: '10px 16px',
    borderRadius: 8,
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text2)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  modalConfirm: {
    padding: '10px 18px',
    borderRadius: 8,
    background: 'var(--text1)',
    border: '1px solid var(--text1)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  },
  modalConfirmDanger: {
    background: 'var(--red)',
    borderColor: 'var(--red)',
  },

  // ─── Pending-suggestion treatments
  // Row when an order carries a PENDING cashier suggestion. Gold left rail +
  // soft gold wash so the manager's eye lands on it instantly. The wash sits
  // under the existing CANCELLED tint; CANCELLED orders never carry a
  // suggestion (cancel happens upstream) so the conflict is theoretical.
  suggestionRow: {
    background: 'rgba(201,164,92,0.10)',
    boxShadow: 'inset 3px 0 0 var(--gold)',
  },
  // Inline badge on the row's status column for cashier-side feedback ("your
  // suggestion is pending"). Reuses the same pill shape as the status badge.
  suggestionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 999,
    background: 'rgba(201,164,92,0.20)',
    color: 'var(--gold)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    width: 'fit-content',
  },
  // Manager-facing suggestion panel inside the expanded body. Lives ABOVE the
  // actionBar so the approve/reject pair reads as primary.
  suggestionPanel: {
    gridColumn: '1 / -1',
    marginTop: 16,
    padding: '14px 16px',
    borderRadius: 10,
    background: 'rgba(201,164,92,0.10)',
    border: '1px solid rgba(201,164,92,0.40)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  suggestionPanelHd: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  suggestionPanelTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  suggestionPanelBy: {
    fontSize: 11,
    color: 'var(--text2)',
    fontStyle: 'italic',
  },
  suggestionPanelLine: {
    fontSize: 13,
    color: 'var(--text1)',
  },
  suggestionPanelReason: {
    fontSize: 12,
    color: 'var(--text2)',
    fontStyle: 'italic',
  },
  suggestionPanelActions: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
  },
  suggestionApproveBtn: {
    padding: '9px 18px',
    borderRadius: 8,
    background: 'var(--green)',
    border: '1px solid var(--green)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  suggestionRejectBtn: {
    padding: '9px 18px',
    borderRadius: 8,
    background: 'transparent',
    border: '1px solid var(--red)',
    color: 'var(--red)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
};

const methodBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '12px',
  borderRadius: 8,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg)',
  color: active ? '#fff' : 'var(--text1)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
});

// Segmented-control option. Sits inside `styles.segGroup`.
const segOption = (active: boolean, isFirst: boolean): React.CSSProperties => ({
  padding: '0 16px',
  height: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  background: active ? 'var(--text1)' : 'transparent',
  color: active ? '#f5f0e8' : 'var(--text2)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  borderLeft: isFirst ? 'none' : '1px solid var(--border)',
  fontFamily: 'inherit',
  minHeight: 40,
  whiteSpace: 'nowrap',
  transition: 'background 120ms ease-out, color 120ms ease-out',
});

// Compact segmented-control option for use inside the +Filters popover.
// Same vocabulary as `segOption`, scaled down to fit the 320px panel.
const popoverSegOption = (active: boolean, isFirst: boolean): React.CSSProperties => ({
  flex: 1,
  height: 36,
  padding: '0 8px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: active ? 'var(--text1)' : 'transparent',
  color: active ? '#f5f0e8' : 'var(--text2)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  borderLeft: isFirst ? 'none' : '1px solid var(--border)',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  transition: 'background 120ms ease-out, color 120ms ease-out',
});

// +Filters button: idle vs. open. Open state mirrors the segmented-control
// active treatment so the anchor reads as "this is what's expanded."
const filtersBtnStyle = (open: boolean): React.CSSProperties => ({
  background: open ? 'var(--text1)' : 'var(--bg2)',
  color: open ? '#f5f0e8' : 'var(--text1)',
  border: '1px solid ' + (open ? 'var(--text1)' : 'var(--border)'),
});

// Settled-status palette. PAID earns green; CANCELLED earns red. OPEN is
// filtered out before reaching this view, so the palette only covers the two
// terminal states. Badge, row dot, and row tint draw from the same source.
const STATUS_PALETTE: Record<SettledStatus, { hue: string; tintAlpha: number; badgeBg: string }> = {
  PAID:      { hue: 'var(--green)', tintAlpha: 0,    badgeBg: 'rgba(74,140,92,0.18)' },
  CANCELLED: { hue: 'var(--red)',   tintAlpha: 0.05, badgeBg: 'rgba(196,80,64,0.12)' },
};

// Localized badge label per status. The badge reads in the user's locale
// instead of leaking the raw English enum.
const STATUS_LABEL_KEYS: Record<SettledStatus, TranslationKey> = {
  PAID:      'history.statusPaid',
  CANCELLED: 'history.statusCancelled',
};

const statusBadgeStyle = (status: SettledStatus): React.CSSProperties => {
  const c = STATUS_PALETTE[status];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 999,
    background: c.badgeBg,
    color: c.hue,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    width: 'fit-content',
  };
};

// Row tint. CANCELLED gets a faint red wash so voided orders read as the
// exception they are. 5% alpha, well under the 10% accent rule. PAID and the
// expanded row use their own treatments. The right-side badge carries status
// for both states; there is no leading dot.
const rowTintFor = (status: SettledStatus, isExpanded: boolean): string => {
  if (isExpanded) return 'rgba(201,164,92,0.12)';
  if (status === 'CANCELLED') return `rgba(196,80,64,${STATUS_PALETTE.CANCELLED.tintAlpha})`;
  return 'transparent';
};

function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function summarizePayments(
  order: ActiveOrder,
  t: (key: string) => string,
): { label: string; tag: string } {
  if (order.status === 'CANCELLED' || order.payments.length === 0) {
    return { label: '—', tag: '—' };
  }
  const methods = Array.from(new Set(order.payments.map((p) => p.method)));
  if (methods.length === 1) {
    const m = methods[0];
    return {
      label:
        m === 'CASH' ? t('payment.cash')
          : m === 'CARD' ? t('payment.card')
          : m === 'TRANSFER' ? t('payment.transfer')
          : t('history.split'),
      tag: m,
    };
  }
  return { label: t('history.split'), tag: 'split' };
}

function tableLabel(order: ActiveOrder, t: (key: string) => string): string {
  if (order.order_type === 'TAKEOUT') return t('detail.takeoutLabel');
  if (order.table) return `${t('detail.tableLabel')} ${order.table.number}`;
  return '—';
}

function matchesSearch(order: ActiveOrder, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return (
    String(order.order_number).includes(q) ||
    order.user.name.toLowerCase().includes(q) ||
    (order.table?.zone.name.toLowerCase() ?? '').includes(q) ||
    (order.table ? `table ${order.table.number}` : '').includes(q) ||
    order.notes?.toLowerCase().includes(q) === true
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Modals — soft-delete and change-payment-method need PIN + extra fields,
// which the shared PinConfirmModal doesn't expose. We render them inline.
// ────────────────────────────────────────────────────────────────────────────

// Draft modal: collects the deletion reason. PIN entry happens in a follow-up
// PinConfirmModal so the numpad UX matches the rest of the terminal.
interface SoftDeleteModalProps {
  orderNumber: number;
  mode: ActionMode;
  onClose: () => void;
  onConfirm: (input: { reason: string }) => void;
}
function SoftDeleteModal(props: SoftDeleteModalProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const reasonOk = reason.trim().length >= 5;
  useModalDismiss(props.onClose, false);
  const isSuggest = props.mode === 'suggest';
  const subCopy = isSuggest
    ? t('history.deleteSuggestSub').replace('{n}', String(props.orderNumber))
    : t('history.deleteOrderSub').replace('{n}', String(props.orderNumber));
  return (
    <div style={styles.modalScrim} onClick={props.onClose}>
      <div
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={t('history.deleteOrderTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalHead}>
          <div style={styles.modalHeadRow}>
            <div style={styles.modalHeadText}>
              <h2 style={styles.modalTitle}>{t('history.deleteOrderTitle')}</h2>
              <div style={styles.modalSub}>{subCopy}</div>
            </div>
            <button
              type="button"
              style={styles.modalCloseBtn}
              onClick={props.onClose}
              aria-label={t('common.close')}
            >
              <IconClose style={{ fontSize: 14 }} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div style={styles.modalBody}>
          <div>
            <div style={styles.modalLabel}>{t('history.deleteReasonLabel')}</div>
            <textarea
              style={styles.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('history.deleteReasonPlaceholder')}
              autoFocus
            />
          </div>
        </div>
        <div style={styles.modalFoot}>
          <button type="button" style={styles.modalCancel} onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={{ ...styles.modalConfirm, ...styles.modalConfirmDanger }}
            disabled={!reasonOk}
            onClick={() => props.onConfirm({ reason: reason.trim() })}
          >
            {t('common.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Draft modal: collects method + reference. PIN entry happens in a follow-up
// PinConfirmModal so the numpad UX matches the rest of the terminal.
interface ChangePaymentMethodModalProps {
  payment: ActiveOrderPayment;
  mode: ActionMode;
  onClose: () => void;
  onConfirm: (input: { method: PaymentMethodType; reference: string | null }) => void;
}
function ChangePaymentMethodModal(props: ChangePaymentMethodModalProps) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<PaymentMethodType>(
    props.payment.method === 'CASH' ? 'CARD' : 'CASH',
  );
  const [reference, setReference] = useState(props.payment.reference ?? '');
  const changed = method !== props.payment.method;
  useModalDismiss(props.onClose, false);
  const isSuggest = props.mode === 'suggest';
  const titleCopy = isSuggest ? t('history.changeMethodSuggestTitle') : t('history.changeMethodTitle');
  const subTemplate = isSuggest ? t('history.changeMethodSuggestSub') : t('history.changeMethodSub');
  return (
    <div style={styles.modalScrim} onClick={props.onClose}>
      <div
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={t('history.changeMethodTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalHead}>
          <div style={styles.modalHeadRow}>
            <div style={styles.modalHeadText}>
              <h2 style={styles.modalTitle}>{titleCopy}</h2>
              <div style={styles.modalSub}>
                {subTemplate
                  .replace('{from}', t(`payment.${props.payment.method.toLowerCase() as 'cash' | 'card' | 'transfer'}`))
                  .replace('{amount}', formatMoney(props.payment.amount))}
              </div>
            </div>
            <button
              type="button"
              style={styles.modalCloseBtn}
              onClick={props.onClose}
              aria-label={t('common.close')}
            >
              <IconClose style={{ fontSize: 14 }} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div style={styles.modalBody}>
          <div>
            <div style={styles.modalLabel}>{t('history.changeMethodPickLabel')}</div>
            <div style={styles.methodGrid}>
              {(['CASH', 'CARD', 'TRANSFER'] as PaymentMethodType[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  style={methodBtnStyle(method === m)}
                  onClick={() => setMethod(m)}
                >
                  {t(`payment.${m.toLowerCase() as 'cash' | 'card' | 'transfer'}`)}
                </button>
              ))}
            </div>
          </div>
          {method !== 'CASH' && (
            <div>
              <div style={styles.modalLabel}>{t('history.changeMethodReferenceLabel')}</div>
              <input
                style={styles.input}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={t('history.changeMethodReferencePlaceholder')}
              />
            </div>
          )}
        </div>
        <div style={styles.modalFoot}>
          <button type="button" style={styles.modalCancel} onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            style={styles.modalConfirm}
            disabled={!changed}
            onClick={() =>
              props.onConfirm({
                method,
                reference: method === 'CASH' ? null : (reference.trim() || null),
              })
            }
          >
            {t('common.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────────

// 'execute' runs the action immediately (manager+). 'suggest' creates a
// PENDING suggestion that a manager later approves/rejects (cashier). Same
// payload-collection modals either way; only the submit handler and the copy
// of the PIN modal differ.
//
// All PIN entry — for the cashier suggestion, the manager execute, and the
// manager approve/reject — flows through PinConfirmModal so the keypad UX
// matches the gate that protects entry to Order History itself. Delete and
// Change-Method are two-step: first the draft modal collects reason / method,
// then PinConfirmModal collects the PIN.
type ActionMode = 'execute' | 'suggest';

type PinAction =
  | { kind: 'reopen-pin'; order: ActiveOrder; mode: ActionMode }
  | { kind: 'delete-draft'; order: ActiveOrder; mode: ActionMode }
  | { kind: 'delete-pin'; order: ActiveOrder; mode: ActionMode; reason: string }
  | {
      kind: 'change-method-draft';
      order: ActiveOrder;
      payment: ActiveOrderPayment;
      mode: ActionMode;
    }
  | {
      kind: 'change-method-pin';
      order: ActiveOrder;
      payment: ActiveOrderPayment;
      mode: ActionMode;
      method: PaymentMethodType;
      reference: string | null;
    }
  | { kind: 'approve'; order: ActiveOrder; suggestion: PendingOrderSuggestion }
  | { kind: 'reject'; order: ActiveOrder; suggestion: PendingOrderSuggestion };

export function OrderHistory() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('SETTLED');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('ALL');
  const [tableFilter, setTableFilter] = useState<string>('');
  const [productFilter, setProductFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // Per-shift override of the default expand/collapse. Missing key = default
  // (OPEN shift expanded, everything else collapsed). Once the user toggles
  // a shift, their preference is sticky for the session.
  const [shiftOverrides, setShiftOverrides] = useState<Record<string, boolean>>({});
  const [pinAction, setPinAction] = useState<PinAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // +Filters popover. Holds payment / table / product (status stays visible
  // since it's the daily-use filter). Closes on outside-click or Esc.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersBtnRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // `/` focuses the search input, the usual gmail/Linear keybinding.
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const from = useMemo(startOfToday, []);
  const to = useMemo(endOfToday, []);

  // SETTLED passes no status filter to the server; OPEN orders are dropped
  // client-side below. PAID / CANCELLED pass through unchanged.
  const queryStatus: OrderStatus | undefined =
    statusFilter === 'SETTLED' ? undefined : statusFilter;
  const queryPayment: PaymentMethodType | undefined =
    paymentFilter === 'ALL' ? undefined : paymentFilter;

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery({
      queryKey: [
        'orders',
        'history',
        'today',
        queryStatus,
        queryPayment,
        productFilter || null,
        tableFilter || null,
      ],
      queryFn: ({ pageParam }) =>
        fetchOrderHistory({
          status: queryStatus,
          from,
          to,
          product_id: productFilter || undefined,
          payment_method: queryPayment,
          table_id: tableFilter || undefined,
          cursor: pageParam,
          limit: 30,
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  // Pull both: shifts that *opened* today AND the singleton OPEN shift (which
  // may have started before today and is still running — a long graveyard
  // shift). Merge on id so we don't double-render the same row.
  const shiftsQuery = useQuery({
    queryKey: ['registers', 'today-with-open'],
    queryFn: async () => {
      const [today, current] = await Promise.all([
        fetchShiftsForRange(from, to),
        fetchCurrentRegister(),
      ]);
      const seen = new Set(today.map((s) => s.id));
      if (current && !seen.has(current.id)) today.push(current);
      return today;
    },
    staleTime: 30_000,
  });

  // Product list for the filter dropdown. Cached aggressively — products
  // don't change mid-shift, so a single fetch per session is fine.
  const productsQuery = useQuery({
    queryKey: ['products', 'history-filter'],
    queryFn: fetchAllProducts,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    setExpanded(null);
  }, [statusFilter, paymentFilter, productFilter, tableFilter, search]);

  // Escape collapses the open row. Bails if a modal OR the +Filters popover
  // is open so the topmost overlay handles its own Esc first.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (document.querySelector('[role="dialog"], [data-filter-popover="true"]')) return;
      e.preventDefault();
      setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // `/` focuses search (Gmail / Linear convention). Ignored while typing
  // in a text field or with a modal / popover open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (document.querySelector('[role="dialog"], [data-filter-popover="true"]')) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close +Filters popover on outside-click or Esc.
  useEffect(() => {
    if (!filtersOpen) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t) || filtersBtnRef.current?.contains(t)) return;
      setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setFiltersOpen(false);
      filtersBtnRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  const allOrders = useMemo(
    () => (data?.pages.flatMap((page) => page.items) ?? []),
    [data],
  );

  // OPEN orders are filtered out unconditionally — this view is settled-only.
  // Then local search narrows whatever the server returned (server-side filters
  // shrink the page; search is the final client-side pass).
  const visibleOrders = useMemo(
    () => allOrders.filter((o) => o.status !== 'OPEN' && matchesSearch(o, search)),
    [allOrders, search],
  );

  // Tables that have orders today — only options worth offering in the dropdown.
  const tableOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const o of allOrders) {
      if (!o.table) continue;
      if (!map.has(o.table.id)) {
        map.set(o.table.id, {
          id: o.table.id,
          label: `${t('detail.tableLabel')} ${o.table.number}`,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allOrders, t]);

  const summary = useMemo(() => {
    let revenue = 0;
    let paidCount = 0;
    let cancelledCount = 0;
    for (const o of visibleOrders) {
      if (o.status === 'PAID') {
        paidCount += 1;
        revenue += Number(o.total);
      } else if (o.status === 'CANCELLED') {
        cancelledCount += 1;
      }
    }
    const avg = paidCount === 0 ? 0 : Math.round(revenue / paidCount);
    return { revenue, paidCount, cancelledCount, avg, total: visibleOrders.length };
  }, [visibleOrders]);

  // Group orders into shifts. The shift list comes from /registers (so a shift
  // that opened today but has no orders yet still shows up); orders not
  // attached to any of those shifts (rare — old order anchored to a closed
  // shift from yesterday) get bucketed under "Other".
  const groupedShifts = useMemo(() => {
    type Bucket = {
      shift: CashRegisterRow | null;
      orders: ActiveOrder[];
    };
    const buckets = new Map<string, Bucket>();
    const shifts = shiftsQuery.data ?? [];
    for (const s of shifts) {
      buckets.set(s.id, { shift: s, orders: [] });
    }
    for (const o of visibleOrders) {
      const b = buckets.get(o.register_id);
      if (b) {
        b.orders.push(o);
      } else {
        const otherKey = `other:${o.register_id}`;
        const existing = buckets.get(otherKey);
        if (existing) existing.orders.push(o);
        else buckets.set(otherKey, { shift: null, orders: [o] });
      }
    }
    // Sort shifts: OPEN first, then most recently opened.
    return Array.from(buckets.values()).sort((a, b) => {
      const aOpen = a.shift?.status === 'OPEN' ? 0 : 1;
      const bOpen = b.shift?.status === 'OPEN' ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      const aTime = a.shift?.opened_at ?? a.orders[0]?.created_at ?? '';
      const bTime = b.shift?.opened_at ?? b.orders[0]?.created_at ?? '';
      return bTime.localeCompare(aTime);
    });
  }, [visibleOrders, shiftsQuery.data]);

  // Closed shifts with zero orders are folded into a single footer line so
  // a multi-shift day doesn't waste 50px per empty section. The OPEN shift
  // is never folded, even when empty: it's the active shift and the user
  // expects to see it.
  const visibleBuckets = useMemo(
    () => groupedShifts.filter((b) => b.orders.length > 0 || b.shift?.status === 'OPEN'),
    [groupedShifts],
  );
  const aggregatedEmptyShifts = useMemo(
    () => groupedShifts.filter((b) => b.orders.length === 0 && b.shift?.status !== 'OPEN'),
    [groupedShifts],
  );

  // ──── Mutations
  // Two flavors: EXECUTE (manager+) hits the direct endpoint; SUGGEST (cashier)
  // queues a Suggestion that a manager later approves. The mutationFn dispatches
  // on mode so the UI can share one set of modals.
  const reopenMut = useMutation({
    mutationFn: async (vars: { orderId: string; pin: string; reason?: string; mode: ActionMode }) => {
      if (vars.mode === 'suggest') {
        await createOrderSuggestion(vars.orderId, {
          type: 'ORDER_REOPEN',
          pin: vars.pin,
          reason: vars.reason,
        });
        return;
      }
      await reopenOrder(vars.orderId, { pin: vars.pin, reason: vars.reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      setPinAction(null);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.unknownError')),
  });
  const deleteMut = useMutation({
    mutationFn: async (vars: { orderId: string; reason: string; pin: string; mode: ActionMode }) => {
      if (vars.mode === 'suggest') {
        await createOrderSuggestion(vars.orderId, {
          type: 'ORDER_DELETE',
          pin: vars.pin,
          reason: vars.reason,
        });
        return;
      }
      await softDeleteOrder(vars.orderId, { reason: vars.reason, pin: vars.pin });
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      // Only collapse the row when we actually executed — for a suggestion
      // the manager will still need to see it.
      if (vars.mode === 'execute') setExpanded(null);
      setPinAction(null);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.unknownError')),
  });
  const changeMethodMut = useMutation({
    mutationFn: async (vars: {
      orderId: string;
      paymentId: string;
      method: PaymentMethodType;
      reference: string | null;
      pin: string;
      mode: ActionMode;
    }) => {
      if (vars.mode === 'suggest') {
        await createOrderSuggestion(vars.orderId, {
          type: 'ORDER_CHANGE_PAYMENT',
          pin: vars.pin,
          payment_id: vars.paymentId,
          method: vars.method,
          reference: vars.reference,
        });
        return;
      }
      await updatePaymentMethod(vars.orderId, vars.paymentId, {
        pin: vars.pin,
        method: vars.method,
        reference: vars.reference,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setPinAction(null);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.unknownError')),
  });

  // Manager review of a pending suggestion. Approve calls the underlying
  // destructive flow; Reject only flips the suggestion row.
  const approveMut = useMutation({
    mutationFn: (vars: { suggestionId: string; pin: string }) =>
      approveOrderSuggestion(vars.suggestionId, { pin: vars.pin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['floors'] });
      setPinAction(null);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.unknownError')),
  });
  const rejectMut = useMutation({
    mutationFn: (vars: { suggestionId: string; pin: string }) =>
      rejectOrderSuggestion(vars.suggestionId, { pin: vars.pin }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      setPinAction(null);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : t('common.unknownError')),
  });

  const closePinAction = () => {
    setPinAction(null);
    setActionError(null);
    reopenMut.reset();
    deleteMut.reset();
    changeMethodMut.reset();
    approveMut.reset();
    rejectMut.reset();
  };

  const filtersActive =
    statusFilter !== 'SETTLED' ||
    paymentFilter !== 'ALL' ||
    tableFilter !== '' ||
    productFilter !== '' ||
    search !== '';

  const clearFilters = () => {
    setStatusFilter('SETTLED');
    setPaymentFilter('ALL');
    setTableFilter('');
    setProductFilter('');
    setSearch('');
  };

  // The "primary" shift is the one expanded on first paint: the open shift if
  // any, otherwise the most recent shift with orders so the page is never empty.
  const primaryShiftKey = useMemo(() => {
    const open = groupedShifts.find((b) => b.shift?.status === 'OPEN');
    if (open?.shift) return open.shift.id;
    for (let i = 0; i < groupedShifts.length; i++) {
      const b = groupedShifts[i];
      if (b.orders.length > 0) return b.shift?.id ?? `other-${i}`;
    }
    return null;
  }, [groupedShifts]);

  // Resolve current collapsed state for a shift. Filter active = expand all
  // (so search hits aren't hidden inside a closed section).
  const isShiftCollapsed = (key: string): boolean => {
    if (filtersActive) return false;
    if (key in shiftOverrides) return shiftOverrides[key];
    return key !== primaryShiftKey;
  };

  const toggleShift = (key: string) => {
    setShiftOverrides((prev) => {
      const currentlyCollapsed = isShiftCollapsed(key);
      return { ...prev, [key]: !currentlyCollapsed };
    });
  };

  // Stat strip pieces — paid revenue leads (it's the operator's first question
  // between rushes). Zeros are dropped to keep the line quiet. `revenue` is the
  // paid revenue (already only counts PAID), `avg` is paid / count.
  const statItems = useMemo(() => {
    const items: Array<{ label: string; value: string; accent?: 'gold' | 'danger' }> = [];
    if (summary.paidCount > 0) {
      items.push({ label: t('history.statPaid'), value: formatMoney(String(summary.revenue)), accent: 'gold' });
    }
    items.push({ label: t('history.statOrders'), value: String(summary.total) });
    if (summary.paidCount > 0) {
      items.push({ label: t('history.statAvg'), value: formatMoney(String(summary.avg)) });
    }
    if (summary.cancelledCount > 0) {
      items.push({
        label: t('history.statCancelled'),
        value: String(summary.cancelledCount),
        accent: 'danger',
      });
    }
    return items;
  }, [summary, t]);

  return (
    <div style={styles.root}>
      <header style={styles.head}>
        <div style={styles.titleBlock}>
          <h1 style={styles.title}>{t('history.title')}</h1>
        </div>
        <div style={styles.statStrip} aria-label={t('history.statStripAria')}>
          {statItems.map((item) => (
            <div
              key={item.label}
              style={styles.statItem}
              aria-label={`${item.value} ${item.label}`}
            >
              <span
                style={
                  item.accent === 'gold'
                    ? styles.statValueAccent
                    : item.accent === 'danger'
                      ? styles.statValueDanger
                      : styles.statValue
                }
              >
                {item.value}
              </span>
              <span style={styles.statLabel} aria-hidden="true">{item.label}</span>
            </div>
          ))}
        </div>
      </header>

      {(() => {
        const popoverFilterCount =
          (paymentFilter !== 'ALL' ? 1 : 0) +
          (tableFilter ? 1 : 0) +
          (productFilter ? 1 : 0);
        const tableLabelFor = (id: string) =>
          tableOptions.find((o) => o.id === id)?.label ?? '—';
        const productLabelFor = (id: string) =>
          (productsQuery.data ?? []).find((p: PosProduct) => p.id === id)?.name ?? '—';
        const paymentLabelFor = (m: PaymentFilter) =>
          m === 'CASH' ? t('payment.cash')
            : m === 'CARD' ? t('payment.card')
            : m === 'TRANSFER' ? t('payment.transfer')
            : t('history.filterAll');
        return (
          <div style={styles.toolbar}>
            {/* Primary: free-text search */}
            <label style={styles.search}>
              <IconSearch
                aria-hidden="true"
                style={{ color: 'var(--text3)', fontSize: 15, flexShrink: 0 }}
              />
              <input
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder={t('history.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('history.searchPlaceholder')}
              />
            </label>

            {/* Primary categorical: status (kept visible, daily-use filter) */}
            <div role="radiogroup" aria-label={t('history.status')} style={styles.segGroup}>
              {STATUS_FILTERS.map((f, i) => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={statusFilter === f.value}
                  style={segOption(statusFilter === f.value, i === 0)}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {t(f.labelKey)}
                </button>
              ))}
            </div>

            {/* Overflow: payment / table / product behind one popover */}
            <div style={styles.filtersAnchor}>
              <button
                ref={filtersBtnRef}
                type="button"
                style={{ ...styles.filtersBtnBase, ...filtersBtnStyle(filtersOpen) }}
                onClick={() => setFiltersOpen((o) => !o)}
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                aria-label={t('history.filtersButton')}
              >
                <IconPlus style={{ fontSize: 13 }} aria-hidden="true" />
                {t('history.filtersButton')}
                {popoverFilterCount > 0 && (
                  <span style={styles.filtersBtnCount} aria-hidden="true">
                    {popoverFilterCount}
                  </span>
                )}
              </button>
              {filtersOpen && (
                <div
                  ref={popoverRef}
                  role="dialog"
                  aria-label={t('history.filtersButton')}
                  data-filter-popover="true"
                  style={styles.popover}
                >
                  <div style={styles.popoverGroup}>
                    <span style={styles.popoverLabel}>{t('history.payment')}</span>
                    <div role="radiogroup" aria-label={t('history.payment')} style={styles.popoverSeg}>
                      {PAYMENT_FILTERS.map((f, i) => (
                        <button
                          key={f.value}
                          type="button"
                          role="radio"
                          aria-checked={paymentFilter === f.value}
                          style={popoverSegOption(paymentFilter === f.value, i === 0)}
                          onClick={() => setPaymentFilter(f.value)}
                        >
                          {t(f.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={styles.popoverGroup}>
                    <span style={styles.popoverLabel}>{t('history.tableLabel')}</span>
                    <select
                      style={styles.popoverSelect}
                      value={tableFilter}
                      onChange={(e) => setTableFilter(e.target.value)}
                      aria-label={t('history.tableLabel')}
                    >
                      <option value="">{t('history.filterAll')}</option>
                      {tableOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  <div style={styles.popoverGroup}>
                    <span style={styles.popoverLabel}>{t('history.productLabel')}</span>
                    <select
                      style={styles.popoverSelect}
                      value={productFilter}
                      onChange={(e) => setProductFilter(e.target.value)}
                      aria-label={t('history.productLabel')}
                    >
                      <option value="">{t('history.filterAll')}</option>
                      {(productsQuery.data ?? []).map((p: PosProduct) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Applied chips reflect popover-only filters; status uses its own
                segmented control as the affordance. */}
            {popoverFilterCount > 0 && (
              <div style={styles.chipRow} aria-label={t('history.appliedFilters')}>
                {paymentFilter !== 'ALL' && (
                  <span style={styles.chip}>
                    <span style={styles.chipLabel}>{t('history.payment')}</span>
                    <span style={styles.chipValue}>{paymentLabelFor(paymentFilter)}</span>
                    <button
                      type="button"
                      style={styles.chipRemove}
                      onClick={() => setPaymentFilter('ALL')}
                      aria-label={t('history.removeFilter').replace('{label}', t('history.payment'))}
                    >
                      <IconClose style={{ fontSize: 11 }} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {tableFilter && (
                  <span style={styles.chip}>
                    <span style={styles.chipLabel}>{t('history.tableLabel')}</span>
                    <span style={styles.chipValue}>{tableLabelFor(tableFilter)}</span>
                    <button
                      type="button"
                      style={styles.chipRemove}
                      onClick={() => setTableFilter('')}
                      aria-label={t('history.removeFilter').replace('{label}', t('history.tableLabel'))}
                    >
                      <IconClose style={{ fontSize: 11 }} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {productFilter && (
                  <span style={styles.chip}>
                    <span style={styles.chipLabel}>{t('history.productLabel')}</span>
                    <span style={styles.chipValue}>{productLabelFor(productFilter)}</span>
                    <button
                      type="button"
                      style={styles.chipRemove}
                      onClick={() => setProductFilter('')}
                      aria-label={t('history.removeFilter').replace('{label}', t('history.productLabel'))}
                    >
                      <IconClose style={{ fontSize: 11 }} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            )}

            {filtersActive && (
              <button type="button" style={styles.clearFilters} onClick={clearFilters}>
                {t('history.clearFilters')}
              </button>
            )}
          </div>
        );
      })()}

      <div style={styles.body}>
        {isLoading && (
          <div style={styles.loadingState}>
            <Spinner size={26} />
            <div>{t('common.loading')}…</div>
          </div>
        )}

        {!isLoading && error && (
          <div style={styles.errorState}>
            {error instanceof ApiError ? error.message : t('orders.failedLoad')}
            <div style={{ marginTop: 12 }}>
              <button type="button" style={styles.loadMore} onClick={() => refetch()}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        )}

        {!isLoading && !error && visibleOrders.length === 0 && (
          <div style={styles.empty}>
            {filtersActive ? t('history.emptyFiltered') : t('history.emptyToday')}
          </div>
        )}

        {!isLoading && !error && visibleOrders.length > 0 && (
          <div style={styles.ledger}>
            <div style={styles.thSticky}>
              <div style={styles.th}>
                <span>#</span>
                <span>{t('history.colTime')}</span>
                <span>{t('history.colTable')}</span>
                <span style={styles.cellNum}>{t('history.colQty')}</span>
                <span>{t('history.colWaiter')}</span>
                <span>{t('history.colPayment')}</span>
                <span style={styles.cellNum}>{t('history.colTotal')}</span>
                <span>{t('history.colStatus')}</span>
                <span />
              </div>
            </div>

            {visibleBuckets.map((bucket, idx) => {
              const shiftKey = bucket.shift?.id ?? `other-${idx}`;
              const collapsed = isShiftCollapsed(shiftKey);
              const hasOrders = bucket.orders.length > 0;
              // Only an OPEN-but-empty shift can land here without orders;
              // closed empties are folded into the footer below the map.
              const compact = !hasOrders;
              const isOpenShift = bucket.shift?.status === 'OPEN';
              const headerLabel = bucket.shift
                ? bucket.shift.user.name
                : t('history.shiftOther');

              // A shift that opened before midnight today is a graveyard
              // shift carrying over from yesterday; surface that so the
              // "opened 11:32 PM" doesn't read as today's time.
              const openedYesterday = bucket.shift?.opened_at
                ? new Date(bucket.shift.opened_at).getTime() < from.getTime()
                : false;

              // Aggregate carries the order count + revenue when there are
              // orders; the meta line only adds the count when there are none.
              const shiftRevenue = bucket.orders.reduce(
                (acc, o) => (o.status === 'PAID' ? acc + Number(o.total) : acc),
                0,
              );

              const metaParts: string[] = [];
              if (bucket.shift?.opened_at) {
                const prefix = openedYesterday
                  ? `${t('history.yesterday').toLowerCase()} `
                  : '';
                metaParts.push(
                  `${t('history.shiftOpened').toLowerCase()} ${prefix}${formatHistoryTime(bucket.shift.opened_at)}`,
                );
              }
              if (bucket.shift?.closed_at) {
                metaParts.push(`${t('history.shiftClosed').toLowerCase()} ${formatHistoryTime(bucket.shift.closed_at)}`);
              }
              if (bucket.orders.length === 0) {
                metaParts.push(`${bucket.orders.length} ${t('history.ordersWord')}`);
              }
              const meta = metaParts.join(' · ');

              const dividerStyle: React.CSSProperties = {
                ...styles.shiftDivider,
                ...(compact ? styles.shiftDividerCompact : {}),
              };

              return (
                <div key={shiftKey} style={styles.shiftCard}>
                  <div
                    className={compact ? undefined : 'history-shift'}
                    style={dividerStyle}
                    role={compact ? undefined : 'button'}
                    tabIndex={compact ? undefined : 0}
                    aria-expanded={compact ? undefined : !collapsed}
                    onClick={compact ? undefined : () => toggleShift(shiftKey)}
                    onKeyDown={
                      compact
                        ? undefined
                        : (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleShift(shiftKey);
                            }
                          }
                    }
                  >
                    <span
                      style={{
                        ...styles.shiftCaret,
                        transform: collapsed || compact ? 'rotate(-90deg)' : 'rotate(0deg)',
                        visibility: compact ? 'hidden' : 'visible',
                      }}
                      aria-hidden="true"
                    >
                      <IconChevronDown style={{ width: '1em', height: '1em' }} />
                    </span>
                    <div style={styles.shiftHeading}>
                      <div style={styles.shiftTitleRow}>
                        <span style={{ ...styles.shiftTitle, ...(compact ? styles.shiftTitleCompact : {}) }}>
                          {headerLabel}
                        </span>
                        {isOpenShift && (
                          <span style={styles.shiftOngoingTag}>
                            <span aria-hidden="true" style={styles.shiftOngoingDot} />
                            {t('history.shiftOpen')}
                          </span>
                        )}
                      </div>
                      <span style={styles.shiftMeta}>{meta}</span>
                    </div>
                    {bucket.orders.length > 0 && (
                      <div
                        style={styles.shiftAggregate}
                        aria-label={`${formatMoney(String(shiftRevenue))} · ${bucket.orders.length} ${t('history.ordersWord')}`}
                      >
                        <span style={styles.shiftAggregateValue}>
                          {formatMoney(String(shiftRevenue))}
                        </span>
                        <span style={styles.shiftAggregateLabel} aria-hidden="true">
                          {bucket.orders.length} {t('history.ordersWord')}
                        </span>
                      </div>
                    )}
                  </div>

                  {!collapsed && hasOrders && bucket.orders.map((order, rowIdx) => {
                    const isOpen = expanded === order.id;
                    const isLast = rowIdx === bucket.orders.length - 1;
                    const pay = summarizePayments(order, t);
                    const itemCount = order.items.reduce((acc, it) => acc + it.quantity, 0);
                    // OPEN is filtered out of visibleOrders upstream, so every
                    // order rendered here is a settled state.
                    const settled = order.status as SettledStatus;
                    // The last row inside a card hands its bottom border to the
                    // card frame; if it's the open one, the expanded body takes
                    // over and gets the same treatment below.
                    const rowHidesBorder = isLast && !isOpen;
                    const pendingSuggestion = order.suggestions?.[0] ?? null;
                    return (
                      <div key={order.id}>
                        <div
                          className="history-row"
                          role="button"
                          tabIndex={0}
                          aria-expanded={isOpen}
                          style={{
                            ...styles.trBase,
                            background: rowTintFor(settled, isOpen),
                            ...(rowHidesBorder ? { borderBottom: 'none' } : {}),
                            // Pending suggestion paints last so it wins over both
                            // the default and the cancel tint — managers should
                            // see "this needs attention" first.
                            ...(pendingSuggestion ? styles.suggestionRow : {}),
                          }}
                          onClick={() => setExpanded(isOpen ? null : order.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setExpanded(isOpen ? null : order.id);
                            }
                          }}
                        >
                          <span style={styles.cellOrderNum}>#{order.order_number}</span>
                          <span style={styles.cellMuted}>{formatHistoryTime(order.created_at)}</span>
                          <span>{tableLabel(order, t)}</span>
                          <span style={{ ...styles.cellNum, ...styles.cellMuted }}>{itemCount}</span>
                          <span style={styles.cellMuted}>{order.user.name}</span>
                          <span style={styles.cellMuted}>{pay.label}</span>
                          <span style={styles.cellNum}>
                            {formatMoney(order.total)}
                          </span>
                          <span>
                            {pendingSuggestion ? (
                              <span style={styles.suggestionBadge}>
                                {t('history.suggestionBadgeShort')}
                              </span>
                            ) : (
                              <span style={statusBadgeStyle(settled)}>
                                {t(STATUS_LABEL_KEYS[settled])}
                              </span>
                            )}
                          </span>
                          <span
                            aria-hidden="true"
                            style={{
                              ...styles.expandIcon,
                              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                            }}
                          >
                            <IconChevronDown style={{ width: '1em', height: '1em' }} />
                          </span>
                        </div>
                        {isOpen && (
                          <ExpandedOrder
                            order={order}
                            isManager={isManager}
                            hideBorder={isLast}
                            onReopen={() => {
                              setActionError(null);
                              setPinAction({
                                kind: 'reopen-pin',
                                order,
                                mode: isManager ? 'execute' : 'suggest',
                              });
                            }}
                            onDelete={() => {
                              setActionError(null);
                              setPinAction({
                                kind: 'delete-draft',
                                order,
                                mode: isManager ? 'execute' : 'suggest',
                              });
                            }}
                            onChangePayment={(payment) => {
                              setActionError(null);
                              setPinAction({
                                kind: 'change-method-draft',
                                order,
                                payment,
                                mode: isManager ? 'execute' : 'suggest',
                              });
                            }}
                            onApproveSuggestion={(suggestion) => {
                              setActionError(null);
                              setPinAction({ kind: 'approve', order, suggestion });
                            }}
                            onRejectSuggestion={(suggestion) => {
                              setActionError(null);
                              setPinAction({ kind: 'reject', order, suggestion });
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {aggregatedEmptyShifts.length > 0 && (() => {
              const names = aggregatedEmptyShifts
                .map((b) => b.shift?.user.name)
                .filter((n): n is string => Boolean(n))
                .join(', ');
              const text =
                aggregatedEmptyShifts.length === 1
                  ? t('history.emptyShiftLine').replace('{name}', names || '—')
                  : t('history.emptyShiftsLine')
                      .replace('{count}', String(aggregatedEmptyShifts.length))
                      .replace('{names}', names || '—');
              return <div style={styles.emptyShiftsFooter}>{text}</div>;
            })()}
          </div>
        )}

        {hasNextPage && !error && (
          <div style={styles.loadMoreWrap}>
            <button
              type="button"
              style={styles.loadMore}
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? <Spinner size={14} /> : null}
              {isFetchingNextPage ? `${t('common.loading')}…` : t('history.loadMore')}
            </button>
          </div>
        )}
      </div>

      {pinAction?.kind === 'reopen-pin' && (
        <PinConfirmModal
          title={
            pinAction.mode === 'suggest'
              ? t('history.suggestionTypeReopen')
              : t('history.reopenTitle')
          }
          message={
            pinAction.mode === 'suggest'
              ? t('history.reopenSuggestSub').replace('{n}', String(pinAction.order.order_number))
              : t('history.reopenMessage').replace('{n}', String(pinAction.order.order_number))
          }
          confirmLabel={
            pinAction.mode === 'suggest'
              ? t('history.suggestSubmit')
              : t('history.reopenConfirm')
          }
          busy={reopenMut.isPending}
          error={actionError}
          onClose={closePinAction}
          onConfirm={(pin) =>
            reopenMut.mutate({
              orderId: pinAction.order.id,
              pin,
              mode: pinAction.mode,
            })
          }
        />
      )}
      {pinAction?.kind === 'delete-draft' && (
        <SoftDeleteModal
          orderNumber={pinAction.order.order_number}
          mode={pinAction.mode}
          onClose={closePinAction}
          onConfirm={({ reason }) => {
            setActionError(null);
            setPinAction({
              kind: 'delete-pin',
              order: pinAction.order,
              mode: pinAction.mode,
              reason,
            });
          }}
        />
      )}
      {pinAction?.kind === 'delete-pin' && (
        <PinConfirmModal
          title={
            pinAction.mode === 'suggest'
              ? t('history.suggestionTypeDelete')
              : t('history.deleteOrderTitle')
          }
          message={
            pinAction.mode === 'suggest'
              ? t('history.deleteSuggestSub').replace('{n}', String(pinAction.order.order_number))
              : t('history.deleteOrderSub').replace('{n}', String(pinAction.order.order_number))
          }
          confirmLabel={
            pinAction.mode === 'suggest'
              ? t('history.suggestSubmit')
              : t('history.deleteConfirm')
          }
          busy={deleteMut.isPending}
          error={actionError}
          onClose={closePinAction}
          onConfirm={(pin) =>
            deleteMut.mutate({
              orderId: pinAction.order.id,
              reason: pinAction.reason,
              pin,
              mode: pinAction.mode,
            })
          }
        />
      )}
      {pinAction?.kind === 'change-method-draft' && (
        <ChangePaymentMethodModal
          payment={pinAction.payment}
          mode={pinAction.mode}
          onClose={closePinAction}
          onConfirm={({ method, reference }) => {
            setActionError(null);
            setPinAction({
              kind: 'change-method-pin',
              order: pinAction.order,
              payment: pinAction.payment,
              mode: pinAction.mode,
              method,
              reference,
            });
          }}
        />
      )}
      {pinAction?.kind === 'change-method-pin' && (
        <PinConfirmModal
          title={
            pinAction.mode === 'suggest'
              ? t('history.changeMethodSuggestTitle')
              : t('history.changeMethodTitle')
          }
          message={(pinAction.mode === 'suggest'
            ? t('history.changeMethodSuggestSub')
            : t('history.changeMethodSub')
          )
            .replace(
              '{from}',
              t(`payment.${pinAction.payment.method.toLowerCase() as 'cash' | 'card' | 'transfer'}`),
            )
            .replace('{amount}', formatMoney(pinAction.payment.amount))}
          confirmLabel={
            pinAction.mode === 'suggest'
              ? t('history.suggestSubmit')
              : t('history.changeMethodConfirm')
          }
          busy={changeMethodMut.isPending}
          error={actionError}
          onClose={closePinAction}
          onConfirm={(pin) =>
            changeMethodMut.mutate({
              orderId: pinAction.order.id,
              paymentId: pinAction.payment.id,
              method: pinAction.method,
              reference: pinAction.reference,
              pin,
              mode: pinAction.mode,
            })
          }
        />
      )}
      {pinAction?.kind === 'approve' && (
        <PinConfirmModal
          title={t('history.approveTitle')}
          message={t('history.approveMessage').replace('{n}', String(pinAction.order.order_number))}
          confirmLabel={t('history.approveConfirm')}
          busy={approveMut.isPending}
          error={actionError}
          onClose={closePinAction}
          onConfirm={(pin) =>
            approveMut.mutate({ suggestionId: pinAction.suggestion.id, pin })
          }
        />
      )}
      {pinAction?.kind === 'reject' && (
        <PinConfirmModal
          title={t('history.rejectTitle')}
          message={t('history.rejectMessage').replace('{n}', String(pinAction.order.order_number))}
          confirmLabel={t('history.rejectConfirm')}
          busy={rejectMut.isPending}
          error={actionError}
          onClose={closePinAction}
          onConfirm={(pin) =>
            rejectMut.mutate({ suggestionId: pinAction.suggestion.id, pin })
          }
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Expanded order detail
// ────────────────────────────────────────────────────────────────────────────

interface ExpandedOrderProps {
  order: ActiveOrder;
  // Manager+ vs cashier. Controls whether the action buttons execute the
  // change directly or queue a suggestion, and whether the Approve/Reject
  // panel is rendered for any pending suggestion on the order.
  isManager: boolean;
  // True when this expansion belongs to the last row inside a shift card.
  // The card frame then carries the bottom edge instead of the expanded body.
  hideBorder: boolean;
  onReopen: () => void;
  onDelete: () => void;
  onChangePayment: (payment: ActiveOrderPayment) => void;
  onApproveSuggestion: (suggestion: PendingOrderSuggestion) => void;
  onRejectSuggestion: (suggestion: PendingOrderSuggestion) => void;
}
function ExpandedOrder({
  order,
  isManager,
  hideBorder,
  onReopen,
  onDelete,
  onChangePayment,
  onApproveSuggestion,
  onRejectSuggestion,
}: ExpandedOrderProps) {
  const { t } = useTranslation();
  const items: ActiveOrderItem[] = order.items;
  const pendingSuggestion = order.suggestions?.[0] ?? null;
  // Only PAID orders can be reopened; only PAID/CANCELLED can be deleted.
  // Change-method targets the first non-payroll payment (typical orders have
  // one); for split payments, the user re-triggers to change others.
  // While a suggestion is pending we hide the action bar — there's already a
  // proposal in flight; the manager should resolve it before queueing another.
  const blockActions = Boolean(pendingSuggestion);
  const showReopen = !blockActions && order.status === 'PAID';
  const showDelete = !blockActions && (order.status === 'PAID' || order.status === 'CANCELLED');
  const changeablePayment = order.status === 'PAID'
    ? order.payments.find((p) => p.method !== 'PAYROLL_DEDUCT')
    : undefined;
  const showChangeMethod = !blockActions && Boolean(changeablePayment);

  return (
    <div style={{ ...styles.expandedBody, ...(hideBorder ? { borderBottom: 'none' } : {}) }}>
      <div style={styles.expandedGrid}>
        {/* ─── Items column */}
        <div style={styles.expandedSection}>
          <div style={styles.expandedHd}>
            {t('orders.itemsLabel')} · {items.length}
          </div>
          {items.length === 0 ? (
            <div style={{ padding: '10px 0', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
              {t('orders.noItemsAdded')}
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} style={styles.itemRow}>
                <span style={styles.itemQty}>{item.quantity}×</span>
                <div style={{ minWidth: 0 }}>
                  <div style={styles.itemName}>
                    {item.product.name}
                    {item.variant && ` · ${item.variant.name}`}
                  </div>
                  {item.modifiers.length > 0 && (
                    <div style={styles.itemMods}>
                      {item.modifiers.map((m) => m.name).join(' · ')}
                    </div>
                  )}
                  {item.notes && <div style={styles.itemNote}>{t('orders.note')}: {item.notes}</div>}
                </div>
                <span style={styles.itemPrice}>{formatMoney(item.line_total)}</span>
              </div>
            ))
          )}
          {order.notes && (
            <div style={styles.noteBlock}>{t('orders.notes')}: {order.notes}</div>
          )}
        </div>

        {/* ─── Totals + payments column */}
        <div style={styles.expandedSection}>
          <div style={styles.expandedHd}>{t('history.totals')}</div>
          <div style={styles.totalsBlock}>
            <span>{t('payment.subtotal')}</span>
            <span style={styles.totalsAmt}>{formatMoney(order.subtotal)}</span>
            <span>{t('payment.tax')}</span>
            <span style={styles.totalsAmt}>{formatMoney(order.tax_amount)}</span>
            {Number(order.discount_amount) > 0 && (
              <>
                <span>{t('detail.discount')}</span>
                <span style={{ ...styles.totalsAmt, color: 'var(--red)' }}>
                  – {formatMoney(order.discount_amount)}
                </span>
              </>
            )}
            <span style={styles.grandLabel}>{t('payment.total')}</span>
            <span style={styles.grandAmt}>{formatMoney(order.total)}</span>
          </div>

          <div style={{ ...styles.expandedHd, marginTop: 18 }}>
            {t('history.colPayment')} · {order.payments.length}
          </div>
          {order.payments.length === 0 ? (
            <div style={{ padding: '10px 0', color: 'var(--text3)', fontSize: 13, fontStyle: 'italic' }}>
              {order.status === 'CANCELLED' ? t('history.orderCancelled') : t('history.noPayments')}
            </div>
          ) : (
            order.payments.map((p) => (
              <div key={p.id} style={styles.paymentRow}>
                <span style={{ color: 'var(--text2)' }}>
                  {p.method === 'CASH' ? t('payment.cash')
                    : p.method === 'CARD' ? t('payment.card')
                    : p.method === 'TRANSFER' ? t('payment.transfer')
                    : p.method}
                </span>
                <span
                  style={{
                    color: 'var(--text3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.reference || formatHistoryTime(p.created_at)}
                </span>
                <span style={{ color: 'var(--text1)', fontWeight: 600 }}>
                  {formatMoney(p.amount)}
                </span>
              </div>
            ))
          )}
        </div>

        {pendingSuggestion && (
          <SuggestionPanel
            order={order}
            suggestion={pendingSuggestion}
            isManager={isManager}
            onApprove={() => onApproveSuggestion(pendingSuggestion)}
            onReject={() => onRejectSuggestion(pendingSuggestion)}
          />
        )}

        {(showReopen || showDelete || showChangeMethod) && (
          <div style={styles.actionBar}>
            {showReopen && (
              <button type="button" style={styles.actionBtn} onClick={onReopen}>
                <IconReopen style={{ fontSize: 15 }} aria-hidden="true" />
                {t('history.actionReopen')}
              </button>
            )}
            {showChangeMethod && changeablePayment && (
              <button
                type="button"
                style={styles.actionBtn}
                onClick={() => onChangePayment(changeablePayment)}
              >
                <IconCash style={{ fontSize: 15 }} aria-hidden="true" />
                {t('history.actionChangeMethod')}
              </button>
            )}
            {showDelete && (
              <button
                type="button"
                style={{ ...styles.actionBtn, ...styles.actionBtnDanger }}
                onClick={onDelete}
              >
                <IconClose style={{ fontSize: 13 }} aria-hidden="true" />
                {t('history.actionDelete')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Suggestion panel — surfaces a PENDING cashier suggestion inside the
// expanded body. Manager+ sees Approve / Reject; cashier sees a read-only
// "waiting for manager" card.
// ────────────────────────────────────────────────────────────────────────────

interface SuggestionPanelProps {
  order: ActiveOrder;
  suggestion: PendingOrderSuggestion;
  isManager: boolean;
  onApprove: () => void;
  onReject: () => void;
}
function SuggestionPanel({ suggestion, isManager, onApprove, onReject }: SuggestionPanelProps) {
  const { t } = useTranslation();
  const payload = suggestion.payload ?? {};

  // Human-readable summary of the proposed action. The payload shape depends
  // on the suggestion type — we read the keys we know about and fall back to
  // a generic label.
  let actionLine = '';
  switch (suggestion.type) {
    case 'ORDER_REOPEN':
      actionLine = t('history.suggestionTypeReopen');
      break;
    case 'ORDER_DELETE':
      actionLine = t('history.suggestionTypeDelete');
      break;
    case 'ORDER_CHANGE_PAYMENT': {
      const method = String(payload.method ?? '').toLowerCase();
      const methodLabel =
        method === 'cash' ? t('payment.cash')
          : method === 'card' ? t('payment.card')
          : method === 'transfer' ? t('payment.transfer')
          : String(payload.method ?? '—');
      actionLine = t('history.suggestionTypeChangeMethod').replace('{method}', methodLabel);
      break;
    }
  }

  const reason = typeof payload.reason === 'string' ? payload.reason : null;

  return (
    <div style={styles.suggestionPanel}>
      <div style={styles.suggestionPanelHd}>
        <span style={styles.suggestionPanelTitle}>
          {t('history.suggestionPanelTitle')}
        </span>
        <span style={styles.suggestionBadge}>{t('history.suggestionBadge')}</span>
      </div>
      <div style={styles.suggestionPanelLine}>{actionLine}</div>
      {reason && (
        <div style={styles.suggestionPanelReason}>
          {t('history.suggestionReasonLine').replace('{reason}', reason)}
        </div>
      )}
      <div style={styles.suggestionPanelBy}>
        {t('history.suggestionByLine').replace('{name}', suggestion.creator?.name ?? '—')}
      </div>
      {isManager && (
        <div style={styles.suggestionPanelActions}>
          <button type="button" style={styles.suggestionApproveBtn} onClick={onApprove}>
            {t('history.suggestionApprove')}
          </button>
          <button type="button" style={styles.suggestionRejectBtn} onClick={onReject}>
            {t('history.suggestionReject')}
          </button>
        </div>
      )}
    </div>
  );
}
