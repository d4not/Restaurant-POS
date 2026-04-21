import { api } from './client';
import type { Paginated } from '../types/api';

export interface PurchasePackaging {
  id: string;
  supply_id: string;
  supplier_id: string;
  name: string;
  units_per_package: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListPackagingsParams {
  cursor?: string;
  limit?: number;
  supply_id?: string;
  supplier_id?: string;
  active?: boolean;
}

export function listPackagings(params: ListPackagingsParams = {}) {
  return api.get<Paginated<PurchasePackaging>>('/packagings', { ...params });
}
