/**
 * Types mirroring the backend Prisma models that the inventory module
 * returns (see prisma/schema.prisma + src/modules/* controllers).
 *
 * Decimal fields are serialized by Prisma as strings; treat them as such
 * and convert at the edges using Number() / Decimal when needed.
 */

export type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';
export type ContentUnit = 'ML' | 'L' | 'G' | 'KG' | 'OZ' | 'FL_OZ';
export type StockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'WRITE_OFF'
  | 'ADJUSTMENT'
  | 'MANUFACTURE';

export const BASE_UNITS: BaseUnit[] = ['PIECE', 'BOTTLE', 'KG', 'LITER', 'BAG', 'BOX', 'UNIT'];
export const CONTENT_UNITS: ContentUnit[] = ['ML', 'L', 'G', 'KG', 'OZ', 'FL_OZ'];
export const STOCK_MOVEMENT_TYPES: StockMovementType[] = [
  'PURCHASE',
  'SALE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'WRITE_OFF',
  'ADJUSTMENT',
  'MANUFACTURE',
];

export interface SupplyCategory {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TareWeight {
  id: string;
  supply_id: string;
  empty_weight_grams: string;
  full_weight_grams: string;
  net_content: string;
  created_at: string;
  updated_at: string;
}

export interface Supply {
  id: string;
  barcode: string | null;
  name: string;
  category_id: string;
  base_unit: BaseUnit;
  content_per_unit: string | null;
  content_unit: ContentUnit | null;
  average_cost: string;
  last_cost: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  category?: SupplyCategory;
  tare_weight?: TareWeight | null;
}

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_days: number;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Storage {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StorageStock {
  id: string;
  supply_id: string;
  storage_id: string;
  quantity: string;
  min_stock: string | null;
  created_at: string;
  updated_at: string;
  storage?: { id: string; name: string; active: boolean };
}

export interface StockMovement {
  id: string;
  supply_id: string;
  storage_id: string;
  type: StockMovementType;
  quantity: string;
  reference_type: string;
  reference_id: string;
  unit_cost: string;
  created_at: string;
  supply?: { id: string; name: string; base_unit: BaseUnit };
  storage?: { id: string; name: string };
}

export interface CreateSupplyInput {
  name: string;
  barcode?: string;
  category_id: string;
  base_unit: BaseUnit;
  content_per_unit?: number;
  content_unit?: ContentUnit;
  active?: boolean;
}

export type UpdateSupplyInput = Partial<CreateSupplyInput>;

export interface CreateSupplierInput {
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  credit_days?: number;
  notes?: string;
  active?: boolean;
}

export type UpdateSupplierInput = Partial<CreateSupplierInput>;
