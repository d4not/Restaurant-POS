/**
 * Shared types matching the backend's standard envelope.
 * Mirrors admin/src/types/api.ts so we can copy patterns across.
 */
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorPayload;
}

export interface ApiErrorPayload {
  message: string;
  code?: string;
  details?: unknown;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'BARISTA' | 'WAITER';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';

export interface FloorTable {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  open_order_count: number;
  current_order: {
    id: string;
    order_number: number;
    opened_at: string;
    item_count: number;
    waiter: { id: string; name: string } | null;
    total: string;
  } | null;
}

export interface FloorZone {
  id: string;
  name: string;
  display_order: number;
  tables: FloorTable[];
}

export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELLED';
export type OrderType = 'DINE_IN' | 'TAKEOUT';
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';

export interface Payment {
  id: string;
  order_id: string;
  method: PaymentMethod;
  amount: string;
  change_amount: string;
  reference: string | null;
  created_at: string;
}

export interface ActiveOrderItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: string;
  modifiers_price: string;
  line_total: string;
  notes: string | null;
  sent_to_kitchen: boolean;
  sent_at: string | null;
  product: { id: string; name: string; type: string };
  variant: { id: string; name: string } | null;
  modifiers: Array<{ id: string; name: string; extra_price: string }>;
  added_by_user: { id: string; name: string } | null;
}

export interface ActiveOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  order_type: OrderType;
  table_id: string | null;
  register_id: string;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  discount_reason: string | null;
  total: string;
  notes: string | null;
  needs_attention: boolean;
  attention_reason: string | null;
  created_at: string;
  updated_at: string;
  user: { id: string; name: string };
  table: {
    id: string;
    number: number;
    zone: { id: string; name: string };
  } | null;
  items: ActiveOrderItem[];
  payments?: Payment[];
}

export interface AddPaymentResult {
  payment: Payment;
  order: ActiveOrder;
}

// ── Products / menu ────────────────────────────────────────────────────

export type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';
export type ModifierGroupType = 'SWAP' | 'ADD';

export interface ProductCategory {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  color: string | null;
  display_order: number;
  visible_in_pos: boolean;
  parent_id: string | null;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  sell_price: string;
  display_order: number;
  active: boolean;
}

export interface ModifierOption {
  id: string;
  group_id: string;
  name: string;
  extra_price: string;
  is_default: boolean;
  active: boolean;
  display_order: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  type: ModifierGroupType;
  min_selection: number;
  max_selection: number;
  required: boolean;
  display_order: number;
  modifiers: ModifierOption[];
}

export interface ProductModifierGroupLink {
  id: string;
  modifier_group_id: string;
  product_id: string;
  modifier_group: ModifierGroup;
}

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  category_id: string | null;
  station_id: string | null;
  sell_price: string | null;
  image_url: string | null;
  icon_color: string | null;
  display_order: number;
  active: boolean;
  allow_discount: boolean;
  sold_by_weight: boolean;
  tax_id: string | null;
  category: ProductCategory | null;
  variants: ProductVariant[];
  modifier_groups: ProductModifierGroupLink[];
}

// ── Cash register ──────────────────────────────────────────────────────

export type CashRegisterStatus = 'OPEN' | 'CLOSED';
export type CashMovementType = 'CASH_IN' | 'CASH_OUT';

export interface CashMovement {
  id: string;
  register_id: string;
  user_id: string;
  type: CashMovementType;
  amount: string;
  reason: string;
  created_at: string;
}

export interface CashRegister {
  id: string;
  user_id: string;
  status: CashRegisterStatus;
  opening_amount: string;
  expected_amount: string;
  actual_amount: string | null;
  difference: string | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  user?: { id: string; name: string };
  cash_movements?: CashMovement[];
}

// ── Kitchen routing ────────────────────────────────────────────────────

/**
 * Shape returned by POST /orders/:id/send-to-kitchen. `items` is ONLY the
 * items that were marked as sent in this call — the comanda prints just
 * these rows so multiple sends against the same order don't duplicate food
 * already in the line.
 */
export interface SendToKitchenResult {
  order_id: string;
  printed_at: string;
  printed_count: number;
  items: Array<{
    id: string;
    quantity: number;
    notes: string | null;
    sent_at: string | null;
    product: { id: string; name: string; type: string; station_id: string | null };
    variant: { id: string; name: string } | null;
    modifiers: Array<{ id: string; name: string }>;
  }>;
  order: ActiveOrder;
}
