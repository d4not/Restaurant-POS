import { api } from './client';
import type { Paginated } from '../types/api';
import type { SupplyCategory } from '../types/inventory';

export interface ListSupplyCategoriesParams {
  cursor?: string;
  limit?: number;
  search?: string;
}

export function listSupplyCategories(params: ListSupplyCategoriesParams = {}) {
  return api.get<Paginated<SupplyCategory>>('/supply-categories', { ...params });
}

export function createSupplyCategory(input: { name: string; description?: string }) {
  return api.post<SupplyCategory>('/supply-categories', input);
}
