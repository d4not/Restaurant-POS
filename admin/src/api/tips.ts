import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  TipPool,
  TipPoolStatus,
  UpdateAllocationInput,
} from '../types/people';

export interface ListPoolsParams {
  cursor?: string;
  limit?: number;
  status?: TipPoolStatus;
  /** ISO date string (YYYY-MM-DD). */
  from?: string;
  /** ISO date string (YYYY-MM-DD). */
  to?: string;
}

export function listPools(params: ListPoolsParams = {}) {
  return api.get<Paginated<TipPool>>('/tips/pools', { ...params });
}

export function getCurrentPool(date?: string) {
  return api.get<TipPool>('/tips/pools/current', date ? { date } : undefined);
}

export function getPool(id: string) {
  return api.get<TipPool>(`/tips/pools/${id}`);
}

export function refreshPool(id: string) {
  return api.post<TipPool>(`/tips/pools/${id}/refresh`);
}

export function updateAllocation(
  poolId: string,
  userId: string,
  input: UpdateAllocationInput,
) {
  return api.patch<TipPool>(
    `/tips/pools/${poolId}/allocations/${userId}`,
    input,
  );
}

export function closePool(id: string) {
  return api.post<TipPool>(`/tips/pools/${id}/close`);
}

export function reopenPool(id: string) {
  return api.post<TipPool>(`/tips/pools/${id}/reopen`);
}
