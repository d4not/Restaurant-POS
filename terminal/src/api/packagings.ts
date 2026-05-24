import { api } from './client';
import type { PageResult } from './pagination';

// Packaging is how a supplier sells a supply: "Box of 6 bottles", "25kg bag",
// etc. One supply can have many packagings across many suppliers; the PO
// draft picks one when a line is added.
export interface PurchasePackaging {
  id: string;
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: string;
  /** Centavos. Last known price for this packaging — used to pre-fill the
   *  price field on a new PO line. */
  price_per_package: string | null;
  is_primary: boolean;
  active: boolean;
  supplier?: { id: string; name: string };
}

// POST /packagings payload.
export interface CreatePackagingInput {
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: number;
  /** Centavos integer. Null/undefined to leave unknown. */
  price_per_package?: number | null;
  is_primary?: boolean;
}

// PATCH /packagings/:id payload. supply_id/supplier_id are locked
// after creation — change them by deleting and re-creating.
export interface PackagingWriteInput {
  name?: string;
  units_per_package?: number;
  price_per_package?: number | null;
  is_primary?: boolean;
  active?: boolean;
}

export async function listPackagings(params: {
  supply_id?: string;
  supplier_id?: string;
  active?: boolean;
  limit?: number;
}): Promise<PurchasePackaging[]> {
  const sp = new URLSearchParams();
  sp.set('limit', String(params.limit ?? 100));
  if (params.supply_id) sp.set('supply_id', params.supply_id);
  if (params.supplier_id) sp.set('supplier_id', params.supplier_id);
  if (params.active !== undefined) sp.set('active', String(params.active));
  const page = await api.get<PageResult<PurchasePackaging>>(
    `/packagings?${sp.toString()}`,
  );
  return page.items;
}

export function createPackaging(
  input: CreatePackagingInput,
): Promise<PurchasePackaging> {
  return api.post<PurchasePackaging>('/packagings', input);
}

export function updatePackaging(
  id: string,
  input: PackagingWriteInput,
): Promise<PurchasePackaging> {
  return api.patch<PurchasePackaging>(`/packagings/${id}`, input);
}
