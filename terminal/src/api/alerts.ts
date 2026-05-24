import { api } from './client';

// Mirrors src/modules/alerts/service.ts → LowStockAlert. Quantities, min
// stock and shortfall come back as serialised decimals — the UI parses with
// decimal.js when displaying them so we don't accumulate float error.
export interface LowStockAlertRow {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  storage_id: string;
  storage_name: string;
  quantity: string;
  min_stock: string;
  shortfall: string;
  average_cost: string;
}

// Cross-storage low-stock alerts. Optional storage_id narrows to a specific
// storage; admin Transfer view leaves it off so it can suggest both sides
// of a possible move. The controller wraps the array in `{ items }` — we
// flatten on the way out so callers see a plain list.
export async function fetchLowStockAlerts(params: { storage_id?: string } = {}): Promise<LowStockAlertRow[]> {
  const sp = new URLSearchParams();
  if (params.storage_id) sp.set('storage_id', params.storage_id);
  const qs = sp.toString();
  const { items } = await api.get<{ items: LowStockAlertRow[] }>(
    `/alerts/low-stock${qs ? `?${qs}` : ''}`,
  );
  return items;
}
