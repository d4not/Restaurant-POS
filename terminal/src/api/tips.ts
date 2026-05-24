// Tip pool API client. Mirrors admin/src/api/tips.ts.
//
// The backend lazy-creates an OPEN pool for the requested week on
// GET /tips/pools/current and re-refreshes its allocations each call. All
// monetary fields cross the wire as Prisma Decimal strings.

import { api } from './client';
import type { UserRole } from './employees';

export type TipPoolStatus = 'OPEN' | 'CLOSED';

export interface TipAllocation {
  id: string;
  pool_id: string;
  user_id: string;
  included: boolean;
  attended_days: number;
  base_amount: string;
  override_amount: string | null;
  final_amount: string;
  note: string | null;
  user?: {
    id: string;
    name: string;
    position: string | null;
    role: UserRole;
  };
}

export interface TipPool {
  id: string;
  week_start: string;
  week_end: string;
  total_collected: string;
  total_distributed: string;
  status: TipPoolStatus;
  closed_by_user_id: string | null;
  closed_at: string | null;
  closer?: { id: string; name: string } | null;
  allocations: TipAllocation[];
}

export interface UpdateAllocationInput {
  included?: boolean;
  /** Pass null to clear an override and fall back to base_amount. */
  override_amount?: number | null;
  note?: string | null;
}

export function getCurrentPool(date?: string): Promise<TipPool> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return api.get<TipPool>(`/tips/pools/current${qs}`);
}

export function getPool(id: string): Promise<TipPool> {
  return api.get<TipPool>(`/tips/pools/${id}`);
}

export function refreshPool(id: string): Promise<TipPool> {
  return api.post<TipPool>(`/tips/pools/${id}/refresh`);
}

export function updateAllocation(
  poolId: string,
  userId: string,
  input: UpdateAllocationInput,
): Promise<TipPool> {
  return api.patch<TipPool>(
    `/tips/pools/${poolId}/allocations/${userId}`,
    input,
  );
}

export function closePool(id: string): Promise<TipPool> {
  return api.post<TipPool>(`/tips/pools/${id}/close`);
}

export function reopenPool(id: string): Promise<TipPool> {
  return api.post<TipPool>(`/tips/pools/${id}/reopen`);
}
