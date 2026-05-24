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

export type SupplierKind = 'DELIVERY' | 'ERRAND' | 'BOTH';
export const SUPPLIER_KINDS: SupplierKind[] = ['DELIVERY', 'ERRAND', 'BOTH'];

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
  // How this supplier is contacted. DELIVERY = remote (WhatsApp, courier);
  // ERRAND = local store visited with cash; BOTH = either flow.
  kind: SupplierKind;
  // E.164 without leading '+'. Used by the wa.me deep link on the purchase
  // order detail view.
  whatsapp_phone: string | null;
  // Optional override for the auto-generated WhatsApp message. Supports
  // {supplier_name}, {items}, {total}, {date} placeholders.
  message_template: string | null;
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

export interface PurchasePackaging {
  id: string;
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: string;
  price_per_package: string | null;
  is_primary: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  supplier?: { id: string; name: string };
}

export interface CreatePackagingInput {
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: number;
  price_per_package?: number | null;
  is_primary?: boolean;
  active?: boolean;
}

export type UpdatePackagingInput = Partial<Omit<CreatePackagingInput, 'supply_id' | 'supplier_id'>>;

// Extended lifecycle (Phase 2026-05 redesign). Old enum members kept so
// historical rows that pre-date the migration still parse — new flows use
// VERIFIED, not CONFIRMED.
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
export const PURCHASE_KINDS: PurchaseKind[] = ['DELIVERY', 'ERRAND'];

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  supply_id: string;
  packaging_id: string | null;
  package_quantity: string;
  price_per_package: string;
  base_unit_quantity: string;
  unit_cost: string;
  received_package_quantity: string | null;
  shortfall_reason: string | null;
  unavailable: boolean;
  created_at: string;
  supply?: { id: string; name: string; base_unit: BaseUnit };
  packaging?: PurchasePackaging | null;
}

export interface PurchaseCashMovement {
  id: string;
  type: 'CASH_IN' | 'CASH_OUT';
  amount: string;
  reason: string;
  created_at: string;
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
  created_at: string;
  updated_at: string;
  // DELIVERY lifecycle audit
  message_sent_at: string | null;
  supplier_replied_at: string | null;
  supplier_subtotal: string | null;
  shipping_cost: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  in_transit_at: string | null;
  arrived_at: string | null;
  expected_arrival: string | null;
  // ERRAND lifecycle audit
  runner_user_id: string | null;
  cash_advanced: string | null;
  cash_returned: string | null;
  dispatched_at: string | null;
  returned_at: string | null;
  // Shared terminal audit
  verified_at: string | null;
  verified_by_user_id: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  items?: PurchaseItem[];
  supplier?: Supplier;
  storage?: { id: string; name: string };
  user?: { id: string; name: string };
  runner?: { id: string; name: string } | null;
  verifier?: { id: string; name: string } | null;
  canceller?: { id: string; name: string } | null;
  cash_movements?: PurchaseCashMovement[];
}

export interface CreatePurchaseItemInput {
  supply_id: string;
  packaging_id?: string | null;
  package_quantity: number;
  price_per_package: number;
}

export interface CreatePurchaseInput {
  supplier_id: string;
  storage_id: string;
  date: string;
  kind?: PurchaseKind;
  payment_method?: string;
  notes?: string;
  expected_arrival?: string | null;
  items?: CreatePurchaseItemInput[];
}

export interface UpdatePurchaseInput {
  supplier_id?: string;
  storage_id?: string;
  date?: string;
  payment_method?: string | null;
  notes?: string | null;
  expected_arrival?: string | null;
}

export type UpdatePurchaseItemInput = Partial<CreatePurchaseItemInput>;

// ─── Lifecycle transition inputs ────────────────────────────────────────────

export interface ReplyPurchaseInput {
  supplier_subtotal?: number | null;
  shipping_cost?: number | null;
  items?: Array<{ id: string; unavailable?: boolean }>;
}

export interface PayPurchaseInput {
  payment_reference?: string | null;
}

export interface InTransitInput {
  expected_arrival?: string | null;
}

export interface ReceivedItemInput {
  id: string;
  received_package_quantity: number;
  shortfall_reason?: string | null;
}

export interface ReceiveInput {
  items?: ReceivedItemInput[];
}

export interface VerifyInput {
  items?: ReceivedItemInput[];
}

export interface DispatchInput {
  runner_user_id: string;
  cash_advanced: number;
  reason?: string;
}

export interface ReturnInput {
  cash_returned?: number;
  reason?: string;
  items?: ReceivedItemInput[];
}

export interface CancelInput {
  cancel_reason: string;
}

export interface WhatsappLink {
  url: string | null;
  message: string;
  requires_phone: boolean;
}

export interface CreateSupplyInput {
  name: string;
  barcode?: string;
  category_id: string;
  base_unit: BaseUnit;
  content_per_unit?: number;
  content_unit?: ContentUnit;
  active?: boolean;
  // Seeds Supply.average_cost / Supply.last_cost (centavos per base unit) so
  // the supplies list reflects the price the operator entered even before any
  // purchase confirms. Matches the backend `createSupplySchema` field of the
  // same name; ignored on update (use `unit_cost` there instead).
  initial_unit_cost?: number;
}

export type UpdateSupplyInput = Partial<
  Omit<CreateSupplyInput, 'initial_unit_cost'>
> & {
  // Manual WAC anchor on an existing supply (centavos per base unit). Mirrors
  // backend `updateSupplySchema.unit_cost`.
  unit_cost?: number;
};

export interface CreateSupplierInput {
  name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  credit_days?: number;
  notes?: string;
  active?: boolean;
  kind?: SupplierKind;
  whatsapp_phone?: string | null;
  message_template?: string | null;
}

export type UpdateSupplierInput = Partial<CreateSupplierInput>;
