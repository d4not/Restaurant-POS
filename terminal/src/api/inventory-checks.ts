// Inventory checks — physical reconciliation of supply stock against the
// system's running totals. Mirrors src/modules/inventory-checks on the backend.
//
// Three states matter to the UI:
//   - IN_PROGRESS counts can have actual_qty updated row-by-row.
//   - COMPLETED counts are read-only; completing flips stock to the counted
//     values and writes ADJUSTMENT StockMovements.
//   - DRAFT does not exist server-side — creation immediately yields
//     IN_PROGRESS with one seeded item per supply (all of them for FULL,
//     the chosen subset for PARTIAL).

import { api } from './client';
import type { PageResult } from './pagination';

export type InventoryCheckType = 'FULL' | 'PARTIAL';
export type InventoryCheckStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface InventoryCheckSupply {
  id: string;
  name: string;
  base_unit: string;
}

export interface InventoryCheckItem {
  id: string;
  check_id: string;
  supply_id: string;
  expected_qty: string;
  actual_qty: string;
  difference: string;
  // Cost impact of the diff, in centavos (matches the backend's Decimal mul).
  difference_cost: string;
  supply: InventoryCheckSupply;
}

export interface InventoryCheck {
  id: string;
  storage_id: string;
  type: InventoryCheckType;
  status: InventoryCheckStatus;
  date: string;
  user_id: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  storage: { id: string; name: string };
  user: { id: string; name: string };
  items: InventoryCheckItem[];
}

export interface ListInventoryChecksParams {
  cursor?: string;
  limit?: number;
  storage_id?: string;
  status?: InventoryCheckStatus;
  from?: string;
  to?: string;
}

export interface CreateInventoryCheckInput {
  storage_id: string;
  type: InventoryCheckType;
  // ISO date — the backend uses z.coerce.date, so a YYYY-MM-DD string from a
  // <input type="date"> works just as well as a full ISO timestamp.
  date: string;
  supply_ids?: string[];
}

export interface SetCheckItemsInput {
  items: Array<{ supply_id: string; actual_qty: number }>;
}

export async function listInventoryChecks(
  params: ListInventoryChecksParams = {},
): Promise<PageResult<InventoryCheck>> {
  const sp = new URLSearchParams();
  if (params.cursor) sp.set('cursor', params.cursor);
  sp.set('limit', String(params.limit ?? 50));
  if (params.storage_id) sp.set('storage_id', params.storage_id);
  if (params.status) sp.set('status', params.status);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  return api.get<PageResult<InventoryCheck>>(`/inventory-checks?${sp.toString()}`);
}

export function getInventoryCheck(id: string): Promise<InventoryCheck> {
  return api.get<InventoryCheck>(`/inventory-checks/${id}`);
}

export function createInventoryCheck(
  input: CreateInventoryCheckInput,
): Promise<InventoryCheck> {
  return api.post<InventoryCheck>('/inventory-checks', input);
}

export function setInventoryCheckItems(
  id: string,
  input: SetCheckItemsInput,
): Promise<InventoryCheck> {
  return api.patch<InventoryCheck>(`/inventory-checks/${id}/items`, input);
}

export function completeInventoryCheck(id: string): Promise<InventoryCheck> {
  return api.post<InventoryCheck>(`/inventory-checks/${id}/complete`, {});
}

export function deleteInventoryCheck(id: string): Promise<void> {
  return api.delete(`/inventory-checks/${id}`);
}
