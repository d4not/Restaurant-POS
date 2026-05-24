// `unknown` covers recipe config errors that the operator can fix (missing
// SWAP default, unknown supply reference, broken preparation chain). The
// frontend treats `unknown` like `out` for blocking, but tells the admin to
// fix the underlying config rather than re-stocking.
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

export interface BulkAvailabilityResult {
  generated_at: string;
  resolved_storage_id: string | null;
  products: ProductAvailability[];
  modifiers: ModifierAvailability[];
}

export interface LineAvailabilityInput {
  product_id: string;
  variant_id?: string | null;
  modifier_ids?: string[];
  quantity?: number;
}

export interface LineAvailabilityResult {
  status: AvailabilityStatus;
  max_servable: number;
  limiting: LimitingSupply | null;
  config_errors: string[];
}
