// Stock movements — read-only audit log of every supply movement.
// Backed by `GET /api/v1/stock-movements` (src/modules/stock-movements/routes.ts).
// Cursor pagination matches the rest of the terminal API: `cursor` is the id
// of the last returned row, `limit` defaults to 20 server-side.

import { api } from './client';
import type { PageResult } from './pagination';

export type StockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'WRITE_OFF'
  | 'ADJUSTMENT'
  | 'MANUFACTURE';

/** Row shape from the backend list endpoint with the joins enabled by
 *  movementInclude in stock-movements/service.ts. */
export interface StockMovementRow {
  id: string;
  supply_id: string;
  storage_id: string;
  type: StockMovementType;
  /** Signed quantity in base units. Stored as string to preserve precision. */
  quantity: string;
  /** Snake_case bag carrying the source document; e.g. "Purchase" + uuid. */
  reference_type: string;
  reference_id: string;
  /** Cost in centavos per base unit at the time of the movement. */
  unit_cost: string;
  created_at: string;
  supply: {
    id: string;
    name: string;
    base_unit: string;
  };
  storage: {
    id: string;
    name: string;
  };
}

export interface ListStockMovementParams {
  cursor?: string | null;
  limit?: number;
  supply_id?: string;
  storage_id?: string;
  /** Multi-select. Backend accepts a comma-separated list and parses each. */
  type?: StockMovementType[];
  reference_type?: string;
  reference_id?: string;
  /** ISO strings; backend coerces to Date. */
  from?: string;
  to?: string;
}

function buildQuery(params: ListStockMovementParams): string {
  const sp = new URLSearchParams();
  if (params.limit !== undefined) sp.set('limit', String(params.limit));
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.supply_id) sp.set('supply_id', params.supply_id);
  if (params.storage_id) sp.set('storage_id', params.storage_id);
  if (params.type && params.type.length > 0) {
    sp.set('type', params.type.join(','));
  }
  if (params.reference_type) sp.set('reference_type', params.reference_type);
  if (params.reference_id) sp.set('reference_id', params.reference_id);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  return sp.toString();
}

export function listStockMovements(
  params: ListStockMovementParams = {},
): Promise<PageResult<StockMovementRow>> {
  const qs = buildQuery(params);
  const suffix = qs ? `?${qs}` : '';
  return api.get<PageResult<StockMovementRow>>(`/stock-movements${suffix}`);
}
