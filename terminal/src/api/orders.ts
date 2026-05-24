import { api } from './client';

// ─── Types matching the backend's `orderInclude` payload ───────────────────
// Decimals come over the wire as strings; we keep them as strings here and
// parse only in the UI helper that formats currency, so we never accidentally
// truncate to JS float precision.

export type OrderStatus = 'OPEN' | 'PAID' | 'CANCELLED';
export type OrderType = 'DINE_IN' | 'TAKEOUT' | 'EMPLOYEE';
export type TakeoutChannel = 'LOCAL' | 'DELIVERY_LOCAL' | 'DELIVERY_APP';
export type ProductType = 'PRODUCT' | 'DISH' | 'PREPARATION';
// PAYROLL_DEDUCT settles against an employee's next paycheck and only applies
// to EMPLOYEE orders. The drawer is untouched.
export type PaymentMethodType = 'CASH' | 'CARD' | 'TRANSFER' | 'PAYROLL_DEDUCT';
export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'BARISTA' | 'WAITER';
// Why a sent line was voided. The first three are kitchen-side outcomes;
// BEFORE_PREP is the only one that doesn't represent waste (the kitchen
// hadn't started cooking yet).
export type VoidReasonCode = 'PRODUCT_CHANGE' | 'PRODUCT_DEFECT' | 'BEFORE_PREP' | 'OTHER';

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
  void_reason_code: VoidReasonCode | null;
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

// Cashier-proposed history edit that's waiting on manager approval. At most
// one PENDING per order at a time (enforced by a partial unique index in the
// DB). The manager sees a highlighted row in Order History with Approve /
// Reject buttons; the cashier sees a "Waiting for manager" badge.
export type OrderSuggestionType =
  | 'ORDER_REOPEN'
  | 'ORDER_DELETE'
  | 'ORDER_CHANGE_PAYMENT';

export interface PendingOrderSuggestion {
  id: string;
  type: OrderSuggestionType;
  // Free-form. Service-layer validates per type; UI shows a friendly label.
  payload: Record<string, unknown>;
  note: string | null;
  created_at: string;
  creator: { id: string; name: string; role: UserRole };
}

export interface ActiveOrder {
  id: string;
  register_id: string;
  order_number: number;
  status: OrderStatus;
  order_type: OrderType;
  takeout_channel: TakeoutChannel | null;
  // Populated when order_type=EMPLOYEE — the recipient of the tab.
  employee_user_id: string | null;
  employee: { id: string; name: string; role: UserRole } | null;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_reference: string | null;
  delivery_driver_name: string | null;
  delivery_app: string | null;
  delivery_app_order_id: string | null;
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
  // Backend includes a pending suggestion when the cashier has proposed a
  // post-close edit and a manager hasn't approved/rejected it yet. The
  // include returns an array (Prisma relation) but at most one row exists.
  suggestions: PendingOrderSuggestion[];
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
  // Filter pills on the history toolbar — single product, single payment
  // method, single table. All optional; the backend reduces to no-op when
  // missing.
  product_id?: string;
  payment_method?: PaymentMethodType;
  table_id?: string;
  // Bound the query to one shift. The history page groups by register and
  // re-issues fetchOrderHistory per section header.
  register_id?: string;
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
  if (query.product_id) params.set('product_id', query.product_id);
  if (query.payment_method) params.set('payment_method', query.payment_method);
  if (query.table_id) params.set('table_id', query.table_id);
  if (query.register_id) params.set('register_id', query.register_id);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query.limit ?? 30));
  return api.get<PageResult<ActiveOrder>>(`/orders?${params.toString()}`);
}

