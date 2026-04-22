import { api } from './client';
import type { Paginated } from '../types/api';
import type {
  CreatePackagingInput,
  PurchasePackaging,
  UpdatePackagingInput,
} from '../types/inventory';

export type { PurchasePackaging } from '../types/inventory';

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

export function createPackaging(input: CreatePackagingInput) {
  return api.post<PurchasePackaging>('/packagings', input);
}

export function updatePackaging(id: string, input: UpdatePackagingInput) {
  return api.patch<PurchasePackaging>(`/packagings/${id}`, input);
}

export function deletePackaging(id: string) {
  return api.delete<void>(`/packagings/${id}`);
}
