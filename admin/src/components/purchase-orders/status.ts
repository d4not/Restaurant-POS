// Shared status metadata for purchase-order UI. Keeps every component (list
// pills, timeline, action panel) reading the same vocabulary so a new state
// only needs to be added in one place.
import type { PurchaseKind, PurchaseStatus } from '../../types/inventory';

export const STATUS_PILL_CLASS: Record<PurchaseStatus, string> = {
  DRAFT: 'po-status-pill draft',
  SENT_TO_SUPPLIER: 'po-status-pill sent',
  SUPPLIER_REPLIED: 'po-status-pill replied',
  PAID: 'po-status-pill paid',
  IN_TRANSIT: 'po-status-pill in-transit',
  ARRIVED: 'po-status-pill arrived',
  DISPATCHED: 'po-status-pill dispatched',
  RETURNED: 'po-status-pill returned',
  VERIFIED: 'po-status-pill verified',
  REJECTED: 'po-status-pill rejected',
  CANCELLED: 'po-status-pill cancelled',
  // Legacy alias — pre-redesign rows still parse cleanly.
  CONFIRMED: 'po-status-pill verified',
};

export const STATUS_I18N_KEY: Record<PurchaseStatus, string> = {
  DRAFT: 'po.status.draft',
  SENT_TO_SUPPLIER: 'po.status.sent',
  SUPPLIER_REPLIED: 'po.status.replied',
  PAID: 'po.status.paid',
  IN_TRANSIT: 'po.status.inTransit',
  ARRIVED: 'po.status.arrived',
  DISPATCHED: 'po.status.dispatched',
  RETURNED: 'po.status.returned',
  VERIFIED: 'po.status.verified',
  REJECTED: 'po.status.rejected',
  CANCELLED: 'po.status.cancelled',
  CONFIRMED: 'po.status.verified',
};

// Lifecycle ordering by kind — drives the timeline and "what's the next
// step" lookup in the detail page action panel. Terminal states (CANCELLED,
// REJECTED) live outside this ordering; the timeline shows them as a
// dead-end marker instead.
export const DELIVERY_FLOW: PurchaseStatus[] = [
  'DRAFT',
  'SENT_TO_SUPPLIER',
  'SUPPLIER_REPLIED',
  'PAID',
  'IN_TRANSIT',
  'ARRIVED',
  'VERIFIED',
];

export const ERRAND_FLOW: PurchaseStatus[] = [
  'DRAFT',
  'DISPATCHED',
  'RETURNED',
  'VERIFIED',
];

export function flowFor(kind: PurchaseKind): PurchaseStatus[] {
  return kind === 'ERRAND' ? ERRAND_FLOW : DELIVERY_FLOW;
}

export const KIND_ICON: Record<PurchaseKind, string> = {
  DELIVERY: '📱',
  ERRAND: '🚶',
};

export const KIND_I18N_KEY: Record<PurchaseKind, string> = {
  DELIVERY: 'po.kind.delivery',
  ERRAND: 'po.kind.errand',
};

// Is this status a non-terminal "in progress" state? Used to gate the
// cancel button (verified/cancelled/rejected can no longer be cancelled).
export function isTerminal(status: PurchaseStatus): boolean {
  return status === 'VERIFIED' || status === 'CANCELLED' || status === 'REJECTED';
}
