import { api } from './client';

export interface LowStockAlert {
  supply_id: string;
  supply_name: string;
  base_unit: string;
  storage_id: string;
  storage_name: string;
  quantity: string;
  min_stock: string;
  shortfall: string;
  average_cost: string;
}

export interface LowStockParams {
  storage_id?: string;
}

export function listLowStock(params: LowStockParams = {}) {
  return api.get<{ items: LowStockAlert[] }>('/alerts/low-stock', { ...params });
}
