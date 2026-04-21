import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  Order,
  OrderStatus,
  OrderType,
  Payment,
  PaymentMethod,
} from '../types/operations';

export interface ListOrdersParams {
  cursor?: string;
  limit?: number;
  status?: OrderStatus;
  order_type?: OrderType;
  register_id?: string;
  user_id?: string;
  from?: string;
  to?: string;
}

export function listOrders(params: ListOrdersParams = {}) {
  return api.get<Paginated<Order>>('/orders', { ...params });
}

export function getOrder(id: string) {
  return api.get<Order>(`/orders/${id}`);
}

export function cancelOrder(id: string) {
  return api.delete<Order>(`/orders/${id}`);
}

export interface CreateOrderInput {
  register_id: string;
  order_type: OrderType;
  notes?: string;
}

export function createOrder(input: CreateOrderInput) {
  return api.post<Order>('/orders', input);
}

export interface AddOrderItemInput {
  product_id: string;
  variant_id?: string | null;
  quantity?: number;
  modifier_ids?: string[];
  notes?: string;
}

export function addOrderItem(orderId: string, input: AddOrderItemInput) {
  return api.post<Order>(`/orders/${orderId}/items`, input);
}

export function removeOrderItem(orderId: string, itemId: string) {
  return api.delete<Order>(`/orders/${orderId}/items/${itemId}`);
}

export interface UpdateOrderItemInput {
  quantity?: number;
  notes?: string | null;
}

export function updateOrderItem(
  orderId: string,
  itemId: string,
  input: UpdateOrderItemInput,
) {
  return api.patch<Order>(`/orders/${orderId}/items/${itemId}`, input);
}

export interface CreatePaymentInput {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface AddPaymentResponse {
  payment: Payment;
  order: Order;
  deduction: unknown;
}

export function addPayment(orderId: string, input: CreatePaymentInput) {
  return api.post<AddPaymentResponse>(`/orders/${orderId}/payments`, input);
}
