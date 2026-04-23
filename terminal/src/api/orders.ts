import { api } from './client';
import type {
  ActiveOrder,
  AddPaymentResult,
  OrderType,
  PaymentMethod,
  SendToKitchenResult,
} from '../types/api';

export interface CreateOrderInput {
  register_id: string;
  order_type: OrderType;
  table_id?: string | null;
  notes?: string;
}

export interface AddOrderItemInput {
  product_id: string;
  variant_id?: string | null;
  quantity?: number;
  modifier_ids?: string[];
  notes?: string;
}

export interface UpdateOrderItemInput {
  quantity?: number;
  notes?: string | null;
}

export function createOrder(input: CreateOrderInput): Promise<ActiveOrder> {
  return api.post<ActiveOrder>('/orders', input);
}

export function getOrder(id: string): Promise<ActiveOrder> {
  return api.get<ActiveOrder>(`/orders/${id}`);
}

export function addOrderItem(orderId: string, input: AddOrderItemInput): Promise<ActiveOrder> {
  return api.post<ActiveOrder>(`/orders/${orderId}/items`, input);
}

export function updateOrderItem(
  orderId: string,
  itemId: string,
  input: UpdateOrderItemInput,
): Promise<ActiveOrder> {
  return api.patch<ActiveOrder>(`/orders/${orderId}/items/${itemId}`, input);
}

export function removeOrderItem(orderId: string, itemId: string): Promise<ActiveOrder> {
  return api.delete<ActiveOrder>(`/orders/${orderId}/items/${itemId}`);
}

export function cancelOrder(id: string): Promise<ActiveOrder> {
  return api.delete<ActiveOrder>(`/orders/${id}`);
}

export function sendOrderToKitchen(id: string): Promise<SendToKitchenResult> {
  return api.post<SendToKitchenResult>(`/orders/${id}/send-to-kitchen`);
}

export interface AddPaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
}

export function addOrderPayment(
  orderId: string,
  input: AddPaymentInput,
): Promise<AddPaymentResult> {
  return api.post<AddPaymentResult>(`/orders/${orderId}/payments`, input);
}

// Flip needs_attention=true with an optional reason (waiter → cashier).
export function flagOrderAttention(
  orderId: string,
  reason: string | null,
): Promise<ActiveOrder> {
  return api.post<ActiveOrder>(`/orders/${orderId}/request-attention`, { reason });
}

// Clear the flag (cashier resolving the request).
export function clearOrderAttention(orderId: string): Promise<ActiveOrder> {
  return api.delete<ActiveOrder>(`/orders/${orderId}/request-attention`);
}
