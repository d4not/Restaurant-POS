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

export interface AlertRow {
  id: string;
  type: string;
  severity: string;
  message: string;
  resolved: boolean;
  resolved_by_id: string | null;
  resolved_at: string | null;
  resolution: string | null;
  user_id: string | null;
  shift_report_id: string | null;
  created_at: string;
  data: Record<string, unknown>;
}

export interface ResolveAlertInput {
  resolution: string;
  resolution_type?: 'no_action' | 'resolved' | 'charge_to_payroll';
  charge_amount?: number;
}

export async function fetchAlerts(params: {
  shift_report_id?: string;
  resolved?: boolean;
}): Promise<AlertRow[]> {
  const sp = new URLSearchParams();
  if (params.shift_report_id) sp.set('shift_report_id', params.shift_report_id);
  if (params.resolved !== undefined) sp.set('resolved', String(params.resolved));
  const qs = sp.toString();
  const { items } = await api.get<{ items: AlertRow[] }>(
    `/alerts${qs ? `?${qs}` : ''}`,
  );
  return items;
}

export async function resolveAlert(id: string, body: ResolveAlertInput): Promise<AlertRow> {
  return api.patch<AlertRow>(`/alerts/${id}/resolve`, body);
}
