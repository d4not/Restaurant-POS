import { api } from './client';
import type { ActiveOrder, FloorZone } from '../types/api';

export function getFloors(): Promise<FloorZone[]> {
  return api.get<FloorZone[]>('/floors');
}

export function getActiveOrders(): Promise<ActiveOrder[]> {
  return api.get<ActiveOrder[]>('/orders/active');
}
