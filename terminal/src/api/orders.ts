import { api } from './client';

// ─── Types matching the backend's `orderInclude` payload ───────────────────
// Decimals come over the wire as strings; we keep them as strings here and
// parse only in the UI helper that formats currency, so we never accidentally
// truncate to JS float precision.

export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELLED';
export type OrderType = 'DINE_IN' | 'TAKEOUT';
export type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';
export type PaymentMethodType = 'CASH' | 'CARD' | 'TRANSFER';

export interface ActiveOrderItemModifier {
  id: string;
  modifier_id: string;
  name: string;
  extra_price: string;
}

export interface ActiveOrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: string;
  modifiers_price: string;
  line_total: string;
  tax_rate: string;
  tax_amount: string;
  base_amount: string;
  notes: string | null;
  sent_to_kitchen: boolean;
  sent_at: string | null;
  added_by: string | null;
  // Soft-delete (void) audit. voided_at is set when a sent line is removed
  // — totals/inventory ignore voided lines but the row stays on the ticket
  // struck-through with a Restore option. void_printed_at is set once the
  // kitchen comanda has acknowledged the removal; if it's still null after a
  // void the next Send to Kitchen owes the kitchen a "REMOVED" notification.
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  void_printed_at: string | null;
  created_at: string;
  product: {
    id: string;
    name: string;
    type: ProductType;
    tax_id: string | null;
    station_id: string | null;
  };
  variant: { id: string; name: string } | null;
  modifiers: ActiveOrderItemModifier[];
  added_by_user: { id: string; name: string } | null;
  voided_by_user: { id: string; name: string } | null;
}

export interface ActiveOrderPayment {
  id: string;
  order_id: string;
  method: PaymentMethodType;
  amount: string;
  change_amount: string;
  reference: string | null;
  created_at: string;
}

export interface ActiveOrderTable {
  id: string;
  number: number;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
  zone: { id: string; name: string };
}

export interface ActiveOrder {
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
  needs_attention: boolean;
  attention_reason: string | null;
  created_at: string;
  updated_at: string;
  user: { id: string; name: string };
  table: ActiveOrderTable | null;
  items: ActiveOrderItem[];
  payments: ActiveOrderPayment[];
  register: { id: string; status: 'OPEN' | 'CLOSED'; user_id: string };
}

export function fetchActiveOrders(): Promise<ActiveOrder[]> {
  return api.get<ActiveOrder[]>('/orders/active');
}

export function fetchOrder(orderId: string): Promise<ActiveOrder> {
  return api.get<ActiveOrder>(`/orders/${orderId}`);
}

import type { PageResult } from './pagination';

export interface OrderHistoryQuery {
  status?: OrderStatus;
  from?: Date | null;
  to?: Date | null;
  cursor?: string;
  limit?: number;
}

// History uses the same `/orders` list endpoint as the admin panel — the
// terminal scopes it to PAID + CANCELLED so the cashier sees just settled
// shifts, not OPEN tickets (those live on Active Orders).
export function fetchOrderHistory(query: OrderHistoryQuery): Promise<PageResult<ActiveOrder>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.from) params.set('from', query.from.toISOString());
  if (query.to) params.set('to', query.to.toISOString());
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query.limit ?? 30));
  return api.get<PageResult<ActiveOrder>>(`/orders?${params.toString()}`);
}

export interface CreateOrderInput {
  register_id: string;
  order_type: OrderType;
  table_id?: string | null;
  notes?: string;
}

export function createOrder(input: CreateOrderInput): Promise<ActiveOrder> {
  return api.post<ActiveOrder>('/orders', input);
}

export interface UpdateOrderInput {
  notes?: string | null;
  discount_amount?: number;
  discount_reason?: string | null;
}

export function updateOrder(orderId: string, input: UpdateOrderInput): Promise<ActiveOrder> {
  return api.patch<ActiveOrder>(`/orders/${orderId}`, input);
}

export interface AddOrderItemInput {
  product_id: string;
  variant_id?: string | null;
  quantity?: number;
  modifier_ids?: string[];
  notes?: string;
}

export function addOrderItem(orderId: string, input: AddOrderItemInput): Promise<ActiveOrder> {
  return api.post<ActiveOrder>(`/orders/${orderId}/items`, input);
}

export interface UpdateOrderItemInput {
  quantity?: number;
  notes?: string | null;
  // Tap-to-edit on a ticket row pushes the new variant + modifiers through
  // here; the backend re-prices the line and replaces the OrderItemModifier
  // rows. Voided lines reject any edit (Restore first); sent lines need a PIN.
  variant_id?: string | null;
  modifier_ids?: string[];
  // Required by the backend when the target item already has sent_to_kitchen=true
  // — the cashier must re-enter their PIN before tweaking promised lines.
  pin?: string;
}

