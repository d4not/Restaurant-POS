import { api } from './client';
import type { Paginated } from '../types/api';
import type { Order, OrderStatus, OrderType } from '../types/operations';

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
