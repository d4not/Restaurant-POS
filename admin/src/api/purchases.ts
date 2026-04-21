import { api } from './client';
import type { Paginated } from '../types/api';

export type PurchaseStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface Purchase {
  id: string;
  supplier_id: string;
  storage_id: string;
  date: string;
  status: PurchaseStatus;
  total: string;
  payment_method: string | null;
  notes: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
  supplier?: { id: string; name: string };
  storage?: { id: string; name: string };
  user?: { id: string; name: string };
}

export interface ListPurchasesParams {
  cursor?: string;
  limit?: number;
  status?: PurchaseStatus;
  supplier_id?: string;
  storage_id?: string;
  from?: string;
  to?: string;
}

export function listPurchases(params: ListPurchasesParams = {}) {
  return api.get<Paginated<Purchase>>('/purchases', { ...params });
}