export interface CreateOrderInput {
  register_id: string;
  order_type: OrderType;
  takeout_channel?: TakeoutChannel;
  // Required when order_type=EMPLOYEE.
  employee_user_id?: string;
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
  takeout_channel?: TakeoutChannel | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  delivery_reference?: string | null;
  delivery_driver_name?: string | null;
  delivery_app?: string | null;
  delivery_app_order_id?: string | null;
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
  // Categorical reason. Required by the backend together with `reason` (≥3
  // chars) when the target line has sent_to_kitchen=true; both are ignored on
  // the unsent free-cancel path.
  reason_code?: VoidReasonCode;
  // Free-text explanation the kitchen sees on the next comanda. Backend
  // requires ≥ 3 chars when removing a sent line.
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
  // Tip the customer hands over on top of the order total. Centavos, ≥ 0.
  // For CASH: `amount` is gross tender (sale + tip); the cashier physically
  // routes the tip to the jar, not the drawer. For CARD/TRANSFER: `amount`
  // = `remaining + tip_amount`. The backend rejects any non-zero tip on
  // PAYROLL_DEDUCT. Drawer expected_amount excludes tips entirely.
  tip_amount?: number;
  // Required by the backend when the JWT user is WAITER/BARISTA — they must
  // include a CASHIER+/MANAGER/ADMIN PIN to settle. Cashier+ leave this off.
  pin?: string;
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

// ────── Manager-only history edits — each carries a manager PIN that the
// backend validates against authorizeManagerPin and records on the order.

export interface ReopenOrderInput {
  pin: string;
  reason?: string;
}

export function reopenOrder(orderId: string, input: ReopenOrderInput): Promise<ActiveOrder> {
  const body: Record<string, string> = { pin: input.pin };
  if (input.reason && input.reason.trim()) body.reason = input.reason.trim();
  return api.post<ActiveOrder>(`/orders/${orderId}/reopen`, body);
}

export interface SoftDeleteOrderInput {
  pin: string;
  reason: string;
}

export function softDeleteOrder(orderId: string, input: SoftDeleteOrderInput): Promise<ActiveOrder> {
  return api.post<ActiveOrder>(`/orders/${orderId}/soft-delete`, {
    pin: input.pin,
    reason: input.reason.trim(),
  });
}

export interface UpdatePaymentMethodInput {
  pin: string;
  method: PaymentMethodType;
  reference?: string | null;
}

export function updatePaymentMethod(
  orderId: string,
  paymentId: string,
  input: UpdatePaymentMethodInput,
): Promise<{ payment: ActiveOrderPayment; order: ActiveOrder }> {
  const body: Record<string, unknown> = { pin: input.pin, method: input.method };
  if (input.reference !== undefined) {
    body.reference = input.reference?.trim() || null;
  }
  return api.patch<{ payment: ActiveOrderPayment; order: ActiveOrder }>(
    `/orders/${orderId}/payments/${paymentId}/method`,
    body,
  );
}

// ────── Cashier-proposed suggestions on history orders. Cashiers submit
// using THEIR cashier PIN; the action stays in PENDING until a manager
// approves or rejects from the same screen.

export interface CreateReopenSuggestionInput {
  type: 'ORDER_REOPEN';
  pin: string;
  reason?: string;
}
export interface CreateDeleteSuggestionInput {
  type: 'ORDER_DELETE';
  pin: string;
  reason: string;
}
export interface CreateChangePaymentSuggestionInput {
  type: 'ORDER_CHANGE_PAYMENT';
  pin: string;
  payment_id: string;
  method: PaymentMethodType;
  reference?: string | null;
}
export type CreateOrderSuggestionInput =
  | CreateReopenSuggestionInput
  | CreateDeleteSuggestionInput
  | CreateChangePaymentSuggestionInput;

export interface OrderSuggestion {
  id: string;
  type: OrderSuggestionType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  payload: Record<string, unknown>;
  note: string | null;
  created_at: string;
  creator: { id: string; name: string; role: UserRole };
}

export function createOrderSuggestion(
  orderId: string,
  input: CreateOrderSuggestionInput,
): Promise<OrderSuggestion> {
  const body: Record<string, unknown> = { type: input.type, pin: input.pin };
  if (input.type === 'ORDER_REOPEN') {
    if (input.reason && input.reason.trim()) body.reason = input.reason.trim();
  } else if (input.type === 'ORDER_DELETE') {
    body.reason = input.reason.trim();
  } else {
    body.payment_id = input.payment_id;
    body.method = input.method;
    if (input.reference !== undefined) {
      body.reference = input.reference?.trim() || null;
    }
  }
  return api.post<OrderSuggestion>(`/orders/${orderId}/suggestions`, body);
}

export interface ReviewOrderSuggestionInput {
  pin: string;
  review_note?: string;
}

export function approveOrderSuggestion(
  suggestionId: string,
  input: ReviewOrderSuggestionInput,
): Promise<OrderSuggestion> {
  const body: Record<string, unknown> = { pin: input.pin };
  if (input.review_note && input.review_note.trim()) {
    body.review_note = input.review_note.trim();
  }
  return api.post<OrderSuggestion>(`/order-suggestions/${suggestionId}/approve`, body);
}

export function rejectOrderSuggestion(
  suggestionId: string,
  input: ReviewOrderSuggestionInput,
): Promise<OrderSuggestion> {
  const body: Record<string, unknown> = { pin: input.pin };
  if (input.review_note && input.review_note.trim()) {
    body.review_note = input.review_note.trim();
  }
  return api.post<OrderSuggestion>(`/order-suggestions/${suggestionId}/reject`, body);
}

// Manager+ view of every order suggestion in a given status — backs the
// Suggested Changes admin view. Returns the order snapshot alongside each
// suggestion so the manager has enough context to decide.
export interface OrderSuggestionListItem extends OrderSuggestion {
  order: {
    id: string;
    order_number: number;
    status: OrderStatus;
    total: string;
    order_type: OrderType;
    created_at: string;
  } | null;
}

export function listOrderSuggestions(
  status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
): Promise<OrderSuggestionListItem[]> {
  return api.get<OrderSuggestionListItem[]>(`/order-suggestions?status=${status}`);
}
