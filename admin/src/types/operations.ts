/**
 * Types for the operational side — cash registers, cash movements, orders,
 * order items, payments — mirroring the Prisma models returned by the
 * /registers and /orders endpoints.
 *
 * Decimal fields come over the wire as strings (Prisma serialization).
 */

export type CashRegisterStatus = 'OPEN' | 'CLOSED';
export type CashMovementType = 'CASH_IN' | 'CASH_OUT';

export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELLED';
export const ORDER_STATUSES: OrderStatus[] = ['OPEN', 'PAID', 'CANCELLED'];

export type OrderType = 'DINE_IN' | 'TAKEOUT';
export const ORDER_TYPES: OrderType[] = ['DINE_IN', 'TAKEOUT'];

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
export const TABLE_STATUSES: TableStatus[] = ['AVAILABLE', 'OCCUPIED', 'RESERVED'];

export function tableStatusLabel(s: TableStatus): string {
  switch (s) {
    case 'AVAILABLE': return 'Available';
    case 'OCCUPIED':  return 'Occupied';
    case 'RESERVED':  return 'Reserved';
  }
}

export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';
export const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER'];

export function orderTypeLabel(t: OrderType): string {
  switch (t) {
    case 'DINE_IN': return 'Dine-in';
    case 'TAKEOUT': return 'Takeout';
  }
}

export function orderStatusLabel(s: OrderStatus): string {
  switch (s) {
    case 'OPEN':      return 'Open';
    case 'PAID':      return 'Paid';
    case 'CANCELLED': return 'Cancelled';
  }
}

export function paymentMethodLabel(m: PaymentMethod): string {
  switch (m) {
    case 'CASH':     return 'Cash';
    case 'CARD':     return 'Card';
    case 'TRANSFER': return 'Transfer';
  }
}

export function cashMovementTypeLabel(t: CashMovementType): string {
  return t === 'CASH_IN' ? 'Cash in' : 'Cash out';
}

/* ── Cash movements ─────────────────────────────────────── */

export interface CashMovement {
  id: string;
  register_id: string;
  type: CashMovementType;
  amount: string;
  reason: string;
  user_id: string;
  created_at: string;
}

/* ── Cash register / shift ─────────────────────────────── */

export interface CashRegister {
  id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: string;
  expected_amount: string;
  actual_amount: string | null;
  difference: string | null;
  status: CashRegisterStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  user?: { id: string; name: string };
  cash_movements?: CashMovement[];
}

export interface OpenRegisterInput {
  opening_amount: number;
  notes?: string;
}

export interface CloseRegisterInput {
  actual_amount: number;
  notes?: string;
}

export interface CreateCashMovementInput {
  type: CashMovementType;
  amount: number;
  reason: string;
}

/* ── Orders ─────────────────────────────────────────────── */

export interface OrderItemModifier {
  id: string;
  order_item_id: string;
  modifier_id: string;
  name: string;
  extra_price: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: string;
  modifiers_price: string;
  line_total: string;
  // Tax snapshot captured at add-time — never recomputed from the current
  // Tax row, so historical orders stay stable across rate changes. Prices are
  // tax-INCLUSIVE: line_total is what the customer pays; base_amount is the
  // revenue portion and tax_amount is the tax portion extracted out.
  tax_rate: string;
  tax_amount: string;
  base_amount: string;
  notes: string | null;
  // Kitchen routing audit. sent_to_kitchen flips true on the first comanda
  // that includes this item; sent_at stamps when the comanda printed. The
  // admin timeline uses these to render "Sent to kitchen at HH:MM" events.
  sent_to_kitchen: boolean;
  sent_at: string | null;
  added_by: string | null;
  // Soft-delete (void) audit. Voided items aren't hard-deleted once they've
  // been sent to the kitchen — they stay on the order as tombstones (totals
  // exclude them) so the admin can render a struck-through line with the
  // reason / who / when. void_printed_at stamps the comanda that announced
  // the removal to the kitchen.
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  void_printed_at: string | null;
  created_at: string;
  product?: {
    id: string;
    name: string;
    type: 'PRODUCT' | 'DISH' | 'PREPARATION';
    tax_id: string | null;
    station_id: string | null;
  };
  variant?: { id: string; name: string } | null;
  modifiers?: OrderItemModifier[];
  added_by_user?: { id: string; name: string } | null;
  voided_by_user?: { id: string; name: string } | null;
}

export interface Payment {
  id: string;
  order_id: string;
  method: PaymentMethod;
  amount: string;
  change_amount: string;
  reference: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  register_id: string;
  order_number: number;
  status: OrderStatus;
  order_type: OrderType;
  table_id: string | null;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  discount_reason: string | null;
  total: string;
  notes: string | null;
  user_id: string;
  order_date: string;
  // Waiter→Cashier "Request edit" signal flipped from the terminal. Cleared
  // by a cashier+ once they've reviewed the order. Surfaced in the admin
  // timeline so management can see when help was requested.
  needs_attention: boolean;
  attention_reason: string | null;
  // Cancellation audit — populated when an order is moved to CANCELLED.
  // cancelled_by is included via orderInclude so the timeline can name who
  // pulled the trigger.
  cancel_reason: string | null;
  cancelled_by_user_id: string | null;
  cancelled_at: string | null;
  cancelled_by?: { id: string; name: string } | null;
  created_at: string;
  updated_at: string;
  register?: { id: string; status: CashRegisterStatus; user_id: string };
  user?: { id: string; name: string };
  table?: {
    id: string;
    number: number;
    capacity: number;
    status: TableStatus;
    zone: { id: string; name: string };
  } | null;
  items?: OrderItem[];
  payments?: Payment[];
}

/* ── Zones & Tables ──────────────────────────────────────── */

export interface Zone {
  id: string;
  name: string;
  display_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZoneWithTables extends Zone {
  tables: Table[];
}

export type TableShape = 'TABLE_RECT' | 'TABLE_CIRCLE';

export interface Table {
  id: string;
  zone_id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  shape: TableShape;
  label: string | null;
  rotation: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  // Embedded by GET /tables and GET /tables/:id, not by GET /zones?include_tables
  // (which already has the parent zone in the response shape).
  zone?: { id: string; name: string; display_order: number };
}
