import { api } from './client';
import type { Paginated } from '../types/api';
import type { StockMovement, StockMovementType } from '../types/inventory';

export interface ListMovementsParams {
  cursor?: string;
  limit?: number;
  supply_id?: string;
  storage_id?: string;
  /** Single type or list of types — multi-type is sent as comma-separated and
   *  the backend Zod schema unwraps it into a Prisma `IN` filter. */
  type?: StockMovementType | StockMovementType[];
  reference_type?: string;
  reference_id?: string;
  from?: string;
  to?: string;
}

export function listMovements(params: ListMovementsParams = {}) {
  const { type, ...rest } = params;
  const typeParam = Array.isArray(type)
    ? type.length > 0
      ? type.join(',')
      : undefined
    : type;
  return api.get<Paginated<StockMovement>>('/stock-movements', {
    ...rest,
    type: typeParam,
  });
}