export function updateOrderItem(
  orderId: string,
  itemId: string,
  input: UpdateOrderItemInput,
): Promise<ActiveOrder> {
  return api.patch<ActiveOrder>(`/orders/${orderId}/items/${itemId}`, input);
}

export interface RemoveOrderItemInput {
  pin?: string;
  // Optional free-text the cashier may attach when soft-deleting a sent line.
  // Stored on the OrderItem as void_reason and printed on the comanda's
  // "REMOVED" section so the kitchen knows why.
  reason?: string;
}

export function removeOrderItem(
  orderId: string,
  itemId: string,
  input: RemoveOrderItemInput = {},
): Promise<ActiveOrder> {
  return api.delete<ActiveOrder>(`/orders/${orderId}/items/${itemId}`, input);
}

export interface RestoreOrderItemInput {
  pin?: string;
}

// Reverse a soft-delete. If the void was already printed on a comanda the
// backend resets sent_to_kitchen so the kitchen sees the line as a fresh
// pending item that the cashier needs to Send to Kitchen again.
export function restoreOrderItem(
  orderId: string,
  itemId: string,
  input: RestoreOrderItemInput = {},
): Promise<ActiveOrder> {
  return api.post<ActiveOrder>(`/orders/${orderId}/items/${itemId}/restore`, input);
}

export interface CreatePaymentInput {
  method: PaymentMethodType;
  amount: number;
  reference?: string | null;
}

export interface PaymentResult {
  payment: ActiveOrderPayment;
  order: ActiveOrder;
  deduction: unknown;
}

export function addOrderPayment(orderId: string, input: CreatePaymentInput): Promise<PaymentResult> {
  return api.post<PaymentResult>(`/orders/${orderId}/payments`, input);
}

export interface SendToKitchenItem {
  id: string;
  quantity: number;
  notes: string | null;
  sent_at: string | null;
  product: { id: string; name: string; type: string; station_id: string | null };
  variant: { id: string; name: string } | null;
  modifiers: Array<{ id: string; name: string }>;
}

// Items that were voided since the previous Send to Kitchen — the comanda
// renders these under a "** REMOVED **" banner so the cooks drop them.
export interface SendToKitchenVoidedItem extends SendToKitchenItem {
  voided_at: string | null;
  void_reason: string | null;
}

export interface SendToKitchenResult {
  order_id: string;
  printed_at: string;
  // Total of items + voided tombstones in this print. > 0 means something
  // will actually print; 0 means no changes since the last comanda and the
  // renderer should silently skip the printer call.
  printed_count: number;
  // True when this is a CORRECTION ticket — the kitchen has seen a comanda
  // for this order before, and the printer renders "REPLACES PREVIOUS
  // TICKET" so the cocina swaps their slip rather than appending. False on
  // the very first print of an order.
  is_correction: boolean;
  // First print: only the brand-new items. Correction: full snapshot of
  // currently-active items. Items where sent_at == printed_at were added in
  // this batch and the printer flags them with "[NEW]".
  items: SendToKitchenItem[];
  // First print: empty (no voids possible). Correction: every voided
  // tombstone on the order, struck through under a "** CANCELED **" banner.
  voided_items: SendToKitchenVoidedItem[];
  order: ActiveOrder;
}

export function sendOrderToKitchen(orderId: string): Promise<SendToKitchenResult> {
  return api.post<SendToKitchenResult>(`/orders/${orderId}/send-to-kitchen`);
}

export interface CancelOrderInput {
  // Both fields are required ONLY when the order has at least one sent item;
  // for free-cancel paths (waiter voids an empty mistake) they may be empty
  // strings — backend will skip the PIN check and treat the reason as null.
  reason?: string;
  pin?: string;
}

export function cancelOrder(orderId: string, input: CancelOrderInput = {}) {
  // Strip empty strings so the Zod regex on `pin` doesn't trip on "".
  const body: Record<string, string> = {};
  if (input.reason && input.reason.trim()) body.reason = input.reason.trim();
  if (input.pin) body.pin = input.pin;
  return api.delete(`/orders/${orderId}`, body);
}

export function flagOrderAttention(orderId: string, reason?: string) {
  return api.post(`/orders/${orderId}/request-attention`, { reason: reason ?? null });
}

export function clearOrderAttention(orderId: string) {
  return api.delete(`/orders/${orderId}/request-attention`);
}
