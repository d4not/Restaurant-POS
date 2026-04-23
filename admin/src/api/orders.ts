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
  table_id?: string;
  zone_id?: string;
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
  // Required for DINE_IN orders that use a table; backend rejects table_id on
  // TAKEOUT.
  table_id?: string | null;
  notes?: string;
}

export interface UpdateOrderInput {
  notes?: string | null;
  discount_amount?: number;
  discount_reason?: string | null;
  order_type?: OrderType;
  table_id?: string | null;
}

export function updateOrder(id: string, input: UpdateOrderInput) {
  return api.patch<Order>(`/orders/${id}`, input);
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

export interface OrderIngredientRow {
  supply_id: string;
  supply_name: string;
  quantity: string;
  unit: string;
  unit_cost: string;
  total_cost: string;
}

export interface OrderIngredientsResult {
  order_id: string;
  ingredients: OrderIngredientRow[];
  grand_total_cost: string;
}

export function getOrderIngredients(orderId: string) {
  return api.get<OrderIngredientsResult>(`/orders/${orderId}/ingredients`);
}
