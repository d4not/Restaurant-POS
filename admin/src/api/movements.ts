import { api } from './client';
import type { Paginated } from '../types/api';
import type { StockMovement, StockMovementType } from '../types/inventory';

export interface ListMovementsParams {
  cursor?: string;
  limit?: number;
  supply_id?: string;
  storage_id?: string;
  type?: StockMovementType;
  reference_type?: string;
  reference_id?: string;
  from?: string;
  to?: string;
}

export function listMovements(params: ListMovementsParams = {}) {
  return api.get<Paginated<StockMovement>>('/stock-movements', { ...params });
}
