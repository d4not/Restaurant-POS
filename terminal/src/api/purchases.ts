import { api } from './client';
import type { PageResult } from './pagination';

// Extended lifecycle (Phase 2026-05 redesign). Legacy CONFIRMED still parses
// for historical rows; new code transitions to VERIFIED instead.
export type PurchaseStatus =
  | 'DRAFT'
  | 'SENT_TO_SUPPLIER'
  | 'SUPPLIER_REPLIED'
  | 'PAID'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'DISPATCHED'
  | 'RETURNED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'CONFIRMED';

export type PurchaseKind = 'DELIVERY' | 'ERRAND';

export interface CreatePurchaseItemInput {
  supply_id: string;
  packaging_id?: string | null;
  package_quantity: number;
  /** Price per package in CENTAVOS (integer). */
  price_per_package: number;
}

export interface CreatePurchaseInput {
  supplier_id: string;
  storage_id: string;
  /** ISO date string. */
  date: string;
  kind?: PurchaseKind;
  payment_method?: string;
  notes?: string;
  expected_arrival?: string | null;
  items?: CreatePurchaseItemInput[];
}

export interface Purchase {
  id: string;
  supplier_id: string;
  storage_id: string;
  date: string;
  status: PurchaseStatus;
  kind: PurchaseKind;
  total: string;
  payment_method: string | null;
  notes: string | null;
  user_id: string;
  // Lifecycle audit fields (sparse — most are null until the matching
  // transition fires).
  message_sent_at: string | null;
  supplier_replied_at: string | null;
  supplier_subtotal: string | null;
  shipping_cost: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  in_transit_at: string | null;
  arrived_at: string | null;
  expected_arrival: string | null;
  runner_user_id: string | null;
  cash_advanced: string | null;
  cash_returned: string | null;
  dispatched_at: string | null;
  returned_at: string | null;
  verified_at: string | null;
  verified_by_user_id: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
}

export interface PurchaseItem {
  id: string;
  supply_id: string;
  packaging_id: string | null;
  package_quantity: string;
  price_per_package: string;
  base_unit_quantity?: string;
  unit_cost?: string;
  received_package_quantity: string | null;
  shortfall_reason: string | null;
  unavailable: boolean;
  supply?: { id: string; name: string; base_unit?: string } | null;
  packaging?: {
    id: string;
    name: string;
    units_per_package: string;
  } | null;
}

export interface PurchaseDetail extends Purchase {
  items?: PurchaseItem[];
  supplier?: {
    id: string;
    name: string;
    kind?: string;
    whatsapp_phone?: string | null;
  } | null;
  storage?: { id: string; name: string } | null;
  user?: { id: string; name: string } | null;
  runner?: { id: string; name: string } | null;
  verifier?: { id: string; name: string } | null;
  canceller?: { id: string; name: string } | null;
}

export interface ListPurchasesParams {
  supplier_id?: string;
  storage_id?: string;
  status?: PurchaseStatus | 'ALL';
  kind?: PurchaseKind;
  runner_user_id?: string;
  from?: string;
  to?: string;
  limit?: number;
}

// Drains pages until the backend reports no more or we hit the safety cap.
export async function listPurchases(
  params: ListPurchasesParams = {},
): Promise<PurchaseDetail[]> {
  const out: PurchaseDetail[] = [];
  let cursor: string | null = null;
  const limit = params.limit ?? 50;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', String(limit));
    if (params.status && params.status !== 'ALL') sp.set('status', params.status);
    if (params.kind) sp.set('kind', params.kind);
    if (params.supplier_id) sp.set('supplier_id', params.supplier_id);
    if (params.storage_id) sp.set('storage_id', params.storage_id);
    if (params.runner_user_id) sp.set('runner_user_id', params.runner_user_id);
    if (params.from) sp.set('from', params.from);
    if (params.to) sp.set('to', params.to);
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<PurchaseDetail>>(
      `/purchases?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

export function createPurchase(input: CreatePurchaseInput): Promise<Purchase> {
  return api.post<Purchase>('/purchases', input);
}

// ─── Errand transitions (cashier-facing, used by ErrandModal) ──────────────

export interface DispatchInput {
  runner_user_id: string;
  cash_advanced: number;
  reason?: string;
}

export interface ReceivedItemInput {
  id: string;
  received_package_quantity: number;
  shortfall_reason?: string | null;
}

export interface ReturnInput {
  cash_returned?: number;
  reason?: string;
  items?: ReceivedItemInput[];
}

export function dispatchPurchase(id: string, input: DispatchInput): Promise<Purchase> {
  return api.post<Purchase>(`/purchases/${id}/dispatch`, input);
}

export function returnPurchase(id: string, input: ReturnInput): Promise<Purchase> {
  return api.post<Purchase>(`/purchases/${id}/return`, input);
}
