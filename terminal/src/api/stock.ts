import { api } from './client';

export type AvailabilityStatus = 'available' | 'low' | 'out' | 'unknown';

export interface LimitingSupply {
  supply_id: string;
  supply_name: string;
  current_qty: string;
  needed_per_unit: string;
  storage_id: string;
  storage_name: string | null;
}

export interface ProductAvailability {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  product_type: 'PRODUCT' | 'DISH';
  status: AvailabilityStatus;
  max_servable: number;
  limiting: LimitingSupply | null;
  config_errors: string[];
}

export interface ModifierAvailability {
  modifier_id: string;
  modifier_name: string;
  group_id: string;
  group_name: string;
  group_type: 'ADD' | 'SWAP';
  status: AvailabilityStatus;
  max_additions: number;
  limiting: LimitingSupply | null;
}

export interface AvailabilitySnapshot {
  generated_at: string;
  resolved_storage_id: string | null;
  products: ProductAvailability[];
  modifiers: ModifierAvailability[];
}

export function fetchAvailability(registerId?: string | null): Promise<AvailabilitySnapshot> {
  const qs = registerId ? `?register_id=${encodeURIComponent(registerId)}` : '';
  return api.get<AvailabilitySnapshot>(`/stock/availability${qs}`);
}
