import { api } from './client';
import type { PageResult } from './pagination';

export type PurchaseStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

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
  payment_method?: string;
  notes?: string;
  items?: CreatePurchaseItemInput[];
}

export interface Purchase {
  id: string;
  supplier_id: string;
  storage_id: string;
  date: string;
  status: PurchaseStatus;
  total: string;
  payment_method: string | null;
  notes: string | null;
  user_id: string;
}

// Enriched shape returned by GET /purchases (list) and GET /purchases/:id.
// Backend includes supplier/storage/user joins + items by default; modeled
// here as additive optional fields so plain createPurchase() callers don't
// see them.
export interface PurchaseItem {
  id: string;
  supply_id: string;
  packaging_id: string | null;
  package_quantity: string;
  price_per_package: string;
  base_unit_quantity?: string;
  unit_cost?: string;
  supply?: { id: string; name: string; base_unit?: string } | null;
  packaging?: {
    id: string;
    name: string;
    units_per_package: string;
  } | null;
}

export interface PurchaseDetail extends Purchase {
  items?: PurchaseItem[];
  supplier?: { id: string; name: string } | null;
  storage?: { id: string; name: string } | null;
  user?: { id: string; name: string } | null;
}

export interface ListPurchasesParams {
  supplier_id?: string;
  storage_id?: string;
  status?: PurchaseStatus | 'ALL';
  /** ISO date string. */
  from?: string;
  /** ISO date string. */
  to?: string;
  /** Per-page cap (backend max 100). Defaults to 50. */
  limit?: number;
}

// Drains pages until the backend reports no more or we hit the safety cap.
// Mirrors fetchPurchases in PurchaseOrdersView; promoted here so other views
// (SupplierDetailView's Purchase Orders tab) can share it.
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
    if (params.supplier_id) sp.set('supplier_id', params.supplier_id);
    if (params.storage_id) sp.set('storage_id', params.storage_id);
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
